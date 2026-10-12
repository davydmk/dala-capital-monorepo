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
import { investorTitle, type InvestorBrief } from '../investors/title.js';
import { explainFailure } from '../investors/deposit-errors.js';
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
  buildNotice,
  noticeAvailable,
  noticeFileName,
  EVENT_CODE,
  MANDATORY_CODE,
  type NoticeInput,
} from './mt564.js';
import {
  BondProgramService,
  type ActionKind,
  type BondRegistry,
} from './bond-program.service.js';

/** Excel ждёт разрыв строки Windows и BOM, иначе кириллица — кракозябры. */
const CRLF = '\r\n';
const BOM = '\ufeff';

/** Кворум голосования: решение считается принятым от половины выпуска. */
const QUORUM_BPS = 5_000;

/**
 * Шапка выписки из реестра. «Лицевой счёт» вместо «адреса» — не косметика: в
 * реестре у держателя именно лицевой счёт, и адрес Solana здесь ровно он.
 */
const REGISTER_COLUMNS = [
  '№',
  'Держатель',
  'Тип',
  'Страна',
  'Лицевой счёт',
  'Токен-счёт',
  'Бумаг',
  'Доля, %',
  'Причитается',
] as const;

const HOLDER_TYPE: Record<string, string> = {
  INDIVIDUAL: 'Физическое лицо',
  COMPANY: 'Юридическое лицо',
};

/**
 * Названия видов и статусов действий для выгрузки. На экране такие же
 * словари — это одни и те же слова в двух рантаймах: меняя здесь, поправьте
 * и `ACTION_KIND_TITLE` с `ACTION_STATUS_TITLE` на фронте, иначе журнал в
 * файле и журнал на экране назовут одно и то же по-разному.
 */
const ACTION_KIND_TITLE: Record<string, string> = {
  record: 'Реестр без выплаты',
  coupon: 'Купон',
  redemption: 'Погашение бумаг',
  vote: 'Голосование держателей',
  default: 'Дефолт',
  recovery: 'Взыскание',
};

const ACTION_STATUS_TITLE: Record<string, string> = {
  declared: 'Объявлено',
  snapshot: 'Список составлен',
  settled: 'Исполнено',
  closed: 'Закрыто',
};

/** Строка снимка: личность записана в момент составления, а не при чтении. */
interface SnapshotHolder {
  holder: string;
  tokenAccount: string;
  units: string;
  amount: string;
  investorId?: string | null;
  type?: string | null;
  title?: string | null;
  country?: string | null;
}

