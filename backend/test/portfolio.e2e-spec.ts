/**
 * Сквозные тесты портфеля инвестора. Сеть подменяем моделью контракта: она
 * так же раздаёт деньги через аккумуляторы и так же обнуляет позицию при
 * возврате взноса — проверяем поведение, а не заглушку.
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

const INVESTOR = {
  email: 'e2e-p-investor@example.com',
  password: 'пароль-инвестора-длин',
};
const OTHER = {
  email: 'e2e-p-other@example.com',
  password: 'пароль-соседа-длинный',
};
const OUTSIDER = {
  email: 'e2e-p-outsider@example.com',
  password: 'пароль-новичка-длинн',
};
const ADMIN = {
  email: 'e2e-p-admin@example.com',
  password: 'пароль-админа-длинный',
};
const EMAILS = [INVESTOR.email, OTHER.email, OUTSIDER.email, ADMIN.email];

/** Свой БИН: остальные спеки чистят заёмщиков по своим и снесли бы нашего. */
const BIN = '250140000007';
const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const WITHDRAWAL = 'CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq';

const USDC = 1_000_000n;
const SCALE = 1_000_000_000_000n;
const DAY = 24 * 60 * 60;

/** Сделка в сети: по умолчанию действующий заём на 100 USDC. */
function activeDeal(now: number) {
  return {
    state: 'active',
    totalRaised: 100n * USDC,
    periodCount: 2,
    scheduleFinalized: true,
    borrowerWallet: WITHDRAWAL,
    fundingStart: now - 10 * DAY,
    fundingDeadline: now - 5 * DAY,
    mint: MINT,
    softCap: 50n * USDC,
    hardCap: 100n * USDC,
    minTicket: USDC,
    maxTicket: 0n,
    lastDueTs: now + 30 * DAY,
    overduePrincipal: 0n,
    overdueScheduledInterest: 0n,
    extraInterest: 0n,
    penalty: 0n,
    interestCarry: 0n,
    penaltyCarry: 0n,
    lastAccrualTs: now - 5 * DAY,
    annualRateBps: 1_200,
    penaltyRateBps: 2_000,
    periodsPerYear: 12,
    platformFeeBps: 200,
    defaultThresholdDays: 90,
    repayAccount: 'RepayAccount1111111111111111111111111111111',
    nextPeriod: 0,
    periods: [
      {
        dueTs: now + 15 * DAY,
        principalFraction: SCALE / 2n,
        principalAmount: 50n * USDC,
        interestAmount: USDC,
        principalPaid: 0n,
        interestPaid: 0n,
      },
      {
        dueTs: now + 30 * DAY,
        principalFraction: SCALE / 2n,
        principalAmount: 50n * USDC,
        interestAmount: USDC / 2n,
        principalPaid: 0n,
        interestPaid: 0n,
      },
    ],
    // Раздали инвесторам 20 USDC тела и 2 USDC процентов.
    accPrincipal: (20n * USDC * SCALE) / (100n * USDC),
    accInterest: (2n * USDC * SCALE) / (100n * USDC),
    accPenalty: 0n,
    accPrepaymentFee: 0n,
  };
}

type Deal = ReturnType<typeof activeDeal>;

interface Position {
  address: string;
  principal: bigint;
  checkpointPrincipal: bigint;
  checkpointInterest: bigint;
  checkpointPenalty: bigint;
  checkpointPrepaymentFee: bigint;
}

