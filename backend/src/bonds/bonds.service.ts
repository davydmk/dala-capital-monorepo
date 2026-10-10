import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CampaignState,
  ScheduleKind,
  VoteChoice,
  type Campaign,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SolanaService } from '../solana/solana.service.js';
import { uuidToBytes } from '../solana/user-id.js';
import { campaignStatus, overdueNow } from '../investors/campaign-status.js';
import {
  couponPerUnit,
  entitlements,
  redemptionPerUnit,
  registerHash,
  tallyVotes,
  unitsForInvestment,
  type BondTerms,
  type HolderRow,
} from './entitlements.js';
import {
  BondProgramService,
  type ActionKind,
  type BondRegistry,
} from './bond-program.service.js';

/** Кворум голосования: решение считается принятым от половины выпуска. */
const QUORUM_BPS = 5_000;

/**
 * Облигации и корпоративные действия.
 *
 * Бумага выпускается **только по купонной схеме**: кредит с аннуитетом живёт
 * как жил. Деньги здесь не ходят — купон и тело платит `dala_capital`, а эта
 * служба ведёт бумагу и журнал действий.
 */
@Injectable()
export class BondsService {
  private readonly logger = new Logger(BondsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly solana: SolanaService,
    private readonly bonds: BondProgramService,
  ) {}

  // ── Жизненный цикл бумаги ────────────────────────────────────────────────