/** Дата для документа: без часового пояса читателя, он тут ни при чём. */
function utcStamp(unix: number): string {
  const iso = new Date(unix * 1000).toISOString();
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)} ${iso.slice(11, 16)} UTC`;
}

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
      // Пусто допустимо: бумага может выпускаться до присвоения кода.
      isin: campaign.bondIsin ?? '',
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

    // Последний держатель забрал взнос — выпуск аннулируется в сети. Раньше
    // этого момента нельзя: контракт не даст, пока бумаги на руках.
    await this.cancelIfEmpty(campaignId);
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
  async moveBonds(from: string | null, to: string): Promise<string[]> {
    if (!from || from === to) return [];
    const failed: string[] = [];

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
        // Одной транзакцией: прожиг и выпуск вместе. Двумя нельзя — если
        // вторая не подтвердится, бумаги окажутся сожжены и не выпущены.
        await this.bonds.moveHolder(onchainId, from, to, units);
        this.logger.log(
          `Бумаги по кампании ${campaign.id} перенесены на новый адрес вывода`,
        );
      } catch (error: unknown) {
        this.logger.error(
          `Не удалось перенести бумаги по кампании ${campaign.id}: ${String(error)}`,
        );
        failed.push(campaign.id);
      }
    }

    // Наружу отдаём список выпусков, по которым перенос не прошёл: смена
    // адреса уже состоялась, и молчать о расхождении нельзя — реестр
    // приводится в порядок сверкой.
    return failed;
  }

  /**
   * Сверяет реестр с долями в контракте и довыпускает недостающие бумаги.
   *
   * Нужна, когда перенос или выпуск при зачислении не довёл дело до конца:
   * таймаут подтверждения ничего не говорит о судьбе транзакции, а бумага —
   * доказательство права, и её отсутствие надо уметь исправить. Лишние
   * бумаги не прожигаются: это не ошибка связи, а повод разобраться руками.
   */
  async reconcile(campaignId: string) {
    const { campaign, onchainId, registry } =
      await this.bondCampaign(campaignId);
    if (registry.status !== 'active') {
      throw new BadRequestException(
        'Сверка возможна только у действующего выпуска: у погашенного и аннулированного бумаг быть не должно',
      );
    }

    const faceValue = registry.faceValue;
    const deposits = await this.prisma.campaignDeposit.findMany({
      where: { campaignId: campaign.id },
      select: {
        credits: { select: { amount: true } },
        investor: { select: { id: true, withdrawalAddress: true } },
      },
    });

    const rows: {
      holder: string;
      expected: bigint;
      actual: bigint;
      minted: bigint;
    }[] = [];
    for (const deposit of deposits) {
      const holder = deposit.investor.withdrawalAddress;
      if (!holder) continue;

      // Сколько бумаг держателю причитается: взнос, оформленный лотами по
      // номиналу. Остаток меньше лота бумагой не оформляется.
      const credited = deposit.credits.reduce(
        (sum, credit) => sum + credit.amount,
        0n,
      );
      const expected = faceValue > 0n ? credited / faceValue : 0n;
      const actual = await this.unitsOf(onchainId, holder);
      let minted = 0n;
      if (expected > actual) {
        minted = expected - actual;
        await this.bonds.mintToHolder(onchainId, holder, minted);
      }
      rows.push({ holder, expected, actual, minted });
    }

    const issued = rows.reduce((sum, row) => sum + row.minted, 0n);
    if (issued > 0n) {
      this.logger.warn(
        `Сверка реестра ${campaign.id}: довыпущено ${issued} бумаг`,
      );
    }
    return { rows, issued };
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
    if (holders.length === 0) {
      throw new BadRequestException(
        'Гасить нечего: бумаг в обращении не осталось',
      );
    }
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

  /**
   * Аннулирует выпуск, у которого не осталось бумаг. Нужно в двух случаях:
   * последний держатель забрал взнос — и размещение, на которое вообще не
   * было спроса. Во втором забирать некому, и без этого вызова выпуск навсегда
   * остался бы действующим с нулём бумаг в обращении.
   *
   * Молчит, если бумаги на руках: контракт такой выпуск не отпустит.
   */
  async cancelIfEmpty(campaignId: string): Promise<void> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign?.onchainId || campaign.scheduleKind !== ScheduleKind.COUPON) {
      return;
    }

    const onchainId = BigInt(campaign.onchainId);
    const registry = await this.bonds.registry(onchainId);
    if (
      !registry ||
      registry.status !== 'active' ||
      registry.outstanding > 0n
    ) {
      return;
    }

    await this.bonds
      .cancelBond(onchainId)
      .catch((error: unknown) =>
        this.logger.error(
          `Не удалось аннулировать выпуск ${campaignId}: ${String(error)}`,
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

    const people = await this.candidateMap(campaign.id);
    const rows: HolderRow[] = await this.bonds.holders(onchainId, [
      ...people.keys(),
    ]);
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
        // Личность пишется в снимок в момент составления, а не берётся из
        // анкеты при чтении: иначе выписка на прошлую дату показала бы
        // держателя под новым именем. В хеш эти поля не входят — он считается
        // по счетам, бумагам и суммам.
        holders: result.rows.map((row) => {
          const investor = people.get(row.holder);
          return {
            holder: row.holder,
            tokenAccount: row.tokenAccount,
            units: row.units.toString(),
            amount: row.amount.toString(),
            investorId: investor?.investorId ?? null,
            type: investor?.type ?? null,
            title: investor?.title ?? null,
            country: investor?.country ?? null,
          };
        }),
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

    let signature: string;
    try {
      signature = await this.bonds.settleAction(
        onchainId,
        index,
        settlement ?? null,
        votesFor,
        votesAgainst,
      );
    } catch (error) {
      // Контракт объясняет отказ сам — «Реестр по действию ещё не снят» и
      // прочее; отдавать вместо этого 500 значит прятать готовый ответ.
      throw new BadRequestException(explainFailure(error).reason);
    }
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
    const people = await this.candidateMap(campaign.id);
    const [holders, actions, deal] = await Promise.all([
      this.bonds.holders(onchainId, [...people.keys()]),
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
            overdue: overdueNow(deal, now),
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
      /**
       * Держатели поимённо: экран админа — это реестр, а не обозреватель
       * токенов. Строка без анкеты не выбрасывается: бумаги выпускаются
       * только на адреса инвесторов, и её отсутствие означает рассинхрон —
       * например, адрес вывода сменили, а бумаги за ним не переехали.
       */
      holders: holders.map((row) => ({
        ...row,
        url: this.bonds.explorerAddress(row.tokenAccount),
        investor: people.get(row.holder) ?? null,
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
          isin: registry.isin,
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

  /**
   * Список держателей таблицей. Разделитель — точка с запятой, в начале BOM:
   * иначе Excel откроет кириллицу кракозябрами, как и в графике платежей.
   */
  async registerCsv(
    campaignId: string,
    index: number,
    options: { full?: boolean; actorId?: string } = {},
  ) {
    const { campaign, registry } = await this.bondCampaign(campaignId);
    const snapshot = await this.prisma.bondSnapshot.findUnique({
      where: { campaignId_actionIndex: { campaignId, actionIndex: index } },
    });
    if (!snapshot) throw new NotFoundException('Список ещё не составлен');

    const rows = snapshot.holders as unknown as SnapshotHolder[];
    const money = (value: string) => {
      const unit = 10n ** BigInt(campaign.mintDecimals);
      const amount = BigInt(value);
      const fraction = (amount % unit)
        .toString()
        .padStart(campaign.mintDecimals, '0')
        .slice(0, 2);
      return `${amount / unit},${fraction}`;
    };
    /** Доля в выпуске: в выписке она есть всегда, считаем от бумаг снимка. */
    const share = (units: string) =>
      snapshot.units > 0n
        ? `${((Number(units) / Number(snapshot.units)) * 100).toFixed(2).replace('.', ',')}`
        : '0,00';

    // Расширенная выписка добавляет удостоверяющие данные. Они берутся из
    // анкеты на сейчас, а не из снимка: это нынешняя идентификация держателя,
    // и выдавать её за данные на дату фиксации нельзя — так и подписано.
    const documents = options.full
      ? await this.holderDocuments(rows)
      : new Map<string, string[]>();

    const head = options.full
      ? [...REGISTER_COLUMNS, 'Удостоверяющий документ', 'Дата рождения']
      : [...REGISTER_COLUMNS];

    const body = [
      ['Выпуск', campaign.title, 'ISIN', registry.isin || '—'].join(';'),
      [
        'Дата фиксации',
        utcStamp(snapshot.recordTs),
        'Хеш списка',
        snapshot.hash,
      ].join(';'),
      // Вопрос «а что мешает подменить имя» задают первым, поэтому ответ
      // стоит в самом документе, а не в пояснении рядом с ним.
      [
        'Хеш покрывает лицевые счёта, бумаги и суммы; имя и страна — атрибуты анкеты и в отпечаток не входят',
      ].join(';'),
      ...(options.full
        ? [['Удостоверяющие данные — по анкете на момент выгрузки'].join(';')]
        : []),
      '',
      head.join(';'),
      ...rows.map((row, position) =>
        [
          position + 1,
          row.title ?? 'Анкета не найдена',
          HOLDER_TYPE[row.type ?? ''] ?? '—',
          row.country ?? '—',
          row.holder,
          row.tokenAccount,
          row.units,
          share(row.units),
          money(row.amount),
          ...(options.full ? (documents.get(row.holder) ?? ['—', '—']) : []),
        ].join(';'),
      ),
      [
        'Итого',
        '',
        '',
        '',
        '',
        '',
        snapshot.units.toString(),
        '100,00',
        money(String(snapshot.totalAmount)),
      ].join(';'),
    ].join(CRLF);

    if (options.full && options.actorId) {
      // Выгрузка персональных данных — действие, о котором должна остаться
      // запись: кто и по какому выпуску её сделал.
      await this.prisma.adminAction.create({
        data: {
          actorId: options.actorId,
          action: 'registerFullExport',
          target: `${campaign.id}:${index}`,
        },
      });
    }

    return {
      fileName: `register-${campaign.onchainId}-${index}${options.full ? '-full' : ''}.csv`,
      body: BOM + body + CRLF,
    };
  }

  /**
   * Удостоверяющие данные держателей для расширенной выписки. ИИН и БИН в
   * анкете нет и для офшорных держателей не будет: у человека это тип и номер
   * документа, у компании — регистрационный номер.
   */
  private async holderDocuments(
    rows: SnapshotHolder[],
  ): Promise<Map<string, string[]>> {
    const ids = rows
      .map((row) => row.investorId)
      .filter((id): id is string => Boolean(id));
    if (ids.length === 0) return new Map();

    const investors = await this.prisma.investor.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        type: true,
        idDocType: true,
        idDocNumber: true,
        registrationNumber: true,
        dob: true,
      },
    });

    const byId = new Map(investors.map((item) => [item.id, item]));
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const investor = row.investorId ? byId.get(row.investorId) : undefined;
      if (!investor) {
        map.set(row.holder, ['—', '—']);
        continue;
      }
      const document =
        investor.type === 'COMPANY'
          ? `Рег. номер ${investor.registrationNumber ?? '—'}`
          : `${investor.idDocType ?? 'Документ'} ${investor.idDocNumber ?? '—'}`;
      map.set(row.holder, [
        document,
        investor.dob ? investor.dob.toISOString().slice(0, 10) : '—',
      ]);
    }
    return map;
  }

  /**
   * Журнал корпоративных действий выпуска таблицей. Коды берём из того же
   * словаря, что и уведомление для депозитария: разойтись они не должны.
   */
  async journalCsv(campaignId: string) {
    const { campaign, onchainId, registry } =
      await this.bondCampaign(campaignId);
    const actions = await this.bonds.actions(onchainId);

    const money = (value: bigint) => {
      const unit = 10n ** BigInt(campaign.mintDecimals);
      const fraction = (value % unit)
        .toString()
        .padStart(campaign.mintDecimals, '0')
        .slice(0, 2);
      return `${value / unit},${fraction}`;
    };

    const body = [
      ['Выпуск', campaign.title, 'ISIN', registry.isin || '—'].join(';'),
      '',
      [
        '№',
        'Вид',
        'CAEV',
        'CAMV',
        'Статус',
        'Дата фиксации',
        'Дата исполнения',
        'На бумагу',
        'Держателей',
        'Бумаг',
        'Хеш списка',
        'Подпись расчёта',
      ].join(';'),
      ...[...actions]
        .sort((a, b) => a.index - b.index)
        .map((action) =>
          [
            action.index,
            ACTION_KIND_TITLE[action.kind] ?? action.kind,
            EVENT_CODE[action.kind] ?? '—',
            action.kind === 'record'
              ? '—'
              : (MANDATORY_CODE[action.kind] ?? '—'),
            ACTION_STATUS_TITLE[action.status] ?? action.status,
            utcStamp(action.recordTs),
            action.paymentTs ? utcStamp(action.paymentTs) : '—',
            // У голосования это бюджет взыскания целиком, а не выплата на
            // бумагу: подписываем в самой строке, чтобы не путать.
            action.kind === 'vote'
              ? `${money(action.amountPerUnit)} (бюджет)`
              : money(action.amountPerUnit),
            action.holders || '—',
            action.units ? action.units.toString() : '—',
            action.registerHash || '—',
            action.settlement ?? '—',
          ].join(';'),
        ),
    ].join(CRLF);

    return {
      fileName: `journal-${campaign.onchainId}.csv`,
      body: BOM + body + CRLF,
    };
  }

  /**
   * Уведомление о корпоративном действии в раскладке ISO 15022. Всё, что
   * нужно, уже лежит в записи действия и в реестре — считать нечего,
   * остаётся разложить по полям.
   */
  async notice(campaignId: string, index: number) {
    const { campaign, onchainId, registry } =
      await this.bondCampaign(campaignId);
    const action = await this.bonds.action(onchainId, index);
    if (!action) throw new NotFoundException('Действие не найдено');
    if (!noticeAvailable(action.kind)) {
      throw new BadRequestException(
        'У этого вида действия нет кода события по ISO 15022: выгружать нечего',
      );
    }

    const input: NoticeInput = {
      onchainId: onchainId.toString(),
      index,
      kind: action.kind,
      status: action.status,
      recordTs: action.recordTs,
      paymentTs: action.paymentTs,
      amountPerUnit: action.amountPerUnit,
      units: action.units,
      registerHash: action.registerHash,
      settlement: action.settlement,
      isin: registry.isin,
      title: campaign.title,
      mint: registry.mint,
      decimals: campaign.mintDecimals,
    };
    return { fileName: noticeFileName(input), body: buildNotice(input) };
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
    return [...(await this.candidateMap(campaignId)).keys()];
  }

  /**
   * Кто может оказаться держателем и кто это по анкете. Бумаги выпускаются
   * только на адреса вывода инвесторов и не передаются, поэтому связь
   * «адрес → человек» платформе известна всегда — регистратор по определению
   * знает держателей поимённо.
   */
  private async candidateMap(
    campaignId: string,
  ): Promise<Map<string, InvestorBrief>> {
    const deposits = await this.prisma.campaignDeposit.findMany({
      where: { campaignId },
      select: {
        investor: {
          select: {
            id: true,
            withdrawalAddress: true,
            type: true,
            companyName: true,
            firstName: true,
            lastName: true,
            country: true,
          },
        },
      },
    });

    const map = new Map<string, InvestorBrief>();
    for (const { investor } of deposits) {
      if (!investor.withdrawalAddress) continue;
      map.set(investor.withdrawalAddress, {
        investorId: investor.id,
        type: investor.type,
        title: investorTitle(investor),
        country: investor.country,
      });
    }
    return map;
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
