import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CampaignState,
  KycStatus,
  ScheduleKind,
  type ScheduleStep,
} from '@prisma/client';
import { BondsService } from '../bonds/bonds.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SolanaService,
  type OnchainDeal,
  type OnchainPosition,
} from '../solana/solana.service.js';
import { uuidToBytes } from '../solana/user-id.js';
import { buildSchedule, type Schedule } from '../campaigns/schedule.js';
import { campaignStatus, overdueNow } from './campaign-status.js';
import { EventsService } from './events.service.js';
import { investorSummary, pendingPayout, shareBps } from './payout.js';
import {
  creditable,
  explainFailure,
  formatAmount,
  whyBlocked,
} from './deposit-errors.js';

const BORROWER_FULL = {
  select: {
    id: true,
    name: true,
    logoKey: true,
    rating: true,
    description: true,
    industry: true,
    website: true,
    foundedAt: true,
    photos: {
      select: { id: true, caption: true },
      orderBy: { sortOrder: 'asc' },
    },
  },
} as const;

const BORROWER = {
  select: {
    id: true,
    name: true,
    logoKey: true,
    rating: true,
    // Первая фотография предприятия — картинка на плитке кампании.
    photos: {
      select: { id: true },
      orderBy: { sortOrder: 'asc' },
      take: 1,
    },
  },
} as const;

/** Итог попытки зачисления — то, что показываем после кнопки «Я перевёл». */
export interface CreditResult {
  credited: bigint;
  message: string;
}

@Injectable()
export class InvestService {
  private readonly logger = new Logger(InvestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly solana: SolanaService,
    private readonly events: EventsService,
    private readonly bonds: BondsService,
  ) {}