  /**
   * Выпускает облигацию при публикации купонной кампании. Бумаг пока ноль:
   * они появляются у инвесторов по мере взносов.
   *
   * Тихо ничего не делает для кредитов и для уже выпущенных бумаг — так её
   * можно звать из публикации, не разбираясь в схеме на той стороне.
   */
  async issueForCampaign(campaignId: string): Promise<string | null> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { borrower: { select: { name: true } } },
    });
    if (!campaign || campaign.scheduleKind !== ScheduleKind.COUPON) return null;
    if (!campaign.onchainId || !campaign.mint) return null;

    const onchainId = BigInt(campaign.onchainId);
    if (await this.bonds.registry(onchainId)) return null;

    const faceValue = this.faceValue(campaign);
    const deal = await this.solana.deal(onchainId);
    if (!deal) throw new NotFoundException('Сделки нет в контракте');

    const signature = await this.bonds.issueBond(onchainId, {
      faceValue,
      couponRateBps: campaign.annualRateBps ?? 0,
      couponsPerYear: campaign.periodsPerYear,
      // Дата зрелости — последний платёж графика, он же возврат тела.
      maturityTs: deal.lastDueTs,
      maxSupply: deal.hardCap / faceValue,
      paymentMint: campaign.mint,
      // Название, тикер и ссылку задаёт админ в мастере; без них — по заёмщику.
      name: (campaign.bondName ?? `Dala Bond ${campaign.borrower.name}`).slice(
        0,
        32,
      ),
      symbol: (campaign.bondSymbol ?? `DALA${campaign.onchainId}`).slice(0, 10),
      uri:
        campaign.bondUri ?? `https://dala.capital/bonds/${campaign.onchainId}`,
    });
    this.logger.log(`Выпущена облигация по кампании ${campaignId}`);
    return signature;
  }

  /**
   * Выдаёт бумаги инвестору сразу после зачтённого взноса. Остаток от деления
   * на номинал бумагой не оформляется — он остаётся долей в контракте.
   *
   * Если адрес вывода ещё не задан, выпуск откладывается: бумага именная и
   * выпускать её некуда.
   */
  async mintForInvestment(
    campaignId: string,
    investorId: string,
    amount: bigint,
  ): Promise<void> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign || campaign.scheduleKind !== ScheduleKind.COUPON) return;
    if (!campaign.onchainId) return;

    const investor = await this.prisma.investor.findUnique({
      where: { id: investorId },
      select: { withdrawalAddress: true },
    });
    if (!investor?.withdrawalAddress) {
      this.logger.warn(
        `Бумаги по кампании ${campaignId} ждут адреса вывода инвестора ${investorId}`,
      );
      return;
    }

    const units = unitsForInvestment(amount, this.faceValue(campaign));
    if (units === 0n) return;

    await this.bonds
      .mintToHolder(
        BigInt(campaign.onchainId),
        investor.withdrawalAddress,
        units,
      )
      .catch((error: unknown) => {
        // Взнос уже зачтён в контракте: ронять из-за бумаги нельзя,
        // её можно довыпустить кранком.
        this.logger.error(
          `Не удалось выпустить бумаги по кампании ${campaignId}: ${String(error)}`,
        );
      });
  }

  /**
   * Адрес бумаги и ссылка на неё в обозревателе; пусто, если выпуска нет.
   * Нужна странице кампании: держатель должен дойти до своего токена, не
   * заходя в отдельный раздел.
   */
  async mintLink(
    onchainId: bigint,
  ): Promise<{ mint: string; url: string } | null> {
    const registry = await this.bonds.registry(onchainId);
    if (!registry) return null;
    return {
      mint: registry.mint,
      url: this.bonds.explorerToken(registry.mint),
    };
  }

  /** Сжигает бумаги при возврате взноса: несостоявшийся сбор или отмена. */
  async burnForRefund(campaignId: string, investorId: string): Promise<void> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign || campaign.scheduleKind !== ScheduleKind.COUPON) return;
    if (!campaign.onchainId) return;

    const investor = await this.prisma.investor.findUnique({
      where: { id: investorId },
      select: { withdrawalAddress: true },
    });
    if (!investor?.withdrawalAddress) return;

    const onchainId = BigInt(campaign.onchainId);
    const units = await this.unitsOf(onchainId, investor.withdrawalAddress);
    if (units === 0n) return;

    await this.bonds
      .burnFromHolder(onchainId, investor.withdrawalAddress, units, false)
      .catch((error: unknown) =>
        this.logger.error(
          `Не удалось сжечь бумаги при возврате по ${campaignId}: ${String(error)}`,
        ),
      );
  }

  /**
   * Переносит бумаги инвестора на новый адрес вывода. Передавать их контракт
   * не умеет и не должен — бумага именная, — но регистратору доступны прожиг
   * и выпуск, а это тот же результат: сколько сожгли на старом адресе, столько
   * выпустили на новом, в обращении не изменилось ничего.
   *
   * Молчит, если переносить нечего. Ошибку наружу не отдаёт: адрес к этому
   * моменту уже сменён в контракте, и ронять смену из-за бумаги нельзя —
   * её довыпустят отдельно.
   */
  async moveBonds(from: string | null, to: string): Promise<void> {
    if (!from || from === to) return;

    // Идём по всем выпускам, а не только по тем, где у инвестора есть взнос:
    // бумага могла прийти и переносом с прошлого адреса.
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        scheduleKind: ScheduleKind.COUPON,
        state: CampaignState.PUBLISHED,
        onchainId: { not: null },
      },
      select: { id: true, onchainId: true },
    });

    for (const campaign of campaigns) {
      const onchainId = BigInt(campaign.onchainId!);
      try {
        const units = await this.unitsOf(onchainId, from);
        if (units === 0n) continue;
        await this.bonds.burnFromHolder(onchainId, from, units, false);
        await this.bonds.mintToHolder(onchainId, to, units);
        this.logger.log(
          `Бумаги по кампании ${campaign.id} перенесены на новый адрес вывода`,
        );
      } catch (error: unknown) {
        this.logger.error(
          `Не удалось перенести бумаги по кампании ${campaign.id}: ${String(error)}`,
        );
      }
    }
  }

  /**
   * Гасит бумаги всех держателей — кранк по реестру. Зовётся, когда заём
   * закрыт в `dala_capital`: деньги уже выплачены, бумага больше не нужна.
   */
  async redeemAll(campaignId: string): Promise<number> {
    const { onchainId } = await this.bondCampaign(campaignId);

    // Прожиг необратим, поэтому он разрешён только когда заём действительно
    // закрыт: деньги держателям уже выплачены, бумага больше ничего не
    // подтверждает. У действующего займа это стёрло бы право требования.
    const deal = await this.solana.deal(onchainId);
    if (!deal) throw new NotFoundException('Сделки нет в контракте');
    if (deal.state !== 'repaid') {
      throw new BadRequestException(
        deal.state === 'default'
          ? 'Бумаги гасятся после закрытия дела о взыскании, а не во время него'
          : 'Бумаги гасятся только после того, как заём полностью погашен',
      );
    }

    const holders = await this.bonds.holders(
      onchainId,
      await this.candidates(campaignId),
    );
    let burned = 0;
    for (const row of holders) {
      await this.bonds.burnFromHolder(onchainId, row.holder, row.units, true);
      burned += 1;
    }
    return burned;
  }

  /** Отражает дефолт на бумаге: право требования остаётся, статус меняется. */
  async setDefaulted(campaignId: string, defaulted: boolean): Promise<void> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign?.onchainId || campaign.scheduleKind !== ScheduleKind.COUPON) {
      return;
    }
    const onchainId = BigInt(campaign.onchainId);
    if (!(await this.bonds.registry(onchainId))) return;

    await this.bonds
      .setBondStatus(onchainId, defaulted)
      .catch((error: unknown) =>
        this.logger.error(
          `Не удалось сменить статус выпуска ${campaignId}: ${String(error)}`,
        ),
      );
  }

  // ── Корпоративные действия ───────────────────────────────────────────────

  /** Объявляет действие: дата фиксации назначается заранее. */
  async declare(
    campaignId: string,
    kind: ActionKind,
    recordTs: number,
    paymentTs: number,
    amountPerUnit?: bigint,
  ) {
    const { onchainId, registry } = await this.bondCampaign(campaignId);
    if (paymentTs < recordTs) {
      throw new BadRequestException(
        'Дата исполнения не может быть раньше даты фиксации',
      );
    }

    // У голосования сумма — общий бюджет взыскания, и считать его за платформу
    // неоткуда: расходы на юриста и пошлины знает тот, кто их понёс.
    if (kind === 'vote' && !amountPerUnit) {
      throw new BadRequestException(
        'У голосования нужен бюджет взыскания: это общая сумма на юриста, пошлины и оценку, а не на бумагу',
      );
    }

    const index = (await this.bonds.actions(onchainId)).length;
    // У реестра без выплаты суммы не бывает, что бы ни прислали. И второй даты
    // тоже: контракт требует её ≥ даты фиксации, так что приравниваем.
    const amount =
      kind === 'record'
        ? 0n
        : (amountPerUnit ?? this.defaultAmount(kind, registry));
    const settlementTs = kind === 'record' ? recordTs : paymentTs;
    const signature = await this.bonds.declareAction(
      onchainId,
      index,
      kind,
      recordTs,
      settlementTs,
      amount,
    );
    return { index, signature, amountPerUnit: amount };
  }

  /**
   * Снимает реестр держателей на дату фиксации: читает балансы из сети,
   * считает права, сохраняет список у себя и отправляет в сеть его хеш.
   *
   * Список хранится целиком, потому что балансы меняются — восстановить, кто
   * сколько держал на прошедшую дату, задним числом нельзя.
   */
  async snapshot(campaignId: string, index: number) {
    const { campaign, onchainId } = await this.bondCampaign(campaignId);
    const action = await this.bonds.action(onchainId, index);
    if (!action) throw new NotFoundException('Действие не найдено');
    if (action.status !== 'declared') {
      throw new BadRequestException('Реестр по этому действию уже снят');
    }
    if (Math.floor(Date.now() / 1000) < action.recordTs) {
      throw new BadRequestException(
        'Дата фиксации ещё не наступила: реестр снимается на неё, а не раньше',
      );
    }

    const rows: HolderRow[] = await this.bonds.holders(
      onchainId,
      await this.candidates(campaign.id),
    );
    // У голосования сумма действия — общий бюджет взыскания, а не выплата на
    // бумагу: множить его на число бумаг нельзя. Реестр голосования фиксирует,
    // кто и с каким весом голосует, а бюджет лежит в самом действии.
    const result = entitlements(
      rows,
      action.kind === 'vote' ? 0n : action.amountPerUnit,
    );
    const hash = registerHash(action.recordTs, result.rows);

    const signature = await this.bonds.recordSnapshot(
      onchainId,
      index,
      result.holders,
      result.units,
      result.total,
      hash,
    );

    await this.prisma.bondSnapshot.upsert({
      where: {
        campaignId_actionIndex: { campaignId: campaign.id, actionIndex: index },
      },
      create: {
        campaignId: campaign.id,
        actionIndex: index,
        kind: action.kind,
        recordTs: action.recordTs,
        paymentTs: action.paymentTs,
        holders: result.rows.map((row) => ({
          holder: row.holder,
          tokenAccount: row.tokenAccount,
          units: row.units.toString(),
          amount: row.amount.toString(),
        })),
        units: result.units,
        totalAmount: result.total,
        hash: hash.toString('hex'),
      },
      update: {},
    });

    return { signature, ...result, hash: hash.toString('hex') };
  }

  /**
   * Отмечает действие исполненным. У выплаты к записи прикладывается подпись
   * расчётной транзакции из `dala_capital`, у голосования — его итог.
   *
   * Подпись не спрашивается у админа: деньги держателям платит заёмщик через
   * `dala_capital`, платформа сама провела эту транзакцию и знает её подпись.
   */
  async settle(campaignId: string, index: number, settlement?: string) {
    const { campaign, onchainId } = await this.bondCampaign(campaignId);
    const action = await this.bonds.action(onchainId, index);
    if (!action) throw new NotFoundException('Действие не найдено');

    let votesFor = 0n;
    let votesAgainst = 0n;
    if (action.kind === 'vote') {
      const tally = await this.tally(campaign.id, index, action.units);
      votesFor = tally.forUnits;
      votesAgainst = tally.againstUnits;
    } else {
      settlement ??= await this.repaymentSignature(
        campaign.id,
        action.recordTs,
      );
    }

    const signature = await this.bonds.settleAction(
      onchainId,
      index,
      settlement ?? null,
      votesFor,
      votesAgainst,
    );
    return {
      signature,
      settlement: settlement ?? null,
      votesFor,
      votesAgainst,
    };
  }

  /**
   * Подпись платежа, которым расчёт и был проведён: последний платёж заёмщика
   * после даты фиксации. Раньше неё платить держателям было не из чего, и
   * ссылаться на такой платёж значило бы выдать чужой расчёт за свой.
   */
  private async repaymentSignature(
    campaignId: string,
    recordTs: number,
  ): Promise<string | undefined> {
    const event = await this.prisma.campaignEvent.findFirst({
      where: {
        campaignId,
        name: 'RepaymentProcessed',
        blockTime: { gte: new Date(recordTs * 1000) },
      },
      orderBy: [{ slot: 'desc' }, { index: 'desc' }],
      select: { signature: true },
    });
    return event?.signature;
  }

  async close(campaignId: string, index: number) {
    const { onchainId } = await this.bondCampaign(campaignId);
    return { signature: await this.bonds.closeAction(onchainId, index) };
  }

  // ── Голосование ──────────────────────────────────────────────────────────

  /**
   * Голос держателя. Вес берётся из снятого реестра, а не из текущего
   * баланса: иначе можно было бы проголосовать, вернуть бумаги и остаться
   * с голосом.
   */
  async vote(
    userId: string,
    campaignId: string,
    index: number,
    choice: VoteChoice,
  ) {
    const investor = await this.prisma.investor.findUnique({
      where: { userId },
      select: { id: true, withdrawalAddress: true },
    });
    if (!investor?.withdrawalAddress) {
      throw new ForbiddenException('Голосуют только держатели бумаг');
    }

    const snapshot = await this.prisma.bondSnapshot.findUnique({
      where: { campaignId_actionIndex: { campaignId, actionIndex: index } },
    });
    if (!snapshot) {
      throw new BadRequestException(
        'Реестр на дату фиксации ещё не снят — голосовать не по чему',
      );
    }

    const rows = snapshot.holders as { holder: string; units: string }[];
    const mine = rows.find((row) => row.holder === investor.withdrawalAddress);
    if (!mine) {
      throw new ForbiddenException(
        'На дату фиксации у вас не было бумаг этого выпуска',
      );
    }

    await this.prisma.bondVote.upsert({
      where: {
        snapshotId_investorId: {
          snapshotId: snapshot.id,
          investorId: investor.id,
        },
      },
      create: {
        snapshotId: snapshot.id,
        investorId: investor.id,
        choice,
        weight: BigInt(mine.units),
      },
      update: { choice },
    });

    return this.tally(campaignId, index, BigInt(snapshot.units));
  }

  /** Итог голосования: вес в бумагах, явка и кворум. */
  async tally(campaignId: string, index: number, units: bigint) {
    const snapshot = await this.prisma.bondSnapshot.findUnique({
      where: { campaignId_actionIndex: { campaignId, actionIndex: index } },
      include: { votes: true },
    });
    const votes = (snapshot?.votes ?? []).map((vote) => ({
      choice: vote.choice,
      weight: vote.weight,
    }));
    return tallyVotes(votes, units, QUORUM_BPS);
  }

  // ── Чтение ───────────────────────────────────────────────────────────────

  /** Все выпуски платформы: для экрана админа. */
  async list() {
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        scheduleKind: ScheduleKind.COUPON,
        state: CampaignState.PUBLISHED,
        onchainId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        onchainId: true,
        mintDecimals: true,
        borrower: { select: { id: true, name: true } },
      },
    });

    // Состояние займа нужно, чтобы отличить аннулированный выпуск от пустого:
    // в контракте бумаги статуса «сбор не состоялся» нет, он виден только тут.
    const deals = await this.solana
      .deals(campaigns.map((campaign) => BigInt(campaign.onchainId!)))
      .catch(
        () => new Map<string, Awaited<ReturnType<SolanaService['deal']>>>(),
      );

    const rows = await Promise.all(
      campaigns.map(async (campaign) => {
        const registry = await this.bonds.registry(BigInt(campaign.onchainId!));
        if (!registry) return null;
        const actions = await this.bonds.actions(BigInt(campaign.onchainId!));
        return {
          ...registry,
          dealState: deals.get(String(campaign.onchainId))?.state ?? 'unknown',
          // Номер кампании в контракте у реестра тоже есть, но наружу нужен
          // наш идентификатор: по нему открывается экран.
          campaignId: campaign.id,
          onchainId: registry.campaignId,
          title: campaign.title,
          borrower: campaign.borrower,
          mintDecimals: campaign.mintDecimals,
          actions: actions.length,
          /** Ближайшее незакрытое действие — то, что требует внимания. */
          pending: actions.find((item) => item.status !== 'closed') ?? null,
          /**
           * Часы платформы. Нужны экрану, чтобы сказать, пора ли уже делать
           * шаг: своё время браузера тут брать нельзя — разойдётся с тем, по
           * которому решает контракт.
           */
          now: Math.floor(Date.now() / 1000),
        };
      }),
    );
    return rows.filter((row): row is NonNullable<typeof row> => row !== null);
  }

  /** Один выпуск: условия, держатели и журнал действий. */
  async bond(campaignId: string) {
    const { campaign, onchainId, registry } =
      await this.bondCampaign(campaignId);
    const [holders, actions, deal] = await Promise.all([
      this.bonds.holders(onchainId, await this.candidates(campaign.id)),
      this.bonds.actions(onchainId),
      this.solana.deal(onchainId),
    ]);
    const now = Math.floor(Date.now() / 1000);

    const snapshots = await this.prisma.bondSnapshot.findMany({
      where: { campaignId: campaign.id },
      include: { votes: true },
    });

    return {
      campaign: {
        id: campaign.id,
        title: campaign.title,
        mintDecimals: campaign.mintDecimals,
      },
      registry,
      terms: this.terms(registry),
      couponPerUnit: couponPerUnit(this.terms(registry)),
      redemptionPerUnit: redemptionPerUnit(this.terms(registry)),
      mintUrl: this.bonds.explorerToken(registry.mint),
      status: deal
        ? campaignStatus({
            dealState: deal.state,
            fundingDeadline: deal.fundingDeadline,
            overduePrincipal: overdueNow(deal, now),
            now,
          })
        : 'UNKNOWN',
      /** Состояние займа в `dala_capital`: от него зависит, можно ли гасить. */
      dealState: deal?.state ?? 'unknown',
      /** Пусто — бумаги можно гасить; иначе почему нельзя. */
      redeemBlock: redeemBlock(deal?.state, registry.outstanding),
      /**
       * График займа: из него подставляются даты корпоративных действий —
       * купон платится в дату платежа, а не в произвольный день.
       */
      schedule: (deal?.periods ?? []).map((period, index) => {
        // Суммы платежей считает `build_schedule` при закрытии сбора: пока
        // они нули, график ещё не рассчитан и оплаченным ничего не считаем.
        const due = period.principalAmount + period.interestAmount;
        return {
          index: index + 1,
          dueTs: period.dueTs,
          paid: due > 0n && period.principalPaid + period.interestPaid >= due,
        };
      }),
      holders: holders.map((row) => ({
        ...row,
        url: this.bonds.explorerAddress(row.tokenAccount),
      })),
      actions: actions.map((action) => {
        const snapshot = snapshots.find(
          (item) => item.actionIndex === action.index,
        );
        // Подсчёт по бюллетеням платформы. В сети `votes_for`/`votes_against`
        // появляются только при исполнении, а решать, пора ли его записывать,
        // админ должен раньше — по тому, что уже наголосовали.
        const live = tallyVotes(
          (snapshot?.votes ?? []).map((vote) => ({
            choice: vote.choice,
            weight: vote.weight,
          })),
          action.units,
          QUORUM_BPS,
        );
        return {
          ...action,
          settlementUrl: action.settlement
            ? this.bonds.explorerTx(action.settlement)
            : null,
          /** Голоса видно только после снятия реестра — они к нему и привязаны. */
          votes: snapshot?.votes.length ?? 0,
          liveFor: live.forUnits,
          liveAgainst: live.againstUnits,
          liveTurnoutBps: live.turnoutBps,
          liveQuorumReached: live.quorumReached,
          /** Правило кворума: держатель должен знать его до голосования. */
          quorumBps: QUORUM_BPS,
        };
      }),
      now,
    };
  }

  /** Бумаги инвестора по всем выпускам. */
  async myBonds(userId: string) {
    const investor = await this.prisma.investor.findUnique({
      where: { userId },
      select: { id: true, withdrawalAddress: true },
    });
    if (!investor?.withdrawalAddress) return { rows: [], now: nowTs() };

    const campaigns = await this.prisma.campaign.findMany({
      where: {
        scheduleKind: ScheduleKind.COUPON,
        state: CampaignState.PUBLISHED,
        onchainId: { not: null },
      },
      select: {
        id: true,
        title: true,
        mintDecimals: true,
        onchainId: true,
        createdAt: true,
        borrower: { select: { id: true, name: true } },
        // Последний зачтённый взнос этого инвестора: по нему сортируем.
        deposits: {
          where: { investorId: investor.id },
          select: {
            credits: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { createdAt: true },
            },
          },
        },
      },
    });

    // То же, что и в списке у админа: по состоянию займа виден сбор,
    // который не состоялся, — в контракте бумаги такого статуса нет.
    const deals = await this.solana
      .deals(campaigns.map((campaign) => BigInt(campaign.onchainId!)))
      .catch(
        () => new Map<string, Awaited<ReturnType<SolanaService['deal']>>>(),
      );

    const rows = await Promise.all(
      campaigns.map(async (campaign) => {
        const onchainId = BigInt(campaign.onchainId!);
        const registry = await this.bonds.registry(onchainId);
        if (!registry) return null;

        const units = await this.unitsOf(
          onchainId,
          investor.withdrawalAddress!,
        );
        const actions = await this.bonds.actions(onchainId);
        // Берём все голоса, а не только свои: держателю нужен текущий итог,
        // чтобы понимать, к чему идёт дело. В сети `votes_for`/`votes_against`
        // появляются только при исполнении, до него там честные нули.
        const snapshots = await this.prisma.bondSnapshot.findMany({
          where: { campaignId: campaign.id },
          include: { votes: true },
        });
        if (units === 0n && snapshots.length === 0) return null;

        const terms = this.terms(registry);
        return {
          campaignId: campaign.id,
          /** Дата последнего взноса; без взносов — дата кампании. */
          joinedAt:
            campaign.deposits[0]?.credits[0]?.createdAt ?? campaign.createdAt,
          title: campaign.title,
          borrower: campaign.borrower,
          mintDecimals: campaign.mintDecimals,
          mint: registry.mint,
          mintUrl: this.bonds.explorerToken(registry.mint),
          status: registry.status,
          dealState: deals.get(String(campaign.onchainId))?.state ?? 'unknown',
          units,
          faceValue: registry.faceValue,
          couponRateBps: registry.couponRateBps,
          couponsPerYear: registry.couponsPerYear,
          maturityTs: registry.maturityTs,
          /** Сколько придёт этому держателю одним купоном. */
          couponAmount: couponPerUnit(terms) * units,
          redemptionAmount: redemptionPerUnit(terms) * units,
          actions: actions.map((action) => {
            const snapshot = snapshots.find(
              (item) => item.actionIndex === action.index,
            );
            const mine = (
              snapshot?.holders as
                { holder: string; units: string }[] | undefined
            )?.find((row) => row.holder === investor.withdrawalAddress);
            // Текущий итог по базе: до исполнения он единственный настоящий,
            // после — должен совпасть с тем, что ушло в сеть.
            const live = tallyVotes(
              (snapshot?.votes ?? []).map((vote) => ({
                choice: vote.choice,
                weight: vote.weight,
              })),
              action.units,
              QUORUM_BPS,
            );
            return {
              ...action,
              /** Бумаг у держателя на дату фиксации — по ним и считается право. */
              myUnits: mine ? BigInt(mine.units) : 0n,
              myAmount: mine ? BigInt(mine.units) * action.amountPerUnit : 0n,
              myVote:
                snapshot?.votes.find((vote) => vote.investorId === investor.id)
                  ?.choice ?? null,
              canVote: action.kind === 'vote' && Boolean(mine),
              /** Подсчёт по бюллетеням платформы, пока итог не записан в сеть. */
              liveFor: live.forUnits,
              liveAgainst: live.againstUnits,
              liveTurnoutBps: live.turnoutBps,
              liveQuorumReached: live.quorumReached,
              /** Правило кворума: держатель должен знать его до голосования. */
              quorumBps: QUORUM_BPS,
            };
          }),
        };
      }),
    );

    return {
      // Свежие вложения сверху: о них держатель и помнит.
      rows: rows
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime()),
      now: nowTs(),
    };
  }

  /** Опубликованный реестр держателей: по нему любой пересчитает хеш. */
  async register(campaignId: string, index: number) {
    const snapshot = await this.prisma.bondSnapshot.findUnique({
      where: { campaignId_actionIndex: { campaignId, actionIndex: index } },
    });
    if (!snapshot) throw new NotFoundException('Реестр ещё не снят');
    return {
      recordTs: snapshot.recordTs,
      units: snapshot.units,
      totalAmount: snapshot.totalAmount,
      hash: snapshot.hash,
      holders: snapshot.holders,
    };
  }

  // ── Вспомогательное ──────────────────────────────────────────────────────

  private terms(registry: BondRegistry): BondTerms {
    return {
      faceValue: registry.faceValue,
      couponRateBps: registry.couponRateBps,
      couponsPerYear: registry.couponsPerYear,
      maturityTs: registry.maturityTs,
    };
  }

  /**
   * Сумма на бумагу по умолчанию: купон и погашение считаются из условий
   * выпуска. У голосования сумма общая и приходит от админа, у реестра без
   * выплаты её нет вовсе — сюда они не попадают.
   */
  private defaultAmount(kind: ActionKind, registry: BondRegistry): bigint {
    const terms = this.terms(registry);
    if (kind === 'coupon') return couponPerUnit(terms);
    if (kind === 'redemption') return redemptionPerUnit(terms);
    return 0n;
  }

  private faceValue(campaign: Campaign): bigint {
    const value = campaign.bondFaceValue ?? campaign.minTicket;
    if (!value || value <= 0n) {
      throw new BadRequestException(
        'У облигации должен быть номинал: задайте его в условиях выпуска',
      );
    }
    return value;
  }

  private async unitsOf(onchainId: bigint, holder: string): Promise<bigint> {
    const rows = await this.bonds.holders(onchainId, [holder]);
    return rows.find((row) => row.holder === holder)?.units ?? 0n;
  }

  /**
   * Кому платформа вообще могла выпустить бумаги по этой кампании: все, кто
   * открывал адрес пополнения и указал адрес вывода. Остатки по ним читаются
   * из сети — список лишь сужает, где смотреть.
   */
  private async candidates(campaignId: string): Promise<string[]> {
    const deposits = await this.prisma.campaignDeposit.findMany({
      where: { campaignId },
      select: { investor: { select: { withdrawalAddress: true } } },
    });
    return deposits
      .map((item) => item.investor.withdrawalAddress)
      .filter((address): address is string => Boolean(address));
  }

  /** Кампания с выпущенной бумагой: без неё корпоративных действий нет. */
  private async bondCampaign(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign?.onchainId || campaign.scheduleKind !== ScheduleKind.COUPON) {
      throw new NotFoundException('Облигация по этой кампании не выпускалась');
    }
    const onchainId = BigInt(campaign.onchainId);
    const registry = await this.bonds.registry(onchainId);
    if (!registry) {
      throw new NotFoundException('Облигация по этой кампании не выпускалась');
    }
    return { campaign, onchainId, registry };
  }
}

const nowTs = () => Math.floor(Date.now() / 1000);

/** Нужен сервису «мои бумаги»: позиции инвестора читаются по его UUID. */
export const investorBytes = uuidToBytes;

/**
 * Почему бумаги нельзя погасить прямо сейчас. Прожиг стирает подтверждение
 * права требования, поэтому он доступен ровно в одной точке — когда заём
 * закрыт и держателям всё выплачено.
 */
function redeemBlock(
  dealState: string | undefined,
  outstanding: bigint,
): string | null {
  if (outstanding === 0n) return 'Бумаг в обращении не осталось';
  if (dealState === 'repaid') return null;
  if (dealState === 'default') {
    return 'Идёт взыскание: бумаги гасятся после закрытия дела, а не во время него';
  }
  return 'Заём ещё не погашен — бумага подтверждает непогашенное право требования';
}
