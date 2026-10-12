/**
 * Сквозные тесты закрытия сбора и кабинета заёмщика.
 *
 * Сеть подменяем моделью контракта: она так же переводит наступившие платежи в
 * просрочку и так же решает судьбу сбора по собранной сумме — проверяем
 * поведение, а не заглушку. Главное, что здесь проверяется: заёмщик видит
 * только свои займы, а поступление проводится обычным ключом, и излишек не
 * превращается в аванс сам собой.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import {
  CampaignState,
  KycStatus,
  Role,
  ScheduleStep,
  UserStatus,
} from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SolanaService } from '../src/solana/solana.service.js';

const BORROWER = {
  email: 'e2e-l-borrower@example.com',
  password: 'пароль-заёмщика-длин',
};
const STRANGER = {
  email: 'e2e-l-stranger@example.com',
  password: 'пароль-чужого-длинны',
};
const ADMIN = {
  email: 'e2e-l-admin@example.com',
  password: 'пароль-админа-длинный',
};
const INVESTOR = {
  email: 'e2e-l-investor@example.com',
  password: 'пароль-инвестора-длин',
};
const EMAILS = [
  BORROWER.email,
  STRANGER.email,
  ADMIN.email,
  INVESTOR.email,
].sort();

/** Свои БИН: остальные спеки чистят заёмщиков по своим и снесли бы наших. */
const BIN = '250140000005';
const OTHER_BIN = '250140000006';
const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const WALLET = 'CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq';
const SPARE_WALLET = 'JCLPbcLwdYJs1UJgL6LK1nhYRUcGk5ziFPx55nVL9akB';
const REPAY = 'RepayAccount1111111111111111111111111111111';

const USDC = 1_000_000n;
const DAY = 24 * 60 * 60;

interface Period {
  dueTs: number;
  principalFraction: bigint;
  principalAmount: bigint;
  interestAmount: bigint;
  principalPaid: bigint;
  interestPaid: bigint;
}

type Deal = ReturnType<typeof fundingDeal>;

/** Сбор, дедлайн которого ещё не прошёл. */
function fundingDeal(raised: bigint, deadlineIn: number) {
  const now = Math.floor(Date.now() / 1000);
  return {
    state: 'funding',
    totalRaised: raised,
    periodCount: 2,
    scheduleFinalized: true,
    borrowerWallet: WALLET,
    fundingStart: now - 10 * DAY,
    fundingDeadline: now + deadlineIn,
    mint: MINT,
    softCap: 1_000n * USDC,
    hardCap: 2_000n * USDC,
    minTicket: 10n * USDC,
    maxTicket: 0n,
    lastDueTs: now + 30 * DAY,
    overduePrincipal: 0n,
    overdueScheduledInterest: 0n,
    extraInterest: 0n,
    penalty: 0n,
    interestCarry: 0n,
    penaltyCarry: 0n,
    lastAccrualTs: 0,
    annualRateBps: 1_000,
    penaltyRateBps: 2_000,
    periodsPerYear: 12,
    platformFeeBps: 200,
    defaultThresholdDays: 90,
    repayAccount: REPAY,
    defaultPrincipal: 0n,
    defaultInterest: 0n,
    recoveryCosts: 0n,
    recoveryReimbursed: 0n,
    scheduleType: 'annuity',
    prepaymentFeeBps: 100,
    nextPeriod: 0,
    periods: [] as Period[],
    accPrincipal: 0n,
    accInterest: 0n,
    accPenalty: 0n,
    accPrepaymentFee: 0n,
  };
}

/** Действующий заём: первый платёж наступил пять дней назад и не оплачен. */
function activeDeal(): Deal {
  const now = Math.floor(Date.now() / 1000);
  const deal = fundingDeal(1_000n * USDC, -10 * DAY);
  const period = (dueTs: number): Period => ({
    dueTs,
    principalFraction: 500_000_000_000n,
    principalAmount: 500n * USDC,
    interestAmount: 50n * USDC,
    principalPaid: 0n,
    interestPaid: 0n,
  });
  return {
    ...deal,
    state: 'active',
    lastAccrualTs: now - 10 * DAY,
    lastDueTs: now + 25 * DAY,
    periods: [period(now - 5 * DAY), period(now + 25 * DAY)],
  };
}

/** Заём без просрочки: первый платёж внесён час назад, окно частичного открыто. */
function paidUpDeal(): Deal {
  const now = Math.floor(Date.now() / 1000);
  const deal = fundingDeal(900n * USDC, -10 * DAY);
  const period = (dueTs: number, paid: boolean): Period => ({
    dueTs,
    principalFraction: 300_000_000_000n,
    principalAmount: 300n * USDC,
    interestAmount: 30n * USDC,
    principalPaid: paid ? 300n * USDC : 0n,
    interestPaid: paid ? 30n * USDC : 0n,
  });
  return {
    ...deal,
    state: 'active',
    lastAccrualTs: now - 3600,
    lastDueTs: now + 2 * DAY,
    nextPeriod: 1,
    periods: [
      period(now - 3600, true),
      period(now + DAY, false),
      period(now + 2 * DAY, false),
    ],
  };
}