describe('Портфель инвестора (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let investorCookie: string;
  let otherCookie: string;
  let outsiderCookie: string;
  let adminCookie: string;
  let activeId: string;
  let failedId: string;
  let emptyId: string;
  let foreignId: string;

  /** Подменённая сеть: сделки, позиции и счётчики выводов. */
  const chain = {
    deals: new Map<string, Deal>(),
    positions: new Map<string, Position>(),
    payouts: [] as string[],
    refunds: [] as string[],
  };

  const http = () => request(app.getHttpServer());

  const position = (principal: bigint): Position => ({
    address: 'PositionAccount11111111111111111111111111111',
    principal,
    checkpointPrincipal: 0n,
    checkpointInterest: 0n,
    checkpointPenalty: 0n,
    checkpointPrepaymentFee: 0n,
  });

  async function cleanup() {
    await prisma.campaign.deleteMany({ where: { borrower: { bin: BIN } } });
    await prisma.borrower.deleteMany({ where: { bin: BIN } });
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
        vaultAddress: () => ({ toBase58: () => 'vault' }),
        campaignEvents: () => Promise.resolve([]),
        tokenBalance: () => Promise.resolve(0n),
        deal: (id: bigint) => Promise.resolve(chain.deals.get(id.toString())),
        deals: (ids: bigint[]) =>
          Promise.resolve(
            new Map(
              ids
                .map((id) => [id.toString(), chain.deals.get(id.toString())])
                .filter(([, deal]) => deal) as [string, unknown][],
            ),
          ),
        positions: (ids: bigint[]) =>
          Promise.resolve(
            new Map(
              ids
                .map((id) => [
                  id.toString(),
                  chain.positions.get(id.toString()),
                ])
                .filter(([, item]) => item) as [string, unknown][],
            ),
          ),
        position: (id: bigint) =>
          Promise.resolve(chain.positions.get(id.toString()) ?? null),
        campaignPositions: (id: bigint) => {
          const item = chain.positions.get(id.toString());
          return Promise.resolve(item ? [item] : []);
        },
        /** Выплата сдвигает чекпоинты до аккумуляторов — как в контракте. */
        withdrawPayout: (id: bigint) => {
          const key = id.toString();
          const deal = chain.deals.get(key)!;
          const item = chain.positions.get(key)!;
          chain.positions.set(key, {
            ...item,
            checkpointPrincipal: deal.accPrincipal,
            checkpointInterest: deal.accInterest,
            checkpointPenalty: deal.accPenalty,
            checkpointPrepaymentFee: deal.accPrepaymentFee,
          });
          chain.payouts.push(key);
          return Promise.resolve('signature-payout');
        },
        /** Возврат обнуляет взнос и чекпоинтов не трогает — тоже как в контракте. */
        withdrawRefund: (id: bigint) => {
          const key = id.toString();
          const item = chain.positions.get(key)!;
          chain.positions.set(key, { ...item, principal: 0n });
          chain.refunds.push(key);
          return Promise.resolve('signature-refund');
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

    const approved = (email: string, password: string) =>
      prisma.user.create({
        data: {
          email,
          name: 'Инвестор',
          passwordHash: password,
          role: Role.INVESTOR,
          status: UserStatus.ACTIVE,
          investor: {
            create: {
              status: KycStatus.APPROVED,
              withdrawalAddress: WITHDRAWAL,
              onchainAccount: 'UserAccountPda111111111111111111111111111111',
              whitelistStatus: true,
            },
          },
        },
        include: { investor: true },
      });

    const investor = await approved(
      INVESTOR.email,
      await hash(INVESTOR.password),
    );
    const other = await approved(OTHER.email, await hash(OTHER.password));
    await prisma.user.create({
      data: {
        email: OUTSIDER.email,
        name: 'Новичок',
        passwordHash: await hash(OUTSIDER.password),
        role: Role.INVESTOR,
        status: UserStatus.PENDING,
        investor: { create: { status: KycStatus.DRAFT } },
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

    const borrower = await prisma.borrower.create({
      data: { name: 'ТОО «Портфель»', bin: BIN },
    });
    const campaign = (title: string, onchainId: bigint) =>
      prisma.campaign.create({
        data: {
          borrowerId: borrower.id,
          title,
          state: CampaignState.PUBLISHED,
          onchainId,
          mint: MINT,
          mintDecimals: 6,
          annualRateBps: 1_200,
          periodCount: 2,
          periodsPerYear: 12,
          scheduleStep: ScheduleStep.MONTH,
        },
      });

    activeId = (await campaign('Действующий заём', 401n)).id;
    failedId = (await campaign('Сбор не состоялся', 402n)).id;
    emptyId = (await campaign('Адрес открыт, взносов нет', 403n)).id;
    foreignId = (await campaign('Чужое участие', 404n)).id;

    const now = Math.floor(Date.now() / 1000);
    chain.deals.set('401', activeDeal(now));
    chain.deals.set('402', {
      ...activeDeal(now),
      state: 'failed',
      totalRaised: 30n * USDC,
      accPrincipal: 0n,
      accInterest: 0n,
    });
    chain.deals.set('403', {
      ...activeDeal(now),
      state: 'funding',
      totalRaised: 0n,
      fundingDeadline: now + DAY,
    });
    chain.deals.set('404', activeDeal(now));
    chain.positions.set('401', position(20n * USDC));
    chain.positions.set('402', position(30n * USDC));
    chain.positions.set('404', position(10n * USDC));

    // Свои участия: действующий заём, несостоявшийся сбор и пустой адрес.
    const deposit = (campaignId: string, investorId: string, amount?: bigint) =>
      prisma.campaignDeposit.create({
        data: {
          investorId,
          campaignId,
          owner: `owner-${campaignId}`,
          address: `token-${campaignId}`,
          ...(amount
            ? {
                credits: {
                  create: { amount, signature: `sig-${campaignId}` },
                },
              }
            : {}),
        },
      });
    await deposit(activeId, investor.investor!.id, 20n * USDC);
    await deposit(failedId, investor.investor!.id, 30n * USDC);
    await deposit(emptyId, investor.investor!.id);
    await deposit(foreignId, other.investor!.id, 10n * USDC);

    const login = async (email: string, password: string) => {
      const response = await http()
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      return (response.headers['set-cookie'] as unknown as string[])[0];
    };
    investorCookie = await login(INVESTOR.email, INVESTOR.password);
    otherCookie = await login(OTHER.email, OTHER.password);
    outsiderCookie = await login(OUTSIDER.email, OUTSIDER.password);
    adminCookie = await login(ADMIN.email, ADMIN.password);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const portfolio = (cookie: string) =>
    http().get('/investors/me/portfolio').set('Cookie', cookie).expect(200);

  interface Row {
    id: string;
    invested: string;
    received: string;
    available: string;
    shareBps: number;
    refund: boolean;
    next: { dueTs: number; yours: string } | null;
  }

  describe('состав портфеля', () => {
    it('показывает только свои участия', async () => {
      const response = await portfolio(investorCookie);
      const ids = (response.body.rows as Row[]).map((row) => row.id);
      expect(ids).toContain(activeId);
      expect(ids).toContain(failedId);
      expect(ids).not.toContain(foreignId);
    });

    it('участие без взносов в портфель не попадает', async () => {
      const response = await portfolio(investorCookie);
      const ids = (response.body.rows as Row[]).map((row) => row.id);
      expect(ids).not.toContain(emptyId);
    });

    it('суммы совпадают с позицией в сети', async () => {
      const response = await portfolio(investorCookie);
      const row = (response.body.rows as Row[]).find((r) => r.id === activeId)!;

      expect(row.invested).toBe((20n * USDC).toString());
      // Раздали 20 USDC тела и 2 процентов на 100 собранных: доля 20% — 4,4.
      expect(row.available).toBe(4_400_000n.toString());
      expect(row.received).toBe('0');
      expect(row.shareBps).toBe(2_000);
      expect(row.refund).toBe(false);
    });

    it('у действующего займа виден ближайший платёж и доля в нём', async () => {
      const response = await portfolio(investorCookie);
      const row = (response.body.rows as Row[]).find((r) => r.id === activeId)!;
      // Платёж 51 USDC, доля инвестора 20% — 10,2.
      expect(row.next?.yours).toBe(10_200_000n.toString());
    });

    it('у несостоявшегося сбора забирают взнос, а не выплату', async () => {
      const response = await portfolio(investorCookie);
      const row = (response.body.rows as Row[]).find((r) => r.id === failedId)!;
      expect(row.refund).toBe(true);
      expect(row.available).toBe((30n * USDC).toString());
      expect(row.next).toBeNull();
    });

    it('итоги складываются по строкам', async () => {
      const response = await portfolio(investorCookie);
      const rows = response.body.rows as Row[];
      const sum = (key: 'invested' | 'received' | 'available') =>
        rows.reduce((total, row) => total + BigInt(row[key]), 0n).toString();

      expect(response.body.totals.invested).toBe(sum('invested'));
      expect(response.body.totals.received).toBe(sum('received'));
      expect(response.body.totals.available).toBe(sum('available'));
    });
  });

  describe('доступ', () => {
    it('недопущенный инвестор видит причину, а не ошибку', async () => {
      const response = await portfolio(outsiderCookie);
      expect(response.body.rows).toEqual([]);
      expect(String(response.body.participationBlock)).toContain('проверка');
    });

    it('заёмщика и админа в портфель не пускают', async () => {
      await http()
        .get('/investors/me/portfolio')
        .set('Cookie', adminCookie)
        .expect(403);
    });

    it('чужое участие забрать нельзя', async () => {
      await http()
        .post(`/investors/me/portfolio/${foreignId}/claim`)
        .set('Cookie', investorCookie)
        .expect(404);
      expect(chain.payouts).toHaveLength(0);
    });
  });

  describe('вывод средств', () => {
    it('у действующего займа зовёт выплату и обнуляет доступное', async () => {
      const response = await http()
        .post(`/investors/me/portfolio/${activeId}/claim`)
        .set('Cookie', investorCookie)
        .expect(200);

      expect(chain.payouts).toEqual(['401']);
      const row = (response.body.rows as Row[]).find((r) => r.id === activeId)!;
      expect(row.available).toBe('0');
      // Выведенное восстанавливается из чекпоинтов.
      expect(row.received).toBe(4_400_000n.toString());
    });

    it('у несостоявшегося сбора зовёт возврат, и участие остаётся видно', async () => {
      const response = await http()
        .post(`/investors/me/portfolio/${failedId}/claim`)
        .set('Cookie', investorCookie)
        .expect(200);

      expect(chain.refunds).toEqual(['402']);
      const row = (response.body.rows as Row[]).find((r) => r.id === failedId)!;
      expect(row.available).toBe('0');
      // Возврат обнуляет позицию, но взнос и полученное видно из своих записей.
      expect(row.invested).toBe((30n * USDC).toString());
      expect(row.received).toBe((30n * USDC).toString());
    });

    it('чужой портфель не затронут', async () => {
      const response = await portfolio(otherCookie);
      const row = (response.body.rows as Row[]).find(
        (r) => r.id === foreignId,
      )!;
      expect(row.received).toBe('0');
      expect(row.available).toBe(2_200_000n.toString());
    });
  });
});
