import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CampaignState,
  Prisma,
  PublishStage,
  ScheduleKind,
  ScheduleStep,
  type Campaign,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PERIODS_PER_TX, SolanaService } from '../solana/solana.service.js';
import type {
  CreateCampaignDto,
  ListCampaignsDto,
  UpdateCampaignDto,
} from './dto.js';
import { BondsService } from '../bonds/bonds.service.js';
import { daysPastDue } from '../borrowers/debt.js';
import { EventsService } from '../investors/events.service.js';
import { campaignStatus, overdueNow } from '../investors/campaign-status.js';
import { explainFailure } from '../investors/deposit-errors.js';
import { buildSchedule, type Schedule } from './schedule.js';
import {
  checkCampaign,
  firstFailure,
  type CampaignCheck,
} from './validation.js';

const INCLUDE = {
  borrower: {
    include: { wallets: { orderBy: { isDefault: 'desc' } } },
  },
  txs: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.CampaignInclude;

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly solana: SolanaService,
    private readonly events: EventsService,
    private readonly bonds: BondsService,
  ) {}

  // ── Черновики ────────────────────────────────────────────────────────────

  async list(filter: ListCampaignsDto) {
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        ...(filter.state ? { state: filter.state } : {}),
        ...(filter.borrowerId ? { borrowerId: filter.borrowerId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        borrower: { select: { id: true, name: true, logoKey: true } },
      },
    });

    // Состояние займа лежит в сети, а не у нас: без него в списке неотличимы
    // кампания, которую пора закрывать, и давно погашенный заём. Одно
    // обращение на весь список; упало — показываем список без состояний.
    const ids = campaigns
      .filter((campaign) => campaign.onchainId)
      .map((campaign) => BigInt(campaign.onchainId!));
    const deals = await this.solana
      .deals(ids)
      .catch(
        () => new Map<string, Awaited<ReturnType<SolanaService['deal']>>>(),
      );

    const now = seconds(new Date());
    return campaigns.map((campaign) => {
      const deal = campaign.onchainId
        ? deals.get(String(campaign.onchainId))
        : undefined;
      return {
        ...campaign,
        status: deal
          ? campaignStatus({
              dealState: deal.state,
              fundingDeadline: deal.fundingDeadline,
              overduePrincipal: overdueNow(deal, now),
              now,
            })
          : 'UNKNOWN',
      };
    });
  }

  async get(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: INCLUDE,
    });
    if (!campaign) throw new NotFoundException('Кампания не найдена');
    return campaign;
  }

  async create(dto: CreateCampaignDto) {
    const borrower = await this.prisma.borrower.findUnique({
      where: { id: dto.borrowerId },
      include: { wallets: { where: { isDefault: true } } },
    });
    if (!borrower) throw new NotFoundException('Заёмщик не найден');

    return this.prisma.campaign.create({
      data: {
        borrowerId: borrower.id,
        title: dto.title.trim(),
        // Токен по умолчанию можно сменить на шаге «Деньги».
        mint: this.solana.defaultMintAddress,
        // Основной кошелёк подставляем сразу: чаще всего он и нужен.
        walletId: borrower.wallets[0]?.id,
      },
      include: INCLUDE,
    });
  }

  async update(id: string, dto: UpdateCampaignDto) {
    const campaign = await this.get(id);
    this.assertDraft(campaign);

    if (dto.walletId) {
      const wallet = campaign.borrower.wallets.find(
        (item) => item.id === dto.walletId,
      );
      if (!wallet)
        throw new BadRequestException('Этот кошелёк не принадлежит заёмщику');
    }

    return this.prisma.campaign.update({
      where: { id },
      data: this.toData(dto),
      include: INCLUDE,
    });
  }

  async remove(id: string) {
    const campaign = await this.get(id);
    // Опубликованную кампанию удалять нельзя: в контракте она останется навсегда.
    if (campaign.state === CampaignState.PUBLISHED) {
      throw new ConflictException('Опубликованную кампанию удалить нельзя');
    }
    await this.prisma.campaign.delete({ where: { id } });
  }

  // ── Предпросмотр ─────────────────────────────────────────────────────────

  /**
   * График для двух сумм: минимума и максимума сбора. Контракт считает тело от
   * фактически собранного, поэтому один график был бы обещанием, которого никто не давал.
   */
  preview(campaign: Campaign, overrides: UpdateCampaignDto = {}) {
    const merged = { ...campaign, ...this.toData(overrides) } as Campaign;
    const missing = this.missingForSchedule(merged);
    if (missing) throw new BadRequestException(missing);

    const common = {
      kind:
        merged.scheduleKind === ScheduleKind.COUPON
          ? ('COUPON' as const)
          : ('ANNUITY' as const),
      periodCount: merged.periodCount!,
      periodsPerYear: merged.periodsPerYear,
      annualRateBps: merged.annualRateBps!,
      platformFeeBps: merged.platformFeeBps,
      firstDueTs: seconds(merged.firstDueAt!),
      step: merged.scheduleStep as ScheduleStep,
    };

    return {
      min: buildSchedule({ ...common, amount: merged.softCap! }),
      max: buildSchedule({ ...common, amount: merged.hardCap! }),
    };
  }

  /** Доли тела одинаковы для любой суммы — именно их принимает контракт. */
  private fractionsFor(campaign: Campaign) {
    return this.preview(campaign).max.periods.map((period) => ({
      dueTs: period.dueTs,
      principalFraction: period.principalFraction,
    }));
  }

  async checks(id: string): Promise<CampaignCheck[]> {
    const campaign = await this.get(id);
    const mintAllowed = campaign.mint
      ? await this.solana.isMintAllowed(campaign.mint).catch(() => false)
      : false;
    return checkCampaign(campaign, { mintAllowed });
  }

  // ── Публикация ───────────────────────────────────────────────────────────

  /**
   * Отправляет кампанию в контракт. Публикация идёт тремя шагами и может оборваться
   * между ними, поэтому перед каждым шагом читаем состояние в сети и пропускаем сделанное:
   * повторное нажатие продолжает с места обрыва, а не создаёт вторую кампанию.
   */
  async publish(id: string, actorId?: string) {
    const campaign = await this.get(id);
    if (campaign.state === CampaignState.PUBLISHED) {
      throw new ConflictException('Кампания уже опубликована');
    }

    const mintAllowed = campaign.mint
      ? await this.solana.isMintAllowed(campaign.mint)
      : false;
    const failure = firstFailure(checkCampaign(campaign, { mintAllowed }));
    if (failure)
      throw new BadRequestException(`${failure.title}: ${failure.hint}`);

    const wallet = campaign.borrower.wallets.find(
      (item) => item.id === campaign.walletId,
    )!;
    const campaignId = campaign.onchainId
      ? BigInt(campaign.onchainId.toString())
      : await this.solana.nextCampaignId();

    await this.prisma.campaign.update({
      where: { id },
      data: {
        state: CampaignState.PUBLISHING,
        onchainId: campaignId,
        error: null,
      },
    });

    try {
      const periods = this.fractionsFor(campaign);

      if (!(await this.solana.deal(campaignId))) {
        const signature = await this.solana.createCampaign(campaignId, {
          softCap: campaign.softCap!,
          hardCap: campaign.hardCap!,
          minTicket: campaign.minTicket!,
          maxTicket: campaign.maxTicket,
          fundingStart: seconds(campaign.fundingStart!),
          fundingDeadline: seconds(campaign.fundingDeadline!),
          scheduleKind:
            campaign.scheduleKind === ScheduleKind.COUPON
              ? 'COUPON'
              : 'ANNUITY',
          annualRateBps: campaign.annualRateBps!,
          periodsPerYear: campaign.periodsPerYear,
          penaltyRateBps: campaign.penaltyRateBps,
          defaultThresholdDays: campaign.defaultThresholdDays,
          prepaymentFeeBps: campaign.prepaymentFeeBps,
          platformFeeBps: campaign.platformFeeBps,
          cancelGraceDays: campaign.cancelGraceDays,
          borrowerWallet: wallet.address,
          mint: campaign.mint!,
        });
        await this.recordTx(id, PublishStage.CREATE, signature);
      }

      // Догружаем только недостающие платежи: часть могла уйти до обрыва.
      let deal = await this.solana.deal(campaignId);
      while (deal && deal.periodCount < periods.length) {
        const chunk = periods.slice(
          deal.periodCount,
          deal.periodCount + PERIODS_PER_TX,
        );
        const signature = await this.solana.addPeriods(campaignId, chunk);
        await this.recordTx(id, PublishStage.PERIODS, signature);
        deal = await this.solana.deal(campaignId);
      }

      if (deal && !deal.scheduleFinalized) {
        const signature = await this.solana.finalizeSchedule(campaignId);
        await this.recordTx(id, PublishStage.FINALIZE, signature);
      }

      // В журнал пишем после успеха: незавершённая публикация не событие.
      if (actorId) {
        await this.prisma.adminAction.create({
          data: {
            actorId,
            action: 'publishCampaign',
            target: id,
            signature: campaignId.toString(),
          },
        });
      }

      const published = await this.prisma.campaign.update({
        where: { id },
        data: {
          state: CampaignState.PUBLISHED,
          payoutWallet: wallet.address,
          error: null,
        },
        include: INCLUDE,
      });

      // Облигация выпускается вместе с публикацией: бумага существует с
      // открытия сбора, а держатели получают её по мере взносов. У кредита
      // с аннуитетом вызов тихо ничего не делает.
      await this.bonds.issueForCampaign(id).catch((error: unknown) => {
        this.logger.error(
          `Кампания ${id} опубликована, но бумага не выпущена: ${String(error)}`,
        );
        return null;
      });
      return published;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Публикация кампании ${id} оборвалась: ${message}`);
      await this.prisma.campaign.update({
        where: { id },
        data: { state: CampaignState.FAILED, error: message.slice(0, 500) },
      });
      throw new BadRequestException(
        `Публикация не завершена: ${message}. Нажмите «Опубликовать» ещё раз — продолжим с места обрыва`,
      );
    }
  }

  /** Состояние сделки в сети: в базе оно не хранится, чтобы не разошлось. */
  async onchain(id: string) {
    const campaign = await this.get(id);
    if (!campaign.onchainId) return null;

    const campaignId = BigInt(campaign.onchainId.toString());
    const deal = await this.solana.deal(campaignId);
    if (!deal) return null;

    const platformFee =
      (deal.totalRaised * BigInt(deal.platformFeeBps)) / 10_000n;

    return {
      ...deal,
      totalRaised: deal.totalRaised.toString(),
      address: this.solana.dealPda(campaignId).toBase58(),
      repayAddress: campaign.mint
        ? this.solana.repayAddress(campaignId, campaign.mint).toBase58()
        : null,
      /** Дни просрочки на сейчас: поле в сделке верно только на начисление. */
      daysPastDue: daysPastDue(deal, Math.floor(Date.now() / 1000)),
      /** Пусто — сбор можно отменить; иначе почему сейчас нельзя. */
      cancelBlock: cancelBlock(deal, campaign.cancelGraceDays),
      /** Что произойдёт при закрытии сбора: админ видит это до нажатия. */
      closing: {
        /** Пусто — закрывать можно; иначе причина, почему пока нет. */
        block: closingBlock(deal),
        /**
         * Минимум не собран или график не зафиксирован: закрытие отправит
         * кампанию в несостоявшийся сбор, а деньги — обратно инвесторам.
         */
        willFail: !deal.scheduleFinalized || deal.totalRaised < deal.softCap,
        platformFee,
        payoutAmount: deal.totalRaised - platformFee,
        wallets: campaign.borrower.wallets.map((wallet) => ({
          id: wallet.id,
          label: wallet.label,
          address: wallet.address,
          current: wallet.address === deal.borrowerWallet,
        })),
      },
      txs: campaign.txs.map((tx) => ({
        stage: tx.stage,
        signature: tx.signature,
        url: this.solana.explorerTx(tx.signature),
        createdAt: tx.createdAt,
      })),
    };
  }

  // ── Закрытие сбора ───────────────────────────────────────────────────────

  /**
   * Закрывает сбор. Одна инструкция контракта решает обе судьбы кампании:
   * при собранном минимуме деньги уходят заёмщику и заём становится
   * действующим, иначе кампания становится несостоявшейся и инвесторы
   * забирают взносы обратно.
   *
   * Перевод заёмщику необратим, поэтому вызываем только после того, как админ
   * подтвердил адрес получения, — этого же требует и контракт, принимая
   * инструкцию лишь от ключа оператора.
   */
  async close(id: string, actorId?: string) {
    const { campaign, onchainId, mint } = await this.published(id);
    const deal = await this.solana.deal(onchainId);
    if (!deal) throw new NotFoundException('Сделки нет в контракте');

    const blocker = closingBlock(deal);
    if (blocker) throw new BadRequestException(blocker);

    let signature: string;
    try {
      signature = await this.solana.closeFunding(
        onchainId,
        mint,
        deal.borrowerWallet,
      );
    } catch (error) {
      this.logger.error(`Закрытие сбора ${id} не прошло: ${String(error)}`);
      throw new BadRequestException(explainFailure(error).reason);
    }

    if (actorId) {
      await this.prisma.adminAction.create({
        data: {
          actorId,
          action: 'closeFunding',
          target: campaign.id,
          signature,
        },
      });
    }
    await this.events.sync(campaign.id, onchainId).catch(() => 0);
    return this.onchain(id);
  }

  /**
   * Меняет кошелёк получения на другой адрес того же заёмщика. Контракт
   * разрешает это только пока кампания в сборе — в том числе после дедлайна,
   * до закрытия: ровно для случаев «потерян доступ» и «биржа сменила адрес».
   */
  async setBorrowerWallet(id: string, walletId: string, actorId?: string) {
    const { campaign, onchainId } = await this.published(id);
    const wallet = campaign.borrower.wallets.find(
      (item) => item.id === walletId,
    );
    if (!wallet) {
      throw new NotFoundException('Такого кошелька у заёмщика нет');
    }

    const deal = await this.solana.deal(onchainId);
    if (!deal) throw new NotFoundException('Сделки нет в контракте');
    if (deal.state !== 'funding') {
      throw new BadRequestException(
        'Кошелёк получения можно менять только пока идёт сбор',
      );
    }

    let signature: string;
    try {
      signature = await this.solana.setBorrowerWallet(
        onchainId,
        wallet.address,
      );
    } catch (error) {
      throw new BadRequestException(explainFailure(error).reason);
    }

    await this.prisma.campaign.update({
      where: { id },
      data: { walletId: wallet.id, payoutWallet: wallet.address },
    });
    if (actorId) {
      await this.prisma.adminAction.create({
        data: {
          actorId,
          action: 'setBorrowerWallet',
          target: campaign.id,
          signature,
        },
      });
    }
    await this.events.sync(campaign.id, onchainId).catch(() => 0);
    return this.onchain(id);
  }

  // ── Дефолт и взыскание ───────────────────────────────────────────────────

  /**
   * Объявляет дефолт. Порог считаем тем же зеркалом, что и контракт: отказ с
   * числом дней понятнее, чем `DefaultThresholdNotReached` из сети.
   */
  async markDefault(id: string, actorId?: string) {
    const { campaign, onchainId } = await this.published(id);
    const deal = await this.deal(onchainId);
    const now = Math.floor(Date.now() / 1000);

    if (deal.state !== 'active') {
      throw new BadRequestException(
        deal.state === 'default'
          ? 'Дефолт уже объявлен'
          : 'Дефолт объявляют только по действующему займу',
      );
    }
    const days = daysPastDue(deal, now);
    if (days < campaign.defaultThresholdDays) {
      throw new BadRequestException(
        `Просрочка ${days} дней из ${campaign.defaultThresholdDays}: до порога дефолта ещё рано`,
      );
    }

    const signature = await this.send(() => this.solana.markDefault(onchainId));
    await this.log(actorId, 'markDefault', campaign.id, signature);
    // Право требования никуда не делось — у бумаги меняется статус, но она
    // остаётся у держателей до конца взыскания.
    await this.bonds.setDefaulted(campaign.id, true);
    await this.events.sync(campaign.id, onchainId).catch(() => 0);
    return this.onchain(id);
  }

  /** Записывает расходы на взыскание: суммы складываются. */
  async recordRecoveryCost(id: string, amount: bigint, actorId?: string) {
    const { campaign, onchainId } = await this.published(id);
    const deal = await this.deal(onchainId);
    if (deal.state !== 'default') {
      throw new BadRequestException(
        'Расходы на взыскание учитываются только после объявления дефолта',
      );
    }
    if (amount <= 0n) {
      throw new BadRequestException('Сумма расходов должна быть больше нуля');
    }

    const signature = await this.send(() =>
      this.solana.recordRecoveryCost(onchainId, amount),
    );
    await this.log(actorId, 'recordRecoveryCost', campaign.id, signature);
    await this.events.sync(campaign.id, onchainId).catch(() => 0);
    return this.onchain(id);
  }

  /**
   * Проводит поступление по взысканному займу. В дефолте контракт принимает
   * только оператора — чтобы расходы на взыскание успели попасть в учёт до
   * распределения, а не после.
   */
  async recoveryPayment(id: string, actorId?: string) {
    const { campaign, onchainId, mint } = await this.published(id);
    const deal = await this.deal(onchainId);
    if (deal.state !== 'default') {
      throw new BadRequestException('Заём не в дефолте');
    }

    const address = this.solana.repayAddress(onchainId, mint);
    const before = await this.solana.tokenBalance(address);
    if (before === 0n) {
      throw new BadRequestException('На адресе погашения пусто');
    }

    const signature = await this.send(() =>
      this.solana.processRepayment(onchainId, mint, { asOperator: true }),
    );
    await this.log(actorId, 'recoveryPayment', campaign.id, signature);
    await this.events.sync(campaign.id, onchainId).catch(() => 0);
    return this.onchain(id);
  }

  /**
   * Отменяет сбор. Нужна для случая «перевести заёмщику невозможно»: деньги
   * остаются в волте, и каждый инвестор забирает свой взнос сам.
   */
  async cancel(id: string, actorId?: string) {
    const { campaign, onchainId } = await this.published(id);
    const deal = await this.deal(onchainId);
    const blocker = cancelBlock(deal, campaign.cancelGraceDays);
    if (blocker) throw new BadRequestException(blocker);

    const signature = await this.send(() =>
      this.solana.cancelCampaign(onchainId),
    );
    await this.log(actorId, 'cancelCampaign', campaign.id, signature);
    await this.events.sync(campaign.id, onchainId).catch(() => 0);
    return this.onchain(id);
  }

  // ── Вспомогательное ──────────────────────────────────────────────────────

  /** Отправка в сеть с переводом кодов контракта в человеческий текст. */
  private async send(call: () => Promise<string>): Promise<string> {
    try {
      return await call();
    } catch (error) {
      this.logger.error(`Операция в сети не прошла: ${String(error)}`);
      throw new BadRequestException(explainFailure(error).reason);
    }
  }

  private log(
    actorId: string | undefined,
    action: string,
    target: string,
    signature: string,
  ) {
    if (!actorId) return Promise.resolve(null);
    return this.prisma.adminAction.create({
      data: { actorId, action, target, signature },
    });
  }

  private async deal(onchainId: bigint) {
    const deal = await this.solana.deal(onchainId);
    if (!deal) throw new NotFoundException('Сделки нет в контракте');
    return deal;
  }

  /** Опубликованная кампания с номером и токеном: без них в сети делать нечего. */
  private async published(id: string) {
    const campaign = await this.get(id);
    if (
      campaign.state !== CampaignState.PUBLISHED ||
      !campaign.onchainId ||
      !campaign.mint
    ) {
      throw new BadRequestException('Кампания ещё не опубликована');
    }
    return {
      campaign,
      onchainId: BigInt(campaign.onchainId.toString()),
      mint: campaign.mint,
    };
  }

  private recordTx(campaignId: string, stage: PublishStage, signature: string) {
    return this.prisma.campaignTx.create({
      data: { campaignId, stage, signature },
    });
  }

  private assertDraft(campaign: Campaign) {
    if (campaign.state === CampaignState.PUBLISHED) {
      throw new ConflictException(
        'Кампания опубликована: контракт не позволяет менять условия после фиксации графика',
      );
    }
  }

  /** Чего не хватает для расчёта графика — текст показываем админу. */
  private missingForSchedule(campaign: Campaign): string | null {
    if (!campaign.softCap || !campaign.hardCap)
      return 'Укажите минимальную и максимальную сумму сбора';
    if (!campaign.annualRateBps) return 'Укажите годовую ставку';
    if (!campaign.periodCount) return 'Укажите число платежей';
    if (!campaign.firstDueAt) return 'Укажите дату первого платежа';
    return null;
  }

  private toData(dto: UpdateCampaignDto): Prisma.CampaignUncheckedUpdateInput {
    const data: Prisma.CampaignUncheckedUpdateInput = {};
    const money = [
      'softCap',
      'hardCap',
      'minTicket',
      'maxTicket',
      'bondFaceValue',
    ] as const;
    const dates = ['fundingStart', 'fundingDeadline', 'firstDueAt'] as const;

    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) continue;
      if ((money as readonly string[]).includes(key)) {
        (data as Record<string, unknown>)[key] = BigInt(value as string);
      } else if ((dates as readonly string[]).includes(key)) {
        (data as Record<string, unknown>)[key] = new Date(value as string);
      } else {
        (data as Record<string, unknown>)[key] = value;
      }
    }
    return data;
  }
}

export type { Schedule };

/**
 * Почему сбор пока нельзя закрыть. Проверяем теми же правилами, что и
 * контракт, чтобы объяснить причину до отправки транзакции.
 */
function closingBlock(
  deal: { state: string; fundingDeadline: number },
  now = Math.floor(Date.now() / 1000),
): string | null {
  if (deal.state === 'funding') {
    return now >= deal.fundingDeadline
      ? null
      : 'Сбор ещё идёт: закрыть его можно после дедлайна';
  }
  return deal.state === 'failed'
    ? 'Сбор уже закрыт как несостоявшийся'
    : 'Сбор уже закрыт';
}

/**
 * Почему сбор нельзя отменить прямо сейчас. Отмена доступна до дедлайна в
 * любой момент, а после — только когда прошёл льготный срок и закрыть сбор
 * так и не удалось: между этими окнами судьбу кампании решает `close_funding`.
 */
function cancelBlock(
  deal: { state: string; fundingDeadline: number },
  graceDays: number,
  now = Math.floor(Date.now() / 1000),
): string | null {
  if (deal.state !== 'funding') return 'Сбор уже закрыт';
  if (now < deal.fundingDeadline) return null;

  const graceEnd = deal.fundingDeadline + graceDays * 86_400;
  return now >= graceEnd
    ? null
    : `Сбор нужно сначала попробовать закрыть: отмена снова откроется через ${graceDays} дней после дедлайна`;
}