/**
 * Заём с просрочкой внутри окна: второй платёж наступил час назад, первый так
 * и не оплачен. Дата подходит, но сначала нужно закрыть долг.
 */
function overdueInWindowDeal(): Deal {
  const now = Math.floor(Date.now() / 1000);
  const deal = fundingDeal(900n * USDC, -40 * DAY);
  const period = (dueTs: number): Period => ({
    dueTs,
    principalFraction: 300_000_000_000n,
    principalAmount: 300n * USDC,
    interestAmount: 30n * USDC,
    principalPaid: 0n,
    interestPaid: 0n,
  });
  return {
    ...deal,
    state: 'active',
    lastAccrualTs: now - 40 * DAY,
    lastDueTs: now + DAY,
    periods: [period(now - 30 * DAY), period(now - 3600), period(now + DAY)],
  };
}

/** Заём, просрочка по которому перевалила за порог дефолта. */
function defaultableDeal(): Deal {
  const now = Math.floor(Date.now() / 1000);
  const deal = fundingDeal(600n * USDC, -200 * DAY);
  const period = (dueTs: number): Period => ({
    dueTs,
    principalFraction: 300_000_000_000n,
    principalAmount: 300n * USDC,
    interestAmount: 30n * USDC,
    principalPaid: 0n,
    interestPaid: 0n,
  });
  return {
    ...deal,
    state: 'active',
    defaultThresholdDays: 90,
    lastAccrualTs: now - 200 * DAY,
    lastDueTs: now + DAY,
    periods: [period(now - 150 * DAY), period(now + DAY)],
  };
}

