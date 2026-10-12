import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CampaignState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SolanaService, type OnchainDeal } from '../solana/solana.service.js';
import { campaignStatus, overdueNow } from '../investors/campaign-status.js';
import { explainFailure } from '../investors/deposit-errors.js';
import { EventsService } from '../investors/events.service.js';
import {
  amountDue,
  daysPastDue,
  defaultDebt,
  recoveryOutstanding,
  markedSchedule,
  nextPayment,
  outstandingPrincipal,
  totalOutstanding,
} from './debt.js';
import {
  partialWindow,
  prepaymentAllowed,
  quoteFull,
  quotePartial,
} from './prepayment.js';

/** Итог попытки провести поступление — то, что показываем после кнопки. */
export interface RepayResult {
  received: bigint;
  message: string;
}

/**
 * Кабинет заёмщика: свои займы, состояние долга и погашение.
 *
 * Заёмщик видит только кампании своей компании: связь идёт через
 * `Borrower.userId`, а не через роль в токене.
 */
@Injectable()
export class LoansService {
  private readonly logger = new Logger(LoansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly solana: SolanaService,
    private readonly events: EventsService,
  ) {}

  /** Свои займы: состояние, долг и ближайший платёж по каждому. */
  async list(userId: string) {
    const borrower = await this.borrower(userId);
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        borrowerId: borrower.id,
        state: CampaignState.PUBLISHED,
        onchainId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });

    const deals = await this.solana.deals(
      campaigns.map((campaign) => BigInt(campaign.onchainId!)),
    );
    const now = Math.floor(Date.now() / 1000);

    return campaigns
      .map((campaign) => {
        const deal = deals.get(String(campaign.onchainId));
        if (!deal) return null;
        const due = amountDue(deal, now);
        return {
          id: campaign.id,
          title: campaign.title,
          mintDecimals: campaign.mintDecimals,
          annualRateBps: campaign.annualRateBps,
          scheduleKind: campaign.scheduleKind,
          status: campaignStatus({
            dealState: deal.state,
            fundingDeadline: deal.fundingDeadline,
            overdue: overdueNow(deal, now),
            now,
          }),
          totalRaised: deal.totalRaised,
          softCap: deal.softCap,
          hardCap: deal.hardCap,
          fundingDeadline: deal.fundingDeadline,
          lastDueTs: deal.lastDueTs,
          outstanding: outstandingPrincipal(deal),
          due: due.total,
          daysPastDue: daysPastDue(deal, now),
          next: nextPayment(deal, now),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  /** Один заём целиком: долг с разбивкой, график с отметками, адрес погашения. */
  async page(userId: string, campaignId: string) {
    const { campaign, deal, onchainId, mint } = await this.loan(
      userId,
      campaignId,
    );
    const now = Math.floor(Date.now() / 1000);

    const repayAddress = this.solana.repayAddress(onchainId, mint).toBase58();
    const balance = await this.solana.tokenBalance(repayAddress);
    const due = amountDue(deal, now);
    const next = nextPayment(deal, now);

    return {
      campaign: {
        id: campaign.id,
        title: campaign.title,
        purpose: campaign.purpose,
        collateral: campaign.collateral,
        scheduleKind: campaign.scheduleKind,
        scheduleStep: campaign.scheduleStep,
        annualRateBps: campaign.annualRateBps,
        penaltyRateBps: campaign.penaltyRateBps,
        defaultThresholdDays: campaign.defaultThresholdDays,
        periodCount: campaign.periodCount,
        mint,
        mintDecimals: campaign.mintDecimals,
      },
      status: campaignStatus({
        dealState: deal.state,
        fundingDeadline: deal.fundingDeadline,
        overdue: overdueNow(deal, now),
        now,
      }),
      deal: {
        state: deal.state,
        totalRaised: deal.totalRaised,
        softCap: deal.softCap,
        hardCap: deal.hardCap,
        fundingDeadline: deal.fundingDeadline,
        lastDueTs: deal.lastDueTs,
        borrowerWallet: deal.borrowerWallet,
      },
      due,
      /**
       * Взыскание. После дефолта долг лежит в других полях: плановые проценты
       * ненаступивших платежей отменены, а весь остаток тела переведён в
       * просрочку. Расходы на взыскание заёмщик тоже обязан возместить, и
       * поступления закрывают их первыми.
       */
      recovery:
        deal.state === 'default'
          ? {
              ...defaultDebt(deal, now),
              costs: deal.recoveryCosts,
              outstanding: recoveryOutstanding(deal),
            }
          : null,
      /**
       * Момент, по состоянию на который контракт считал долг сам. Между ним и
       * `now` проценты с пенёй досчитаны на бэкенде теми же правилами.
       */
      accruedTo: deal.lastAccrualTs,
      next,
      outstanding: outstandingPrincipal(deal),
      totalOutstanding: totalOutstanding(deal, now),
      daysPastDue: daysPastDue(deal, now),
      schedule: markedSchedule(deal, now, campaign.defaultThresholdDays),
      repay: {
        address: repayAddress,
        url: this.solana.explorerAddress(repayAddress),
        balance,
        /**
         * Излишек, который можно зачесть в счёт будущих платежей. У закрытого
         * займа будущих платежей нет, и тот же остаток — уже переплата.
         */
        advance:
          deal.state === 'active' && balance > due.total
            ? balance - due.total
            : 0n,
        /**
         * Переплата закрытого займа: платить больше нечего, и её забирают
         * обратно на кошелёк получения.
         */
        excess: deal.state === 'repaid' ? balance : 0n,
      },
      /**
       * Досрочное погашение: разрешено ли, во что обойдётся полное и открыто
       * ли окно частичного. Считается теми же правилами, что и в контракте.
       */
      prepayment: {
        allowed: prepaymentAllowed(deal),
        feeBps: deal.prepaymentFeeBps,
        full: deal.state === 'active' ? quoteFull(deal, now) : null,
        partial: partialWindow(deal, now),
      },
      /** Часы платформы: время на странице считается по ним, а не по браузеру. */
      now,
    };
  }

  /**
   * Что будет, если погасить `amount` тела прямо сейчас: сумма к переводу и
   * новый график. Считается на бэкенде, чтобы формула жила в одном месте.
   */
  async prepayQuote(userId: string, campaignId: string, amount: bigint) {
    const { deal } = await this.loan(userId, campaignId);
    const now = Math.floor(Date.now() / 1000);
    const window = partialWindow(deal, now);
    if (amount <= 0n || amount > window.maxAmount) {
      throw new BadRequestException(
        window.maxAmount > 0n
          ? `Сумма должна быть больше нуля и не больше ${window.maxAmount} — остаток тела гасится полным погашением`
          : 'Частичное погашение сейчас недоступно',
      );
    }
    return { ...quotePartial(deal, amount, now), window, now };
  }

  /** Полное досрочное погашение: заём закрывается целиком. */
  prepayFull(userId: string, campaignId: string) {
    return this.prepay(userId, campaignId, null);
  }

  /** Частичное: гасится тело, график оставшихся платежей пересчитывается. */
  prepayPartial(userId: string, campaignId: string, amount: bigint) {
    return this.prepay(userId, campaignId, amount);
  }

  /**
   * Общее для обеих инструкций. Контракт тянет с адреса ровно посчитанную
   * сумму, поэтому проверяем остаток заранее: понятный отказ лучше
   * потраченной впустую транзакции.
   */
  private async prepay(
    userId: string,
    campaignId: string,
    amount: bigint | null,
  ) {
    const { deal, onchainId, mint } = await this.loan(userId, campaignId);
    if (!prepaymentAllowed(deal)) {
      throw new BadRequestException(
        'Условия этого займа не предусматривают досрочного погашения',
      );
    }
    if (deal.state !== 'active') {
      throw new BadRequestException(
        'Досрочно погасить можно только действующий заём',
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const needed =
      amount === null
        ? quoteFull(deal, now).total
        : quotePartial(deal, amount, now).total;
    const balance = await this.solana.tokenBalance(
      this.solana.repayAddress(onchainId, mint),
    );
    if (balance < needed) {
      return this.withResult(userId, campaignId, {
        received: 0n,
        message: `На адресе погашения ${balance} из ${needed}: досрочное погашение проводится целиком, доплатите недостающее и повторите`,
      });
    }

    let result: RepayResult;
    try {
      await (amount === null
        ? this.solana.prepayFull(onchainId, mint)
        : this.solana.prepayPartial(onchainId, mint, amount));
      const after = await this.solana.tokenBalance(
        this.solana.repayAddress(onchainId, mint),
      );
      result = {
        received: balance - after,
        message:
          amount === null
            ? 'Заём погашен досрочно и полностью'
            : 'Часть тела погашена досрочно, график пересчитан',
      };
    } catch (error) {
      const failure = explainFailure(error);
      this.logger.warn(
        `Досрочное погашение ${campaignId} не прошло: ${failure.code} — ${String(error)}`,
      );
      result = { received: 0n, message: failure.reason };
    }

    await this.events.sync(campaignId, onchainId).catch(() => 0);
    return this.withResult(userId, campaignId, result);
  }

  /**
   * Проводит поступление с адреса погашения обычным ключом. Контракт возьмёт
   * только то, что уже причитается: излишек останется ждать на адресе и не
   * превратится в аванс сам собой.
   */
  repay(userId: string, campaignId: string) {
    return this.process(userId, campaignId, false);
  }

  /**
   * Зачитывает излишек в счёт ненаступивших платежей. Такое контракт принимает
   * только от оператора — чтобы аванс появлялся по просьбе заёмщика, а не от
   * случайного вызова.
   */
  advance(userId: string, campaignId: string) {
    return this.process(userId, campaignId, true);
  }

  /**
   * Забирает переплату с адреса погашения. Пока заём идёт, излишек — аванс в
   * счёт будущих платежей, и контракт его не отдаёт; после закрытия займа
   * платить больше нечего, и без этого вызова деньги остались бы на PDA
   * навсегда. Уходят они на кошелёк получения — тот же, что принимал заём.
   */
  async withdrawExcess(userId: string, campaignId: string) {
    const { deal, onchainId, mint } = await this.loan(userId, campaignId);
    if (deal.state !== 'repaid') {
      throw new BadRequestException(
        'Переплату можно забрать только после закрытия займа: пока он идёт, она зачтётся в счёт будущих платежей',
      );
    }

    const address = this.solana.repayAddress(onchainId, mint);
    const before = await this.solana.tokenBalance(address);
    if (before === 0n) {
      return this.withResult(userId, campaignId, {
        received: 0n,
        message: 'Забирать нечего: на адресе погашения пусто',
      });
    }

    let result: RepayResult;
    try {
      await this.solana.withdrawRepayExcess(
        onchainId,
        mint,
        deal.borrowerWallet,
      );
      const after = await this.solana.tokenBalance(address);
      result = {
        received: before - after,
        message: 'Переплата отправлена на кошелёк получения',
      };
    } catch (error) {
      const failure = explainFailure(error);
      this.logger.warn(
        `Возврат переплаты по кампании ${campaignId} не прошёл: ${failure.code} — ${String(error)}`,
      );
      result = { received: 0n, message: failure.reason };
    }

    await this.events.sync(campaignId, onchainId).catch(() => 0);
    return this.withResult(userId, campaignId, result);
  }

  private async process(
    userId: string,
    campaignId: string,
    asOperator: boolean,
  ) {
    const { deal, onchainId, mint } = await this.loan(userId, campaignId);
    if (deal.state !== 'active') {
      throw new BadRequestException(
        deal.state === 'funding'
          ? 'Заём ещё не выдан: сбор не закрыт'
          : 'По этому займу платежи больше не принимаются',
      );
    }

    const address = this.solana.repayAddress(onchainId, mint);
    const before = await this.solana.tokenBalance(address);
    const now = Math.floor(Date.now() / 1000);
    const due = amountDue(deal, now);

    if (before === 0n) {
      return this.withResult(userId, campaignId, {
        received: 0n,
        message:
          'Поступлений пока нет. Перевод по сети идёт до минуты — загляните сюда чуть позже',
      });
    }
    if (!asOperator && due.total === 0n) {
      return this.withResult(userId, campaignId, {
        received: 0n,
        message:
          'Сейчас платить нечего: ближайший платёж ещё не наступил. Деньги дождутся его на адресе погашения',
      });
    }

    let result: RepayResult;
    try {
      await this.solana.processRepayment(onchainId, mint, { asOperator });
      const after = await this.solana.tokenBalance(address);
      result = {
        received: before - after,
        message: asOperator
          ? 'Излишек зачтён в счёт будущих платежей'
          : 'Платёж проведён',
      };
    } catch (error) {
      const failure = explainFailure(error);
      this.logger.warn(
        `Погашение кампании ${campaignId} не прошло: ${failure.code} — ${String(error)}`,
      );
      result = { received: 0n, message: failure.reason };
    }

    await this.events.sync(campaignId, onchainId).catch(() => 0);
    return this.withResult(userId, campaignId, result);
  }

  /** Карточка компании для профиля: только чтение, менять данные может админ. */
  async profile(userId: string) {
    const borrower = await this.prisma.borrower.findUnique({
      where: { userId },
      select: {
        id: true,
        name: true,
        bin: true,
        status: true,
        rating: true,
        industry: true,
        address: true,
        website: true,
        foundedAt: true,
        employees: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
        logoKey: true,
        wallets: {
          select: { id: true, label: true, address: true, isDefault: true },
          orderBy: { isDefault: 'desc' },
        },
      },
    });
    if (!borrower) throw new ForbiddenException('Кабинет заёмщика не привязан');
    return {
      ...borrower,
      wallets: borrower.wallets.map((wallet) => ({
        ...wallet,
        url: this.solana.explorerAddress(wallet.address),
      })),
    };
  }

  // ── Вспомогательное ──────────────────────────────────────────────────────

  private async withResult(
    userId: string,
    campaignId: string,
    result: RepayResult,
  ) {
    return { ...(await this.page(userId, campaignId)), result };
  }

  private async borrower(userId: string) {
    const borrower = await this.prisma.borrower.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!borrower) throw new ForbiddenException('Кабинет заёмщика не привязан');
    return borrower;
  }

  /** Заём своей компании. Чужая кампания для заёмщика просто не существует. */
  private async loan(userId: string, campaignId: string) {
    const borrower = await this.borrower(userId);
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (
      !campaign ||
      campaign.borrowerId !== borrower.id ||
      campaign.state !== CampaignState.PUBLISHED ||
      !campaign.onchainId ||
      !campaign.mint
    ) {
      throw new NotFoundException('Займ не найден');
    }

    const onchainId = BigInt(campaign.onchainId);
    const deal: OnchainDeal | null = await this.solana.deal(onchainId);
    if (!deal) throw new NotFoundException('Сделки нет в контракте');
    return { campaign, deal, onchainId, mint: campaign.mint };
  }
}
