import { Injectable, Logger } from '@nestjs/common';
import { CampaignState, KycStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SolanaService } from '../solana/solana.service.js';
import { PortfolioService } from '../investors/portfolio.service.js';
import { BondProgramService } from '../bonds/bond-program.service.js';
import { campaignStatus, overdueNow } from '../investors/campaign-status.js';
import { amountDue, daysPastDue } from '../borrowers/debt.js';

/** Ниже этого остатка ключ скоро перестанет подписывать операции. */
const LOW_SOL = 0.05;

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Выполняет чтение, которое может не получиться, и отдаёт запасное значение.
 * Ловит и отказ обещания, и исключение на самом вызове: задачи, считанные по
 * базе, не должны пропадать из-за недоступной сети.
 */
async function safely<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

export type TaskTone = 'danger' | 'warning' | 'info';

/**
 * Открытая задача: то, чего платформа ждёт от этого человека прямо сейчас.
 *
 * Это не лента событий. Лента копится и требует отметки «прочитано», а задача
 * появляется сама, когда условие наступило, и исчезает сама, когда действие
 * сделано. Поэтому у неё нет ни идентификатора записи, ни состояния «просмотрено».
 */
export interface Task {
  /** Устойчивый код: по нему фронт ничего не решает, но тесты и журнал читаются. */
  key: string;
  title: string;
  /** Чем именно занят человек и почему это ждёт — одной строкой. */
  hint: string;
  /** Экран, где это делается. По нему же считается счётчик в меню. */
  href: string;
  count: number;
  tone: TaskTone;
  /** Срок, до которого дело надо сделать; есть не у всякой задачи. */
  deadline?: number | null;
}