  /**
   * Кампании, в которые сейчас можно вложиться. Состояние сбора берём из сети:
   * в базе оно не хранится, иначе разойдётся с контрактом.
   */
  /**
   * Витрина: все опубликованные кампании со статусом, сбором и участием
   * инвестора. Смотреть можно и без одобрения — решение вкладываться человек
   * принимает до проверки, а не после.
   */
  async campaigns(userId: string) {
    const investor = await this.prisma.investor.findUnique({
      where: { userId },
    });

    const published = await this.prisma.campaign.findMany({
      where: { state: CampaignState.PUBLISHED, onchainId: { not: null } },
      orderBy: { createdAt: 'desc' },
      include: { borrower: BORROWER },
    });
    const ids = published.map((campaign) => BigInt(campaign.onchainId!));

    // Два обращения в сеть на всю витрину, а не два на каждую кампанию.
    const [deals, positions] = await Promise.all([
      this.solana.deals(ids),
      investor?.onchainAccount
        ? this.solana.positions(ids, uuidToBytes(investor.userId))
        : Promise.resolve(new Map<string, OnchainPosition>()),
    ]);

    const now = Math.floor(Date.now() / 1000);
    return published
      .map((campaign) => {
        const key = String(campaign.onchainId);
        const deal = deals.get(key);
        // Сделки может не быть, если публикация оборвалась на середине.
        if (!deal) return null;

        const photo = campaign.borrower.photos[0];
        return {
          id: campaign.id,
          title: campaign.title,
          borrower: {
            id: campaign.borrower.id,
            name: campaign.borrower.name,
            logoKey: campaign.borrower.logoKey,
            rating: campaign.borrower.rating,
          },
          photoUrl: photo
            ? `/api/borrowers/${campaign.borrower.id}/photos/${photo.id}`
            : null,
          status: campaignStatus({
            dealState: deal.state,
            fundingDeadline: deal.fundingDeadline,
            overduePrincipal: overdueNow(deal, now),
            now,
          }),
          scheduleKind: campaign.scheduleKind,
          annualRateBps: campaign.annualRateBps,
          mintDecimals: campaign.mintDecimals,
          softCap: deal.softCap,
          hardCap: deal.hardCap,
          minTicket: deal.minTicket,
          maxTicket: deal.maxTicket,
          totalRaised: deal.totalRaised,
          fundingDeadline: deal.fundingDeadline,
          /** Дата последнего платежа: по ней считается срок до конца займа. */
          lastDueTs: deal.lastDueTs,
          invested: positions.get(key)?.principal ?? 0n,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  /**
   * Всё для страницы кампании: условия, график, своя позиция, состав
   * инвесторов и адреса в контракте. Открыта любому вошедшему инвестору —
   * решение вкладываться принимается до проверки, а не после.
   */
  async page(userId: string, campaignId: string) {
    const investor = await this.prisma.investor.findUnique({
      where: { userId },
    });
    const blocker = participationBlock(investor);

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { borrower: BORROWER_FULL },
    });
    if (
      !campaign ||
      campaign.state !== CampaignState.PUBLISHED ||
      !campaign.onchainId ||
      !campaign.mint
    ) {
      throw new NotFoundException('Кампания не найдена');
    }
    const onchainId = BigInt(campaign.onchainId);
    const mint = campaign.mint;
    const deal = await this.deal(onchainId);

    const [positions, mine] = await Promise.all([
      this.solana.campaignPositions(onchainId),
      investor && !blocker
        ? this.solana.position(onchainId, uuidToBytes(investor.userId))
        : Promise.resolve(null),
    ]);

    const raised = deal.totalRaised;
    const schedules = this.schedules(campaign, deal);
    const actual = schedules.max;

    const position = mine
      ? {
          address: mine.address,
          principal: mine.principal,
          shareBps: shareBps(mine.principal, raised),
          payout: pendingPayout(mine, deal),
          /**
           * Сколько вернётся за весь срок, если заём погасят по графику.
           * Считаем от тела графика, а не от собранного: пока идёт сбор,
           * сумма ещё растёт, а отношение «отдадут к телу» от неё не зависит.
           */
          expected: scaleToPosition(
            actual.totals.total,
            mine.principal,
            actual,
          ),
          next: this.nextPayment(actual, mine.principal),
        }
      : null;

    return {
      campaign: {
        id: campaign.id,
        title: campaign.title,
        purpose: campaign.purpose,
        collateral: campaign.collateral,
        scheduleKind: campaign.scheduleKind,
        scheduleStep: campaign.scheduleStep,
        periodsPerYear: campaign.periodsPerYear,
        periodCount: campaign.periodCount,
        annualRateBps: campaign.annualRateBps,
        penaltyRateBps: campaign.penaltyRateBps,
        defaultThresholdDays: campaign.defaultThresholdDays,
        prepaymentFeeBps: campaign.prepaymentFeeBps,
        cancelGraceDays: campaign.cancelGraceDays,
        mint,
        mintDecimals: campaign.mintDecimals,
        firstDueAt: campaign.firstDueAt,
      },
      borrower: campaign.borrower,
      status: campaignStatus({
        dealState: deal.state,
        fundingDeadline: deal.fundingDeadline,
        overduePrincipal: overdueNow(deal),
      }),
      deal,
      schedules,
      position,
      investors: {
        ...investorSummary(positions.map((item) => item.principal)),
        // Крупнейшие десять: остальные в списке всё равно не читаются,
        // а сводка выше считается по всем.
        shares: positions.slice(0, 10).map((item) => ({
          address: item.address,
          principal: item.principal,
          shareBps: shareBps(item.principal, raised),
          mine: item.address === mine?.address,
          url: this.solana.explorerAddress(item.address),
        })),
      },
      addresses: [
        ['Сделка', this.solana.dealPda(onchainId).toBase58()],
        ['Волт кампании', this.solana.vaultAddress(onchainId, mint).toBase58()],
        ['Расчётный токен', mint],
      ].map(([label, address]) => ({
        label,
        address,
        url: this.solana.explorerAddress(address),
      })),
      /** Минт облигации: у кредита бумаги нет. Ссылка ведёт на расширения. */
      bond:
        campaign.scheduleKind === ScheduleKind.COUPON
          ? await this.bonds.mintLink(onchainId)
          : null,
      participationBlock: blocker,
      /** Часы платформы: время на странице считается по ним, а не по браузеру. */
      now: Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Публичная карточка заёмщика: чем занимается, фотографии, оценка риска и
   * все его кампании. Инвестору важно видеть, кому он даёт деньги, а не
   * только одну кампанию. Реквизиты и БИН сюда не попадают — это внутреннее.
   */
  async borrower(borrowerId: string) {
    const borrower = await this.prisma.borrower.findUnique({
      where: { id: borrowerId },
      select: {
        id: true,
        name: true,
        description: true,
        industry: true,
        website: true,
        foundedAt: true,
        employees: true,
        rating: true,
        logoKey: true,
        photos: {
          select: { id: true, caption: true },
          orderBy: { sortOrder: 'asc' },
        },
        campaigns: {
          where: { state: CampaignState.PUBLISHED, onchainId: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            title: true,
            onchainId: true,
            annualRateBps: true,
            scheduleKind: true,
            mintDecimals: true,
          },
        },
      },
    });
    if (!borrower || borrower.campaigns.length === 0) {
      // Заёмщик без опубликованных кампаний инвестору не показывается.
      throw new NotFoundException('Заёмщик не найден');
    }

    const deals = await this.solana.deals(
      borrower.campaigns.map((campaign) => BigInt(campaign.onchainId!)),
    );
    const now = Math.floor(Date.now() / 1000);

    const campaigns = borrower.campaigns
      .map((campaign) => {
        const deal = deals.get(String(campaign.onchainId));
        if (!deal) return null;
        return {
          id: campaign.id,
          title: campaign.title,
          annualRateBps: campaign.annualRateBps,
          scheduleKind: campaign.scheduleKind,
          mintDecimals: campaign.mintDecimals,
          status: campaignStatus({
            dealState: deal.state,
            fundingDeadline: deal.fundingDeadline,
            overduePrincipal: overdueNow(deal, now),
            now,
          }),
          totalRaised: deal.totalRaised,
          softCap: deal.softCap,
          hardCap: deal.hardCap,
          fundingDeadline: deal.fundingDeadline,
          lastDueTs: deal.lastDueTs,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return {
      borrower: {
        id: borrower.id,
        name: borrower.name,
        description: borrower.description,
        industry: borrower.industry,
        website: borrower.website,
        foundedAt: borrower.foundedAt,
        employees: borrower.employees,
        rating: borrower.rating,
        logoKey: borrower.logoKey,
        photos: borrower.photos,
      },
      campaigns,
      /** Сколько займов заёмщик уже погасил: это и есть его история. */
      repaid: campaigns.filter((item) => item.status === 'REPAID').length,
      now,
    };
  }

  /** История операций из блокчейна; `refresh` сначала дочитывает новое. */
  async history(campaignId: string, refresh = false) {
    const { onchainId } = await this.campaign(campaignId);
    if (refresh) await this.events.sync(campaignId, onchainId);
    const events = await this.events.list(campaignId);
    return events.map((event) => ({
      name: event.name,
      payload: event.payload,
      at: event.blockTime,
      signature: event.signature,
      url: this.solana.explorerTx(event.signature),
    }));
  }

  /**
   * Забирает инвестору причитающееся и возвращает страницу кампании.
   * Портфель зовёт `claimToWallet` напрямую: ему нужен свой ответ.
   */
  async claim(userId: string, campaignId: string) {
    await this.claimToWallet(userId, campaignId);
    return this.page(userId, campaignId);
  }

  /**
   * Отправляет вывод в сеть. У несостоявшегося сбора возвращается взнос,
   * у остальных — распределённые тело, проценты, пеня и комиссия.
   */
  async claimToWallet(userId: string, campaignId: string): Promise<void> {
    const investor = await this.investor(userId);
    const { onchainId, mint } = await this.campaign(campaignId);
    const deal = await this.deal(onchainId);
    if (!investor.withdrawalAddress) {
      throw new BadRequestException('В анкете не указан адрес для вывода');
    }

    const bytes = uuidToBytes(investor.userId);
    const failed = deal.state === 'failed';
    try {
      await (failed
        ? this.solana.withdrawRefund(
            onchainId,
            bytes,
            mint,
            investor.withdrawalAddress,
          )
        : this.solana.withdrawPayout(
            onchainId,
            bytes,
            mint,
            investor.withdrawalAddress,
          ));
    } catch (error) {
      throw new BadRequestException(explainFailure(error).reason);
    }
    // У несостоявшегося сбора вместе со взносом возвращается и бумага:
    // держать её без долга не за чем.
    if (failed) await this.bonds.burnForRefund(campaignId, investor.id);
    // Событие о выводе уже в сети — подтянем его вместе с остальной историей.
    await this.events.sync(campaignId, onchainId).catch(() => 0);
  }

  /**
   * График платежей. Пока идёт сбор, тело зависит от того, сколько соберут,
   * поэтому считаем два: по минимуму и по максимуму. Даты берём из контракта —
   * там они зафиксированы, а не пересчитываются.
   */
  private schedules(
    campaign: {
      scheduleKind: ScheduleKind;
      scheduleStep: ScheduleStep;
      periodsPerYear: number;
      periodCount: number | null;
      annualRateBps: number | null;
      platformFeeBps: number;
      firstDueAt: Date | null;
    },
    deal: OnchainDeal,
  ) {
    const params = {
      kind: campaign.scheduleKind,
      periodCount: campaign.periodCount ?? deal.periodCount,
      periodsPerYear: campaign.periodsPerYear,
      annualRateBps: campaign.annualRateBps ?? 0,
      platformFeeBps: campaign.platformFeeBps,
      firstDueTs: campaign.firstDueAt
        ? Math.floor(campaign.firstDueAt.getTime() / 1000)
        : (deal.periods[0]?.dueTs ?? 0),
      step: campaign.scheduleStep,
    };
    const build = (amount: bigint) => {
      const schedule = buildSchedule({ ...params, amount });
      // Даты — из контракта: он единственный источник правды по срокам.
      schedule.periods.forEach((period, index) => {
        const onchain = deal.periods[index];
        if (onchain) period.dueTs = onchain.dueTs;
      });
      return schedule;
    };

    const collecting = deal.state === 'funding';
    return {
      /** Сценарий по минимуму сбора; у закрытой кампании совпадает с max. */
      min: build(collecting ? deal.softCap : deal.totalRaised),
      max: build(collecting ? deal.hardCap : deal.totalRaised),
      collecting,
    };
  }

  /** Следующий платёж по графику и доля инвестора в нём. */
  private nextPayment(schedule: Schedule, principal: bigint) {
    const now = Math.floor(Date.now() / 1000);
    const period = schedule.periods.find((item) => item.dueTs > now);
    if (!period) return null;
    return {
      index: period.index,
      dueTs: period.dueTs,
      total: period.total,
      /** Сколько из этого платежа придётся на вас. */
      yours: scaleToPosition(period.total, principal, schedule),
    };
  }

  /**
   * Состояние пополнения. Читать можно и без одобрения: тогда вместо адреса
   * приходит объяснение, почему участие пока закрыто.
   */
  async state(userId: string, campaignId: string) {
    const investor = await this.prisma.investor.findUnique({
      where: { userId },
    });
    const blocker = participationBlock(investor);
    const { campaign, onchainId, mint } = await this.campaign(campaignId);
    const deal = await this.deal(onchainId);

    const deposit =
      investor && !blocker
        ? await this.prisma.campaignDeposit.findUnique({
            where: {
              investorId_campaignId: { investorId: investor.id, campaignId },
            },
            include: { credits: { orderBy: { createdAt: 'desc' } } },
          })
        : null;

    const [pending, position] = await Promise.all([
      deposit ? this.solana.tokenBalance(deposit.address) : Promise.resolve(0n),
      investor && !blocker
        ? this.solana.position(onchainId, uuidToBytes(investor.userId))
        : Promise.resolve(null),
    ]);
    const principal = position?.principal ?? 0n;

    const block = deposit
      ? whyBlocked({
          ...deal,
          dealState: deal.state,
          pending,
          principal,
          faceValue: bondFaceValue(campaign),
        })
      : null;

    return {
      campaign: {
        id: campaign.id,
        title: campaign.title,
        borrower: campaign.borrower,
        annualRateBps: campaign.annualRateBps,
        periodCount: campaign.periodCount,
        scheduleStep: campaign.scheduleStep,
        scheduleKind: campaign.scheduleKind,
        /** Номинал бумаги у облигации: взнос обязан быть кратен ему. */
        faceValue: bondFaceValue(campaign) ?? null,
        mint,
        mintDecimals: campaign.mintDecimals,
      },
      deal,
      /**
       * Сбор больше не принимает деньги. Дедлайн наступает раньше, чем
       * оператор закрывает сбор: в этом промежутке контракт взнос уже не
       * зачтёт, и открывать адрес пополнения незачем — деньги на нём зависнут.
       */
      fundingOver:
        deal.state !== 'funding' ||
        Math.floor(Date.now() / 1000) >= deal.fundingDeadline,
      /** Пусто, когда участвовать можно; иначе — почему пока нельзя. */
      participationBlock: blocker,
      deposit: deposit
        ? {
            owner: deposit.owner,
            address: deposit.address,
            openedAt: deposit.openedAt,
            claimedAt: deposit.claimedAt,
            url: this.solana.explorerAddress(deposit.owner),
          }
        : null,
      pending,
      invested: principal,
      /** Сколько уйдёт в кампанию при зачислении прямо сейчас. */
      creditable: deposit ? creditable({ ...deal, pending, principal }) : 0n,
      block,
      credits: (deposit?.credits ?? []).map((credit) => ({
        amount: credit.amount,
        sender: credit.sender,
        createdAt: credit.createdAt,
        url: this.solana.explorerTx(credit.signature),
      })),
    };
  }

  /**
   * Открывает адрес пополнения. Инструкция контракта идемпотентна, но и запись
   * заводим одну: повторное нажатие просто возвращает тот же адрес.
   */
  async open(userId: string, campaignId: string) {
    const investor = await this.investor(userId);
    const { onchainId, mint } = await this.campaign(campaignId);
    const deal = await this.deal(onchainId);
    if (deal.state !== 'funding') {
      throw new BadRequestException('Кампания больше не принимает взносы');
    }

    const existing = await this.prisma.campaignDeposit.findUnique({
      where: {
        investorId_campaignId: { investorId: investor.id, campaignId },
      },
    });
    if (!existing) {
      const bytes = uuidToBytes(investor.userId);
      const signature = await this.solana.openDeposit(onchainId, bytes, mint);
      await this.prisma.campaignDeposit.create({
        data: {
          investorId: investor.id,
          campaignId,
          owner: this.solana
            .depositOwnerPda(this.solana.dealPda(onchainId), bytes)
            .toBase58(),
          address: this.solana
            .depositTokenAddress(onchainId, bytes, mint)
            .toBase58(),
          openSignature: signature,
        },
      });
    }

    return this.state(userId, campaignId);
  }

  /**
   * Зачисляет то, что лежит на адресе. Вызывается и по таймеру открытого экрана,
   * и кнопкой «Я перевёл» — во втором случае отмечаем время: если инвестор
   * говорит, что перевёл, а денег нет, поддержке будет с чего начать разбор.
   */
  async credit(userId: string, campaignId: string, claimed = false) {
    const investor = await this.investor(userId);
    const { campaign, onchainId, mint } = await this.campaign(campaignId);
    const deposit = await this.prisma.campaignDeposit.findUnique({
      where: {
        investorId_campaignId: { investorId: investor.id, campaignId },
      },
    });
    if (!deposit) throw new NotFoundException('Адрес пополнения ещё не открыт');

    if (claimed) {
      await this.prisma.campaignDeposit.update({
        where: { id: deposit.id },
        data: { claimedAt: new Date() },
      });
    }

    const bytes = uuidToBytes(investor.userId);
    const pending = await this.solana.tokenBalance(deposit.address);
    if (pending === 0n) {
      return {
        ...(await this.state(userId, campaignId)),
        result: {
          credited: 0n,
          message:
            'Поступлений пока нет. Перевод по сети идёт до минуты — загляните сюда чуть позже',
        } satisfies CreditResult,
      };
    }

    // У облигации взнос — целое число бумаг. Проверяем до отправки
    // транзакции: иначе доля в контракте и бумаги на руках разойдутся.
    const face = bondFaceValue(campaign);
    if (face && pending % face !== 0n) {
      const next = (pending / face + 1n) * face;
      const amount = (value: bigint) =>
        formatAmount(value, campaign.mintDecimals);
      return {
        ...(await this.state(userId, campaignId)),
        result: {
          credited: 0n,
          message: `Облигация продаётся лотами по ${amount(face)}. На адресе ${amount(pending)}, ближайший лот — ${amount(next)}: доплатите разницу или заберите остаток`,
        } satisfies CreditResult,
      };
    }

    const before =
      (await this.solana.position(onchainId, bytes))?.principal ?? 0n;

    let result: CreditResult;
    try {
      const signature = await this.solana.invest(onchainId, bytes, mint);
      const after =
        (await this.solana.position(onchainId, bytes))?.principal ?? 0n;
      const credited = after - before;
      // Отправителя ищем уже после зачисления: это справочные данные, и если
      // разобрать не выйдет, задерживать из-за них деньги незачем.
      const sender = await this.solana.lastSender(deposit.address);

      await this.prisma.depositCredit.create({
        data: { depositId: deposit.id, amount: credited, signature, sender },
      });
      // Облигация подтверждается бумагой в тот же момент, когда ушли деньги,
      // а не после закрытия сбора. Для кредита вызов ничего не делает.
      await this.bonds.mintForInvestment(campaignId, investor.id, credited);
      result = { credited, message: 'Взнос зачислен в кампанию' };
    } catch (error) {
      const block = explainFailure(error);
      this.logger.warn(
        `Зачисление ${deposit.address} не прошло: ${block.code} — ${String(error)}`,
      );
      result = { credited: 0n, message: block.reason };
    }

    return { ...(await this.state(userId, campaignId)), result };
  }

  /** Возвращает остаток с адреса пополнения на адрес вывода инвестора. */
  async withdraw(userId: string, campaignId: string) {
    const investor = await this.investor(userId);
    const { onchainId, mint } = await this.campaign(campaignId);
    const deposit = await this.prisma.campaignDeposit.findUnique({
      where: {
        investorId_campaignId: { investorId: investor.id, campaignId },
      },
    });
    if (!deposit) throw new NotFoundException('Адрес пополнения ещё не открыт');
    if (!investor.withdrawalAddress) {
      throw new BadRequestException('В анкете не указан адрес для вывода');
    }

    try {
      await this.solana.withdrawDeposit(
        onchainId,
        uuidToBytes(investor.userId),
        mint,
        investor.withdrawalAddress,
      );
    } catch (error) {
      throw new BadRequestException(explainFailure(error).reason);
    }
    return this.state(userId, campaignId);
  }

  // ── Вспомогательное ──────────────────────────────────────────────────────

  /**
   * Инвестор, которому можно вкладывать. Статус читаем из базы, а не из токена:
   * токен выписан до одобрения и об этом не знает.
   */
  private async investor(userId: string) {
    const investor = await this.prisma.investor.findUnique({
      where: { userId },
    });
    const blocker = participationBlock(investor);
    if (blocker) throw new ForbiddenException(blocker);
    return investor!;
  }

  private async campaign(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { borrower: BORROWER },
    });
    if (
      !campaign ||
      campaign.state !== CampaignState.PUBLISHED ||
      !campaign.onchainId ||
      !campaign.mint
    ) {
      throw new NotFoundException('Кампания не найдена');
    }
    return {
      campaign,
      onchainId: BigInt(campaign.onchainId),
      mint: campaign.mint,
    };
  }

  private async deal(onchainId: bigint): Promise<OnchainDeal> {
    const deal = await this.solana.deal(onchainId);
    if (!deal) throw new NotFoundException('Сделки нет в контракте');
    return deal;
  }
}

/** Почему инвестору пока нельзя вкладывать. Пусто — значит можно. */
function participationBlock(
  investor: { status: KycStatus; onchainAccount: string | null } | null,
): string | null {
  if (!investor || investor.status !== KycStatus.APPROVED) {
    return 'Вкладывать можно после того, как проверка личности пройдена';
  }
  if (!investor.onchainAccount) {
    return 'Ваш аккаунт в контракте ещё создаётся. Загляните чуть позже';
  }
  return null;
}

/**
 * Пересчитывает сумму из графика на долю инвестора. Делим на тело графика,
 * а не на собранное: пока идёт сбор, собранное растёт, а доля инвестора в
 * возврате от этого не меняется — контракт считает тело от того, что собрали.
 */
function scaleToPosition(
  amount: bigint,
  principal: bigint,
  schedule: Schedule,
): bigint {
  const body = schedule.totals.principal;
  return body > 0n ? (amount * principal) / body : 0n;
}

/**
 * Номинал бумаги, если кампания — облигация. У кредита с аннуитетом бумаги
 * нет, и кратность взноса ничем не ограничена.
 */
function bondFaceValue(campaign: {
  scheduleKind: ScheduleKind;
  bondFaceValue: bigint | null;
  minTicket: bigint | null;
}): bigint | undefined {
  if (campaign.scheduleKind !== ScheduleKind.COUPON) return undefined;
  const value = campaign.bondFaceValue ?? campaign.minTicket;
  return value && value > 0n ? value : undefined;
}