describe('Закрытие сбора и кабинет заёмщика (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let borrowerCookie: string;
  let strangerCookie: string;
  let adminCookie: string;
  let investorCookie: string;
  let loanId: string;
  let fundedId: string;
  let underfundedId: string;
  let earlyId: string;
  let foreignId: string;
  let prepayId: string;
  let couponId: string;
  let overdueId: string;
  let defaultId: string;
  let cancelId: string;
  let walletId: string;
  let spareWalletId: string;

  /** Подменённая сеть: сделки, остаток на адресе погашения, вызовы. */
  const chain = {
    deals: new Map<string, Deal>(),
    balance: 0n,
    /** Кто подписывал последнее проведение поступления. */
    callers: [] as ('admin' | 'operator')[],
    closes: 0,
    walletChanges: [] as string[],
    prepayments: [] as ('full' | 'partial')[],
    defaults: [] as string[],
    cancels: [] as string[],
  };

  const http = () => request(app.getHttpServer());

  async function cleanup() {
    await prisma.campaign.deleteMany({
      where: { borrower: { bin: { in: [BIN, OTHER_BIN] } } },
    });
    await prisma.adminAction.deleteMany({
      where: { actor: { email: ADMIN.email } },
    });
    await prisma.borrower.deleteMany({
      where: { bin: { in: [BIN, OTHER_BIN] } },
    });
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SolanaService)
      .useValue({
        cluster: 'devnet',
        explorerAddress: (address: string) => `https://solscan.io/a/${address}`,
        explorerTx: (signature: string) => `https://solscan.io/t/${signature}`,
        dealPda: () => ({ toBase58: () => 'deal' }),
        repayAddress: () => ({ toBase58: () => REPAY }),
        vaultAddress: () => ({ toBase58: () => 'vault' }),
        isMintAllowed: () => Promise.resolve(true),
        tokenBalance: () => Promise.resolve(chain.balance),
        campaignEvents: () => Promise.resolve([]),
        deal: (id: bigint) => Promise.resolve(chain.deals.get(id.toString())),
        deals: (ids: bigint[]) =>
          Promise.resolve(
            new Map(
              ids
                .map((id) => [id.toString(), chain.deals.get(id.toString())])
                .filter(([, deal]) => deal) as [string, unknown][],
            ),
          ),
        // Закрытие сбора: решает судьбу кампании так же, как контракт.
        closeFunding: (id: bigint) => {
          const deal = chain.deals.get(id.toString())!;
          if (deal.state !== 'funding') {
            throw { errorCode: { code: 'InvalidDealState' } };
          }
          if (Math.floor(Date.now() / 1000) < deal.fundingDeadline) {
            throw { errorCode: { code: 'FundingStillOpen' } };
          }
          chain.closes += 1;
          if (!deal.scheduleFinalized || deal.totalRaised < deal.softCap) {
            deal.state = 'failed';
            return Promise.resolve('signature-failed');
          }
          deal.state = 'active';
          deal.lastAccrualTs = deal.fundingDeadline;
          return Promise.resolve('signature-closed');
        },
        setBorrowerWallet: (id: bigint, wallet: string) => {
          const deal = chain.deals.get(id.toString())!;
          if (deal.state !== 'funding') {
            throw { errorCode: { code: 'InvalidDealState' } };
          }
          deal.borrowerWallet = wallet;
          chain.walletChanges.push(wallet);
          return Promise.resolve('signature-wallet');
        },
        /**
         * Проведение поступления. Обычный ключ берёт только причитающееся,
         * оператор — ещё и аванс: ровно это ограничение и проверяется.
         */
        processRepayment: (
          id: bigint,
          _mint: string,
          options: { asOperator?: boolean } = {},
        ) => {
          const deal = chain.deals.get(id.toString())!;
          const operator = options.asOperator === true;
          chain.callers.push(operator ? 'operator' : 'admin');

          const matured = deal.periods.filter(
            (period) => period.dueTs <= Math.floor(Date.now() / 1000),
          );
          const due = matured.reduce(
            (sum, period) =>
              sum +
              (period.principalAmount - period.principalPaid) +
              (period.interestAmount - period.interestPaid),
            0n,
          );
          const limit = operator
            ? deal.periods.reduce(
                (sum, period) =>
                  sum +
                  (period.principalAmount - period.principalPaid) +
                  (period.interestAmount - period.interestPaid),
                0n,
              )
            : due;
          let left = chain.balance < limit ? chain.balance : limit;
          if (left <= 0n) throw { errorCode: { code: 'NothingToProcess' } };

          chain.balance -= left;
          for (const period of deal.periods) {
            for (const field of ['interest', 'principal'] as const) {
              const owed = period[`${field}Amount`] - period[`${field}Paid`];
              const paid = owed < left ? owed : left;
              period[`${field}Paid`] += paid;
              left -= paid;
            }
          }
          // Долг пересчитается при следующем чтении: просрочку считает бэкенд.
          deal.lastAccrualTs = Math.floor(Date.now() / 1000);
          deal.nextPeriod = matured.length;
          deal.overduePrincipal = matured.reduce(
            (sum, period) =>
              sum + (period.principalAmount - period.principalPaid),
            0n,
          );
          deal.overdueScheduledInterest = matured.reduce(
            (sum, period) =>
              sum + (period.interestAmount - period.interestPaid),
            0n,
          );
          return Promise.resolve('signature-repay');
        },
        /** Дефолт: весь остаток тела уходит во взыскание, планы отменяются. */
        markDefault: (id: bigint) => {
          const deal = chain.deals.get(id.toString())!;
          if (deal.state !== 'active') {
            throw { errorCode: { code: 'InvalidDealState' } };
          }
          let principal = 0n;
          for (const period of deal.periods) {
            principal += period.principalAmount - period.principalPaid;
            if (deal.periods.indexOf(period) >= deal.nextPeriod) {
              period.interestAmount = 0n;
            }
          }
          deal.defaultPrincipal = principal;
          deal.defaultInterest =
            deal.overdueScheduledInterest + deal.extraInterest;
          deal.overduePrincipal = 0n;
          deal.overdueScheduledInterest = 0n;
          deal.extraInterest = 0n;
          deal.state = 'default';
          chain.defaults.push(id.toString());
          return Promise.resolve('signature-default');
        },
        recordRecoveryCost: (id: bigint, amount: bigint) => {
          const deal = chain.deals.get(id.toString())!;
          if (deal.state !== 'default') {
            throw { errorCode: { code: 'InvalidDealState' } };
          }
          deal.recoveryCosts += amount;
          return Promise.resolve('signature-recovery-cost');
        },
        cancelCampaign: (id: bigint) => {
          const deal = chain.deals.get(id.toString())!;
          if (deal.state !== 'funding') {
            throw { errorCode: { code: 'InvalidDealState' } };
          }
          deal.state = 'failed';
          chain.cancels.push(id.toString());
          return Promise.resolve('signature-cancel');
        },
        /**
         * Полное досрочное: забирает весь остаток долга и закрывает заём.
         * Как и контракт, отказывает, если на адресе меньше нужного.
         */
        prepayFull: (id: bigint) => {
          const deal = chain.deals.get(id.toString())!;
          if (deal.scheduleType !== 'annuity') {
            throw { errorCode: { code: 'PrepaymentNotAllowed' } };
          }
          const owed = deal.periods.reduce(
            (sum, period) =>
              sum +
              (period.principalAmount - period.principalPaid) +
              (period.interestAmount - period.interestPaid),
            0n,
          );
          const remaining = deal.periods
            .slice(deal.nextPeriod)
            .reduce(
              (sum, period) =>
                sum + (period.principalAmount - period.principalPaid),
              0n,
            );
          const total =
            owed + (remaining * BigInt(deal.prepaymentFeeBps)) / 10_000n;
          if (chain.balance < total) {
            throw { errorCode: { code: 'InsufficientRepayBalance' } };
          }
          chain.balance -= total;
          for (const period of deal.periods) {
            period.principalPaid = period.principalAmount;
            period.interestPaid = period.interestAmount;
          }
          deal.state = 'repaid';
          chain.prepayments.push('full');
          return Promise.resolve('signature-prepay-full');
        },
        /** Частичное: уменьшает тело оставшихся платежей пропорционально. */
        prepayPartial: (id: bigint, _mint: string, amount: bigint) => {
          const deal = chain.deals.get(id.toString())!;
          const next = deal.nextPeriod;
          const rest = deal.periods.slice(next);
          const balance = rest.reduce(
            (sum, period) => sum + period.principalAmount,
            0n,
          );
          if (amount <= 0n || amount >= balance) {
            throw { errorCode: { code: 'InvalidPrepaymentAmount' } };
          }
          const fee = (amount * BigInt(deal.prepaymentFeeBps)) / 10_000n;
          if (chain.balance < amount + fee) {
            throw { errorCode: { code: 'InsufficientRepayBalance' } };
          }
          chain.balance -= amount + fee;

          const left = balance - amount;
          let assigned = 0n;
          rest.forEach((period, index) => {
            const value =
              index + 1 === rest.length
                ? left - assigned
                : (period.principalAmount * left) / balance;
            assigned += value;
            period.principalAmount = value;
          });
          let running = left;
          for (const period of rest) {
            period.interestAmount =
              (running * BigInt(deal.annualRateBps)) /
              BigInt(10_000 * deal.periodsPerYear);
            running -= period.principalAmount;
          }
          chain.prepayments.push('partial');
          return Promise.resolve('signature-prepay-partial');
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    await cleanup();

    const borrowerUser = await prisma.user.create({
      data: {
        email: BORROWER.email,
        name: 'ТОО «Заёмщик»',
        passwordHash: await hash(BORROWER.password),
        role: Role.BORROWER,
        status: UserStatus.ACTIVE,
      },
    });
    // Заёмщик без привязанной компании: в кабинете ему показывать нечего.
    await prisma.user.create({
      data: {
        email: STRANGER.email,
        name: 'Без компании',
        passwordHash: await hash(STRANGER.password),
        role: Role.BORROWER,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.user.create({
      data: {
        email: ADMIN.email,
        name: 'Админ',
        passwordHash: await hash(ADMIN.password),
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.user.create({
      data: {
        email: INVESTOR.email,
        name: 'Инвестор',
        passwordHash: await hash(INVESTOR.password),
        role: Role.INVESTOR,
        status: UserStatus.ACTIVE,
        investor: { create: { status: KycStatus.APPROVED } },
      },
    });

    const borrower = await prisma.borrower.create({
      data: {
        name: 'ТОО «Заёмщик»',
        bin: BIN,
        userId: borrowerUser.id,
        wallets: {
          create: [
            { label: 'Основной', address: WALLET, isDefault: true },
            { label: 'Запасной', address: SPARE_WALLET },
          ],
        },
      },
      include: { wallets: { orderBy: { isDefault: 'desc' } } },
    });
    walletId = borrower.wallets[0].id;
    spareWalletId = borrower.wallets[1].id;
    const foreign = await prisma.borrower.create({
      data: { name: 'ТОО «Чужой»', bin: OTHER_BIN },
    });

    const campaign = (
      title: string,
      onchainId: bigint,
      borrowerId = borrower.id,
    ) =>
      prisma.campaign.create({
        data: {
          borrowerId,
          title,
          state: CampaignState.PUBLISHED,
          onchainId,
          mint: MINT,
          mintDecimals: 6,
          annualRateBps: 1_000,
          penaltyRateBps: 2_000,
          periodCount: 2,
          periodsPerYear: 12,
          scheduleStep: ScheduleStep.MONTH,
          platformFeeBps: 200,
          walletId: borrowerId === borrower.id ? walletId : undefined,
        },
      });

    loanId = (await campaign('Действующий заём', 301n)).id;
    prepayId = (await campaign('Заём без просрочки', 306n)).id;
    couponId = (await campaign('Купонный заём', 307n)).id;
    overdueId = (await campaign('Заём с просрочкой', 308n)).id;
    defaultId = (
      await prisma.campaign.create({
        data: {
          borrowerId: borrower.id,
          title: 'Заём под дефолт',
          state: CampaignState.PUBLISHED,
          onchainId: 309n,
          mint: MINT,
          mintDecimals: 6,
          annualRateBps: 1_000,
          penaltyRateBps: 2_000,
          periodCount: 2,
          periodsPerYear: 12,
          scheduleStep: ScheduleStep.MONTH,
          platformFeeBps: 200,
          defaultThresholdDays: 90,
          walletId,
        },
      })
    ).id;
    cancelId = (await campaign('Кампания под отмену', 310n)).id;
    fundedId = (await campaign('Сбор состоялся', 302n)).id;
    underfundedId = (await campaign('Сбор не добрал', 303n)).id;
    earlyId = (await campaign('Сбор ещё идёт', 304n)).id;
    foreignId = (await campaign('Чужой заём', 305n, foreign.id)).id;

    chain.deals.set('301', activeDeal());
    chain.deals.set('302', fundingDeal(1_500n * USDC, -60));
    chain.deals.set('303', fundingDeal(400n * USDC, -60));
    chain.deals.set('304', fundingDeal(1_500n * USDC, 3600));
    chain.deals.set('305', activeDeal());
    chain.deals.set('306', paidUpDeal());
    chain.deals.set('307', { ...paidUpDeal(), scheduleType: 'coupon' });
    chain.deals.set('308', overdueInWindowDeal());
    chain.deals.set('309', defaultableDeal());
    chain.deals.set('310', fundingDeal(500n * USDC, 3600));

    const login = async (email: string, password: string) => {
      const response = await http()
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      return (response.headers['set-cookie'] as unknown as string[])[0];
    };
    borrowerCookie = await login(BORROWER.email, BORROWER.password);
    strangerCookie = await login(STRANGER.email, STRANGER.password);
    adminCookie = await login(ADMIN.email, ADMIN.password);
    investorCookie = await login(INVESTOR.email, INVESTOR.password);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  describe('свои займы', () => {
    it('показывает только займы своей компании', async () => {
      const response = await http()
        .get('/borrowers/me/loans')
        .set('Cookie', borrowerCookie)
        .expect(200);

      const ids = (response.body as { id: string }[]).map((item) => item.id);
      expect(ids).toContain(loanId);
      expect(ids).not.toContain(foreignId);
    });

    it('чужой заём для заёмщика не существует', async () => {
      await http()
        .get(`/borrowers/me/loans/${foreignId}`)
        .set('Cookie', borrowerCookie)
        .expect(404);
    });

    it('без привязанной компании кабинет отвечает понятно, а не падает', async () => {
      const response = await http()
        .get('/borrowers/me/loans')
        .set('Cookie', strangerCookie)
        .expect(403);
      expect((response.body as { message: string }).message).toContain(
        'не привязан',
      );
    });

    it('инвестора и админа в кабинет заёмщика не пускают', async () => {
      await http()
        .get('/borrowers/me/loans')
        .set('Cookie', investorCookie)
        .expect(403);
      await http()
        .get('/borrowers/me/loans')
        .set('Cookie', adminCookie)
        .expect(403);
    });
  });

  describe('состояние долга', () => {
    it('сумма к оплате складывается из своей разбивки', async () => {
      const response = await http()
        .get(`/borrowers/me/loans/${loanId}`)
        .set('Cookie', borrowerCookie)
        .expect(200);

      const body = response.body as {
        due: {
          scheduledInterest: string;
          extraInterest: string;
          principal: string;
          penalty: string;
          total: string;
        };
        accruedTo: number;
        now: number;
        schedule: { status: string }[];
        repay: { address: string; balance: string };
      };

      const { due } = body;
      expect(BigInt(due.total)).toBe(
        BigInt(due.scheduledInterest) +
          BigInt(due.extraInterest) +
          BigInt(due.principal) +
          BigInt(due.penalty),
      );
      // Наступивший платёж просрочен целиком, и на него уже набежала пеня.
      expect(BigInt(due.principal)).toBe(500n * USDC);
      expect(BigInt(due.scheduledInterest)).toBe(50n * USDC);
      expect(BigInt(due.penalty)).toBeGreaterThan(0n);
      expect(BigInt(due.extraInterest)).toBeGreaterThan(0n);
      // Контракт считал долг раньше: разницу досчитал бэкенд.
      expect(body.accruedTo).toBeLessThan(body.now);
      expect(body.schedule.map((item) => item.status)).toEqual([
        'due',
        'upcoming',
      ]);
      expect(body.repay.address).toBe(REPAY);
    });
  });

  describe('погашение', () => {
    it('без денег на адресе объясняет, что ждать', async () => {
      chain.balance = 0n;
      const response = await http()
        .post(`/borrowers/me/loans/${loanId}/repay`)
        .set('Cookie', borrowerCookie)
        .expect(200);
      expect(
        (response.body as { result: { message: string } }).result.message,
      ).toContain('Поступлений пока нет');
      expect(chain.callers).toHaveLength(0);
    });

    it('«Я перевёл» проводит платёж обычным ключом', async () => {
      chain.balance = 600n * USDC;
      const response = await http()
        .post(`/borrowers/me/loans/${loanId}/repay`)
        .set('Cookie', borrowerCookie)
        .expect(200);

      const body = response.body as {
        result: { received: string };
        schedule: { status: string }[];
      };
      expect(chain.callers.at(-1)).toBe('admin');
      expect(BigInt(body.result.received)).toBeGreaterThan(0n);
      expect(body.schedule[0].status).toBe('paid');
      // Излишек остался ждать на адресе, а не стал авансом.
      expect(chain.balance).toBeGreaterThan(0n);
      expect(body.schedule[1].status).toBe('upcoming');
    });

    it('«Зачесть авансом» подписывает оператор', async () => {
      const response = await http()
        .post(`/borrowers/me/loans/${loanId}/advance`)
        .set('Cookie', borrowerCookie)
        .expect(200);

      expect(chain.callers.at(-1)).toBe('operator');
      expect(
        (response.body as { result: { message: string } }).result.message,
      ).toContain('Излишек зачтён');
      expect(chain.balance).toBe(0n);
    });

    it('по кампании в сборе платежи не принимаются', async () => {
      const response = await http()
        .post(`/borrowers/me/loans/${earlyId}/repay`)
        .set('Cookie', borrowerCookie)
        .expect(400);
      expect((response.body as { message: string }).message).toContain(
        'сбор не закрыт',
      );
    });
  });

  describe('досрочное погашение', () => {
    interface Page {
      prepayment: {
        allowed: boolean;
        feeBps: number;
        full: { remainingPrincipal: string; fee: string; total: string } | null;
        partial: { open: boolean; block: string | null; maxAmount: string };
      };
      schedule: { total: string }[];
      deal: { state: string };
      result?: { message: string; received: string };
    }
    const page = (id: string) =>
      http()
        .get(`/borrowers/me/loans/${id}`)
        .set('Cookie', borrowerCookie)
        .expect(200);

    it('купонному займу досрочное погашение недоступно', async () => {
      const response = await page(couponId);
      const { prepayment } = response.body as Page;
      expect(prepayment.allowed).toBe(false);
      expect(prepayment.partial.block).toBe('NOT_ALLOWED');

      const refused = await http()
        .post(`/borrowers/me/loans/${couponId}/prepay/full`)
        .set('Cookie', borrowerCookie)
        .expect(400);
      expect((refused.body as { message: string }).message).toContain(
        'не предусматривают',
      );
    });

    it('котировка полного погашения складывается из своих частей', async () => {
      const response = await page(prepayId);
      const { prepayment } = response.body as Page;
      expect(prepayment.allowed).toBe(true);
      // Остаток тела — два ненаступивших платежа по 300 USDC.
      expect(prepayment.full?.remainingPrincipal).toBe(
        (600n * USDC).toString(),
      );
      // Комиссия 1% от остатка тела.
      expect(prepayment.full?.fee).toBe((6n * USDC).toString());
      expect(BigInt(prepayment.full!.total)).toBeGreaterThan(606n * USDC);
    });

    /**
     * Наступивший платёж окну не мешает: контракт закрывает его той же
     * инструкцией, а котировка кладёт эту сумму в итог. Раньше окно
     * закрывалось, и копеечный остаток — он почти неизбежен, проценты идут по
     * секундам — лишал заёмщика права, за которое он платит комиссию.
     */
    it('при наступившем платеже окно открыто, долг войдёт в котировку', async () => {
      const response = await page(overdueId);
      const body = response.body as Page;
      expect(body.prepayment.partial.block).toBeNull();
      expect(body.prepayment.partial.open).toBe(true);

      const quote = await http()
        .post(`/borrowers/me/loans/${overdueId}/prepay/quote`)
        .set('Cookie', borrowerCookie)
        .send({ amount: (10n * USDC).toString() })
        .expect(200);
      const { due, principal, fee, total } = quote.body as {
        due: string;
        principal: string;
        fee: string;
        total: string;
      };
      expect(BigInt(due)).toBeGreaterThan(0n);
      expect(BigInt(total)).toBe(BigInt(due) + BigInt(principal) + BigInt(fee));
    });

    it('вне суток с даты платежа окно закрыто', async () => {
      const response = await page(loanId);
      expect((response.body as Page).prepayment.partial.block).toBe(
        'NOT_PAYMENT_DATE',
      );
    });

    it('предпросмотр показывает новый график, не трогая заём', async () => {
      const response = await http()
        .post(`/borrowers/me/loans/${prepayId}/prepay/quote`)
        .set('Cookie', borrowerCookie)
        .send({ amount: (300n * USDC).toString() })
        .expect(200);

      const quote = response.body as {
        total: string;
        fee: string;
        saved: string;
        periods: { principal: string; total: string }[];
      };
      expect(quote.fee).toBe((3n * USDC).toString());
      expect(quote.total).toBe((303n * USDC).toString());
      expect(quote.periods).toHaveLength(2);
      // Тело ополовинилось, проценты стали меньше.
      expect(
        quote.periods.reduce((sum, p) => sum + BigInt(p.principal), 0n),
      ).toBe(300n * USDC);
      expect(BigInt(quote.saved)).toBeGreaterThan(0n);
      // Сам заём предпросмотр не менял.
      expect(chain.prepayments).toHaveLength(0);
    });

    it('слишком большую сумму предпросмотр отклоняет', async () => {
      const response = await http()
        .post(`/borrowers/me/loans/${prepayId}/prepay/quote`)
        .set('Cookie', borrowerCookie)
        .send({ amount: (600n * USDC).toString() })
        .expect(400);
      expect((response.body as { message: string }).message).toContain(
        'полным погашением',
      );
    });

    it('без денег на адресе объясняет, сколько не хватает', async () => {
      chain.balance = 0n;
      const response = await http()
        .post(`/borrowers/me/loans/${prepayId}/prepay/partial`)
        .set('Cookie', borrowerCookie)
        .send({ amount: (300n * USDC).toString() })
        .expect(200);

      expect((response.body as Page).result?.message).toContain('доплатите');
      expect(chain.prepayments).toHaveLength(0);
    });

    it('частичное уменьшает платежи и оставляет их число прежним', async () => {
      const before = (await page(prepayId)).body as Page;
      chain.balance = 400n * USDC;

      const response = await http()
        .post(`/borrowers/me/loans/${prepayId}/prepay/partial`)
        .set('Cookie', borrowerCookie)
        .send({ amount: (300n * USDC).toString() })
        .expect(200);

      const after = response.body as Page;
      expect(chain.prepayments).toEqual(['partial']);
      expect(after.schedule).toHaveLength(before.schedule.length);
      expect(BigInt(after.schedule[1].total)).toBeLessThan(
        BigInt(before.schedule[1].total),
      );
      // Излишек остался ждать на адресе.
      expect(chain.balance).toBe(97n * USDC);
    });

    it('полное погашение закрывает заём', async () => {
      chain.balance = 1_000n * USDC;
      const response = await http()
        .post(`/borrowers/me/loans/${prepayId}/prepay/full`)
        .set('Cookie', borrowerCookie)
        .expect(200);

      const body = response.body as Page;
      expect(chain.prepayments).toEqual(['partial', 'full']);
      expect(body.deal.state).toBe('repaid');
      expect(BigInt(body.result!.received)).toBeGreaterThan(0n);
      expect(body.prepayment.full).toBeNull();
    });

    it('чужой заём досрочно не погасить', async () => {
      await http()
        .post(`/borrowers/me/loans/${foreignId}/prepay/full`)
        .set('Cookie', borrowerCookie)
        .expect(404);
    });
  });

  describe('профиль компании', () => {
    it('отдаёт карточку и кошельки получения', async () => {
      const response = await http()
        .get('/borrowers/me/profile')
        .set('Cookie', borrowerCookie)
        .expect(200);
      const body = response.body as {
        bin: string;
        wallets: { address: string }[];
      };
      expect(body.bin).toBe(BIN);
      expect(body.wallets.map((item) => item.address)).toContain(WALLET);
    });
  });

  describe('закрытие сбора', () => {
    it('до дедлайна отказывает и объясняет почему', async () => {
      const response = await http()
        .post(`/campaigns/${earlyId}/close`)
        .set('Cookie', adminCookie)
        .expect(400);
      expect((response.body as { message: string }).message).toContain(
        'после дедлайна',
      );
      expect(chain.closes).toBe(0);
    });

    it('показывает, сколько уйдёт заёмщику и сколько в казну', async () => {
      const response = await http()
        .get(`/campaigns/${fundedId}/onchain`)
        .set('Cookie', adminCookie)
        .expect(200);

      const body = response.body as {
        closing: {
          block: string | null;
          willFail: boolean;
          platformFee: string;
          payoutAmount: string;
          wallets: { address: string; current: boolean }[];
        };
      };
      expect(body.closing.block).toBeNull();
      expect(body.closing.willFail).toBe(false);
      // Комиссия 2% от 1500 USDC, остальное — заёмщику.
      expect(BigInt(body.closing.platformFee)).toBe(30n * USDC);
      expect(BigInt(body.closing.payoutAmount)).toBe(1_470n * USDC);
      expect(body.closing.wallets.find((item) => item.current)?.address).toBe(
        WALLET,
      );
    });

    it('успешное закрытие переводит заём в действующий и пишет в журнал', async () => {
      const response = await http()
        .post(`/campaigns/${fundedId}/close`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect((response.body as { state: string }).state).toBe('active');

      const logged = await prisma.adminAction.findFirst({
        where: { action: 'closeFunding', target: fundedId },
      });
      expect(logged?.signature).toBe('signature-closed');
    });

    it('при недоборе минимума сбор становится несостоявшимся', async () => {
      const response = await http()
        .post(`/campaigns/${underfundedId}/close`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect((response.body as { state: string }).state).toBe('failed');
    });

    it('повторное закрытие отклоняется', async () => {
      const response = await http()
        .post(`/campaigns/${fundedId}/close`)
        .set('Cookie', adminCookie)
        .expect(400);
      expect((response.body as { message: string }).message).toContain(
        'уже закрыт',
      );
    });

    it('заёмщик закрыть сбор не может', async () => {
      await http()
        .post(`/campaigns/${earlyId}/close`)
        .set('Cookie', borrowerCookie)
        .expect(403);
    });
  });

  describe('дефолт и взыскание', () => {
    interface Onchain {
      state: string;
      daysPastDue: number;
      defaultPrincipal: string;
      defaultInterest: string;
      recoveryCosts: string;
      cancelBlock: string | null;
    }
    const onchain = (id: string) =>
      http()
        .get(`/campaigns/${id}/onchain`)
        .set('Cookie', adminCookie)
        .expect(200);

    it('до порога дефолт не объявляют', async () => {
      const response = await http()
        .post(`/campaigns/${loanId}/default`)
        .set('Cookie', adminCookie)
        .expect(400);
      expect((response.body as { message: string }).message).toContain(
        'до порога дефолта',
      );
      expect(chain.defaults).toHaveLength(0);
    });

    it('дни просрочки видно до нажатия', async () => {
      const body = (await onchain(defaultId)).body as Onchain;
      expect(body.daysPastDue).toBeGreaterThanOrEqual(90);
    });

    it('после порога дефолт переводит заём во взыскание', async () => {
      const response = await http()
        .post(`/campaigns/${defaultId}/default`)
        .set('Cookie', adminCookie)
        .expect(200);

      const body = response.body as Onchain;
      expect(chain.defaults).toEqual(['309']);
      expect(body.state).toBe('default');
      // Весь остаток тела — 600 USDC — переехал во взыскание.
      expect(body.defaultPrincipal).toBe((600n * USDC).toString());

      const logged = await prisma.adminAction.findFirst({
        where: { action: 'markDefault', target: defaultId },
      });
      expect(logged?.signature).toBe('signature-default');
    });

    it('повторный дефолт отклоняется', async () => {
      const response = await http()
        .post(`/campaigns/${defaultId}/default`)
        .set('Cookie', adminCookie)
        .expect(400);
      expect((response.body as { message: string }).message).toContain(
        'уже объявлен',
      );
    });

    it('расходы на взыскание складываются', async () => {
      await http()
        .post(`/campaigns/${defaultId}/recovery-cost`)
        .set('Cookie', adminCookie)
        .send({ amount: (5n * USDC).toString() })
        .expect(200);
      const response = await http()
        .post(`/campaigns/${defaultId}/recovery-cost`)
        .set('Cookie', adminCookie)
        .send({ amount: (3n * USDC).toString() })
        .expect(200);

      expect((response.body as Onchain).recoveryCosts).toBe(
        (8n * USDC).toString(),
      );
    });

    it('поступление в дефолте проводит оператор', async () => {
      chain.balance = 100n * USDC;
      await http()
        .post(`/campaigns/${defaultId}/recovery-payment`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(chain.callers.at(-1)).toBe('operator');
    });

    it('заёмщик видит долг во взыскании вместе с расходами', async () => {
      const response = await http()
        .get(`/borrowers/me/loans/${defaultId}`)
        .set('Cookie', borrowerCookie)
        .expect(200);

      const body = response.body as {
        status: string;
        recovery: { principal: string; costs: string; outstanding: string };
        prepayment: { partial: { block: string } };
      };
      expect(body.status).toBe('DEFAULT');
      expect(BigInt(body.recovery.principal)).toBeGreaterThan(0n);
      expect(body.recovery.costs).toBe((8n * USDC).toString());
      // Досрочное погашение в дефолте недоступно.
      expect(body.prepayment.partial.block).toBe('NOT_ACTIVE');
    });

    it('заёмщик объявить дефолт не может', async () => {
      await http()
        .post(`/campaigns/${defaultId}/default`)
        .set('Cookie', borrowerCookie)
        .expect(403);
    });
  });

  describe('отмена кампании', () => {
    it('до дедлайна отменяется и уходит в несостоявшийся сбор', async () => {
      const response = await http()
        .post(`/campaigns/${cancelId}/cancel`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(chain.cancels).toEqual(['310']);
      expect((response.body as { state: string }).state).toBe('failed');
    });

    it('после дедлайна до льготного срока отмена закрыта', async () => {
      // Сбор с прошедшим дедлайном: сначала его нужно попробовать закрыть.
      const response = await http()
        .post(`/campaigns/${underfundedId}/cancel`)
        .set('Cookie', adminCookie)
        .expect(400);
      expect((response.body as { message: string }).message).toMatch(
        /закрыт|отмена снова откроется/,
      );
    });
  });

  describe('дашборд админа', () => {
    it('считает кампании, просрочки и заявки', async () => {
      const response = await http()
        .get('/admin/dashboard')
        .set('Cookie', adminCookie)
        .expect(200);

      const body = response.body as {
        funding: number;
        overdueCount: number;
        overdue: { id: string; daysPastDue: number }[];
      };
      expect(body.overdueCount).toBeGreaterThan(0);
      expect(body.overdue.map((item) => item.id)).toContain(defaultId);
      // Список отсортирован по дням просрочки, сверху самые старые.
      expect(body.overdue[0].daysPastDue).toBeGreaterThanOrEqual(
        body.overdue[body.overdue.length - 1].daysPastDue,
      );
    });

    it('заёмщика в дашборд админа не пускают', async () => {
      await http()
        .get('/admin/dashboard')
        .set('Cookie', borrowerCookie)
        .expect(403);
    });
  });

  describe('кошелёк получения', () => {
    it('меняется на другой адрес того же заёмщика', async () => {
      const response = await http()
        .post(`/campaigns/${earlyId}/borrower-wallet`)
        .set('Cookie', adminCookie)
        .send({ walletId: spareWalletId })
        .expect(200);

      expect((response.body as { borrowerWallet: string }).borrowerWallet).toBe(
        SPARE_WALLET,
      );
      expect(chain.walletChanges).toContain(SPARE_WALLET);
      const campaign = await prisma.campaign.findUnique({
        where: { id: earlyId },
      });
      expect(campaign?.payoutWallet).toBe(SPARE_WALLET);
    });

    it('после закрытия сбора кошелёк не меняется', async () => {
      const response = await http()
        .post(`/campaigns/${fundedId}/borrower-wallet`)
        .set('Cookie', adminCookie)
        .send({ walletId: walletId })
        .expect(400);
      expect((response.body as { message: string }).message).toContain(
        'пока идёт сбор',
      );
    });
  });

  describe('что требует внимания', () => {
    interface TaskRow {
      key: string;
      title: string;
      hint: string;
      count: number;
      tone: string;
    }

    const tasks = async () => {
      const response = await http()
        .get('/tasks')
        .set('Cookie', borrowerCookie)
        .expect(200);
      return response.body as TaskRow[];
    };

    it('опоздание называется просрочкой, не дожидаясь суток', async () => {
      const task = (await tasks()).find((item) => item.key === 'payment');
      expect(task?.title).toBe('Платёж просрочен');
      expect(task?.tone).toBe('danger');
      // Платежи этих займов наступили час и тридцать дней назад: сутками
      // мерить нельзя, иначе час опоздания выглядел бы спокойным.
      expect(task?.count).toBeGreaterThan(1);
    });

    it('о подходящем платеже предупреждает заранее', async () => {
      const task = (await tasks()).find((item) => item.key === 'paymentSoon');
      expect(task?.title).toBe('Платёж в течение суток');
      expect(task?.tone).toBe('info');
      expect(task?.hint).toContain('Зачесть авансом');
    });
  });
});