/**
 * Что требует внимания — по ролям.
 *
 * Считается при каждом запросе и нигде не хранится: состояние займов живёт в
 * контракте, и своя копия тут же начала бы расходиться с ним. Дорогие чтения
 * собираются в один батч на все кампании, как это уже делает дашборд.
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly solana: SolanaService,
    private readonly portfolio: PortfolioService,
    private readonly bonds: BondProgramService,
  ) {}

  async list(userId: string, role: Role): Promise<Task[]> {
    try {
      if (role === Role.ADMIN) return await this.admin();
      if (role === Role.INVESTOR) return await this.investor(userId);
      if (role === Role.BORROWER) return await this.borrower(userId);
      return [];
    } catch (error: unknown) {
      // Список задач — подсказка, а не содержимое страницы: если сеть не
      // ответила, дашборд должен открыться пустым, а не сломаться.
      this.logger.warn(`Не удалось собрать задачи: ${String(error)}`);
      return [];
    }
  }

  // ── Админ ────────────────────────────────────────────────────────────────

  private async admin(): Promise<Task[]> {
    const [pendingKyc, pendingAddress, campaigns] = await Promise.all([
      this.prisma.investor.count({ where: { status: KycStatus.PENDING } }),
      this.prisma.investor.count({
        where: { pendingWithdrawalAddress: { not: null } },
      }),
      this.prisma.campaign.findMany({
        where: { state: CampaignState.PUBLISHED, onchainId: { not: null } },
        select: { id: true, title: true, onchainId: true, scheduleKind: true },
      }),
    ]);

    // Состояние займов живёт в сети, и RPC может не ответить. Это не повод
    // терять задачи, которые считаются по базе: заявку на смену адреса админ
    // должен увидеть и когда сеть лежит.
    const deals = await safely(
      () => this.solana.deals(campaigns.map((c) => BigInt(c.onchainId!))),
      new Map<string, Awaited<ReturnType<SolanaService['deal']>>>(),
    );
    const now = Math.floor(Date.now() / 1000);

    let toClose = 0;
    let overdue = 0;
    let worst = { title: '', days: 0, threshold: 0 };
    const bonds: { id: string; onchainId: bigint }[] = [];

    for (const campaign of campaigns) {
      if (campaign.scheduleKind === 'COUPON') {
        bonds.push({ id: campaign.id, onchainId: BigInt(campaign.onchainId!) });
      }

      const deal = deals.get(String(campaign.onchainId));
      if (!deal) continue;

      // Состояние считается по данным из сети, и на одной битой сделке
      // весь список задач терять нельзя: пропускаем её и идём дальше.
      try {
        const status = campaignStatus({
          dealState: deal.state,
          fundingDeadline: deal.fundingDeadline,
          overduePrincipal: overdueNow(deal, now),
          now,
        });
        if (status === 'FUNDING_ENDED') toClose += 1;
        if (status === 'OVERDUE' || status === 'DEFAULT') {
          overdue += 1;
          const days = daysPastDue(deal, now);
          if (days > worst.days) {
            worst = { title: campaign.title, days, threshold: 0 };
          }
        }
      } catch {
        this.logger.warn(`Состояние кампании ${campaign.id} не прочиталось`);
      }
    }

    const waiting = await this.pendingActions(bonds, now);
    const lowKeys = await this.lowBalanceKeys();

    const tasks: Task[] = [];
    const add = (task: Task) => {
      if (task.count > 0) tasks.push(task);
    };

    add({
      key: 'withdrawalAddress',
      title: 'Смена адреса вывода ждёт подтверждения',
      hint: 'Инвестор подал заявку: пока её не подтвердить, деньги уйдут на старый адрес',
      href: '/admin/investors',
      count: pendingAddress,
      tone: 'warning',
    });
    add({
      key: 'kyc',
      title: 'Анкеты на проверке',
      hint: 'Без решения инвестор не может вложиться',
      href: '/admin/investors',
      count: pendingKyc,
      tone: 'info',
    });
    add({
      key: 'overdue',
      title: 'Просрочка по займам',
      hint: worst.title
        ? `Дольше всех — «${worst.title}», ${worst.days} дн`
        : 'Заёмщики пропустили платежи',
      href: '/admin',
      count: overdue,
      tone: 'danger',
    });
    add({
      key: 'toClose',
      title: 'Сборы, которые пора закрыть',
      hint: 'Дедлайн прошёл, заём ещё не выдан',
      href: '/admin/campaigns',
      count: toClose,
      tone: 'warning',
    });
    add({
      key: 'actions',
      title: 'Корпоративные действия ждут шага',
      hint: 'Пора составить список держателей, записать исполнение или закрыть',
      // Когда ждёт один выпуск, ведём прямо в него: лишний экран между
      // «что от меня хотят» и кнопкой — это и есть то, из-за чего задачу
      // приходится искать руками.
      href: waiting.only ? `/admin/bonds/${waiting.only}` : '/admin/bonds',
      count: waiting.count,
      tone: 'warning',
    });
    add({
      key: 'sol',
      title: 'Заканчивается SOL на ключах',
      hint: 'Без него транзакции платформы перестанут проходить',
      href: '/admin/settings',
      count: lowKeys,
      tone: 'danger',
    });

    return tasks;
  }

  /**
   * Сколько действий стоят на стадии, с которой их пора двигать дальше, и
   * какой это выпуск, если он один. Те же правила, что у `nextStep` на
   * экране: иначе пометка и счётчик начнут расходиться.
   */
  private async pendingActions(
    bonds: { id: string; onchainId: bigint }[],
    now: number,
  ): Promise<{ count: number; only: string | null }> {
    let count = 0;
    const waiting = new Set<string>();

    for (const bond of bonds) {
      const actions = await safely(
        () => this.bonds.actions(bond.onchainId),
        [],
      );
      for (const action of actions) {
        const due =
          // Объявлено и дата фиксации наступила — можно составить список.
          (action.status === 'declared' && now >= action.recordTs) ||
          // Список составлен: ждёт исполнения, а у реестра без выплаты —
          // сразу закрытия.
          action.status === 'snapshot' ||
          // Исполнено, но не закрыто: шаг такой же недоделанный.
          action.status === 'settled';
        if (due) {
          count += 1;
          waiting.add(bond.id);
        }
      }
    }
    return {
      count,
      only: waiting.size === 1 ? [...waiting][0] : null,
    };
  }

  private async lowBalanceKeys(): Promise<number> {
    const platform = await safely(() => this.solana.platform(), null);
    if (!platform) return 0;

    // Казне SOL не нужен: она только принимает токены.
    const keys = [
      platform.admin,
      platform.operator,
      platform.whitelistAuthority,
    ];
    const balances = await Promise.all(
      keys.map((key) => safely(() => this.solana.solBalance(key), null)),
    );
    return balances.filter((sol) => sol !== null && sol < LOW_SOL).length;
  }

  // ── Инвестор ─────────────────────────────────────────────────────────────

  private async investor(userId: string): Promise<Task[]> {
    const investor = await this.prisma.investor.findUnique({
      where: { userId },
      select: { id: true, status: true, withdrawalAddress: true },
    });
    const tasks: Task[] = [];
    const add = (task: Task) => {
      if (task.count > 0) tasks.push(task);
    };

    if (!investor || investor.status !== KycStatus.APPROVED) {
      add({
        key: 'verification',
        title: 'Проверка личности не пройдена',
        hint: 'Смотреть кампании можно свободно, вкладываться — после проверки',
        href: '/investor/verification',
        count: 1,
        tone: 'info',
      });
      return tasks;
    }

    if (!investor.withdrawalAddress) {
      add({
        key: 'withdrawalAddress',
        title: 'Не задан адрес вывода',
        hint: 'Без него некуда перевести выплаты, а бумаги не выпускаются',
        href: '/investor/profile',
        count: 1,
        tone: 'warning',
      });
    }

    const [portfolio, votes] = await Promise.all([
      safely(() => this.portfolio.list(userId), null),
      this.openVotes(investor.id, investor.withdrawalAddress),
    ]);

    if (portfolio && portfolio.totals.available > 0n) {
      add({
        key: 'claim',
        title: 'Есть что забрать',
        hint: 'Деньги распределены в контракте и ждут вывода на ваш адрес',
        href: '/investor/portfolio',
        count: 1,
        tone: 'info',
      });
    }

    // У голосования, в отличие от выплаты, есть срок: не успел — решат без
    // тебя, и твои бумаги в кворум не попадут. Поэтому срок в самой задаче,
    // а в последние сутки она становится красной.
    const closingSoon =
      votes.deadline !== null &&
      votes.deadline - Math.floor(Date.now() / 1000) < DAY_SECONDS;
    add({
      key: 'vote',
      title: 'Открыто голосование держателей',
      hint: 'Вес вашего голоса — бумаги на дату фиксации; без голоса решат за вас',
      href: '/investor/bonds',
      count: votes.count,
      tone: closingSoon ? 'danger' : 'warning',
      deadline: votes.deadline,
    });

    return tasks;
  }

  /**
   * Голосования, где держатель есть в списке, но ещё не голосовал. Считаем по
   * базе: список держателей и бюллетени лежат у нас, в сеть ходить незачем.
   */
  private async openVotes(
    investorId: string,
    address: string | null,
  ): Promise<{ count: number; deadline: number | null }> {
    if (!address) return { count: 0, deadline: null };

    const snapshots = await this.prisma.bondSnapshot.findMany({
      // Только голосования и только те, где этот держатель ещё не голосовал.
      // По купонному снимку от него ничего не ждут.
      where: { kind: 'vote', votes: { none: { investorId } } },
      select: { holders: true, paymentTs: true },
    });
    const mine = snapshots.filter((snapshot) =>
      (snapshot.holders as { holder: string }[] | null)?.some(
        (row) => row.holder === address,
      ),
    );
    // Ближайший срок: он и решает, насколько это срочно.
    const deadlines = mine
      .map((snapshot) => snapshot.paymentTs)
      .filter((ts) => ts > 0);
    return {
      count: mine.length,
      deadline: deadlines.length ? Math.min(...deadlines) : null,
    };
  }

  // ── Заёмщик ──────────────────────────────────────────────────────────────

  private async borrower(userId: string): Promise<Task[]> {
    const borrower = await this.prisma.borrower.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (!borrower) return [];

    const campaigns = await this.prisma.campaign.findMany({
      where: {
        borrowerId: borrower.id,
        state: CampaignState.PUBLISHED,
        onchainId: { not: null },
      },
      select: { id: true, title: true, onchainId: true, mint: true },
    });

    const deals = await safely(
      () => this.solana.deals(campaigns.map((c) => BigInt(c.onchainId!))),
      new Map<string, Awaited<ReturnType<SolanaService['deal']>>>(),
    );
    const now = Math.floor(Date.now() / 1000);

    let due = 0;
    let late = 0;
    let extra = 0;

    for (const campaign of campaigns) {
      const deal = deals.get(String(campaign.onchainId));
      if (!deal || !campaign.mint) continue;
      if (deal.state !== 'active' && deal.state !== 'default') continue;

      const owed = amountDue(deal, now);
      if (owed.total > 0n) {
        due += 1;
        if (daysPastDue(deal, now) > 0) late += 1;
      }

      // Излишек на адресе погашения: деньги лежат и ничего не делают.
      const balance = await safely(
        () =>
          this.solana.tokenBalance(
            this.solana.repayAddress(
              BigInt(campaign.onchainId!),
              campaign.mint!,
            ),
          ),
        0n,
      );
      if (balance > owed.total) extra += 1;
    }

    const tasks: Task[] = [];
    if (due > 0) {
      tasks.push({
        key: 'payment',
        title: late > 0 ? 'Платёж просрочен' : 'Подходит платёж',
        hint:
          late > 0
            ? 'На просрочку идут проценты и пеня, а дальше — дефолт'
            : 'Переведите сумму на адрес погашения и нажмите «Я перевёл»',
        href: '/borrower/pay',
        count: due,
        tone: late > 0 ? 'danger' : 'info',
      });
    }
    if (extra > 0) {
      tasks.push({
        key: 'advance',
        title: 'На адресе погашения лежит излишек',
        hint: 'Он ждёт следующего платежа; можно зачесть его авансом',
        href: '/borrower/pay',
        count: extra,
        tone: 'info',
      });
    }
    return tasks;
  }
}
