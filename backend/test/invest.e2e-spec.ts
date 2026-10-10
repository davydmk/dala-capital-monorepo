/**
 * Сквозные тесты участия в кампании: выбор, адрес пополнения, зачисление.
 * Сеть подменяем моделью контракта — она считает зачисление теми же правилами,
 * чтобы проверять не заглушку, а поведение.
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
  email: 'e2e-d-investor@example.com',
  password: 'пароль-инвестора-длин',
};
const OUTSIDER = {
  email: 'e2e-d-outsider@example.com',
  password: 'пароль-новичка-длинн',
};
const EMAILS = [INVESTOR.email, OUTSIDER.email];

/** Свой БИН: тесты кампаний чистят своих заёмщиков по БИН и снесли бы наших. */
const BIN = '250140000003';
const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const WITHDRAWAL = 'CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq';
const OWNER = 'DepositOwnerPda1111111111111111111111111111';
const TOKEN_ACCOUNT = 'DepositTokenAccount111111111111111111111111';
const SENDER = 'SenderWallet11111111111111111111111111111111';
const POSITION = 'PositionAccount11111111111111111111111111111';
const VAULT = 'CampaignVault111111111111111111111111111111';

const USDC = 1_000_000n;
const HOUR = 60 * 60;

/** Модель сделки в сети: открытый сбор с минимальным взносом 10 USDC. */
function freshDeal() {
  const now = Math.floor(Date.now() / 1000);
  return {
    state: 'funding',
    totalRaised: 0n,
    periodCount: 6,
    scheduleFinalized: true,
    borrowerWallet: WITHDRAWAL,
    fundingStart: now - HOUR,
    fundingDeadline: now + HOUR,
    mint: MINT,
    softCap: 50n * USDC,
    hardCap: 100n * USDC,
    minTicket: 10n * USDC,
    maxTicket: 0n,
    lastDueTs: now + 30 * 24 * HOUR,
    overduePrincipal: 0n,
    nextPeriod: 0,
    periods: Array.from({ length: 6 }, (_item, index) => ({
      dueTs: now + (index + 1) * 5 * 24 * HOUR,
      principalFraction: 0n,
      principalAmount: 0n,
      interestAmount: 0n,
      principalPaid: 0n,
      interestPaid: 0n,
    })),
    // Поля долга: по ним считается просрочка на текущий момент.
    overdueScheduledInterest: 0n,
    extraInterest: 0n,
    penalty: 0n,
    interestCarry: 0n,
    penaltyCarry: 0n,
    lastAccrualTs: now,
    annualRateBps: 1000,
    penaltyRateBps: 2000,
    accPrincipal: 0n,
    accInterest: 0n,
    accPenalty: 0n,
    accPrepaymentFee: 0n,
  };
}

describe('Пополнение и взносы (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let investorCookie: string;
  let outsiderCookie: string;
  let campaignId: string;
  let closedCampaignId: string;

  /** Подменённая сеть: сделки, баланс адреса пополнения и позиция. */
  const chain = {
    deals: new Map<string, ReturnType<typeof freshDeal>>(),
    balance: 0n,
    principal: 0n,
    opens: 0,
    invests: 0,
    withdraws: 0,
    payouts: 0,
    refunds: 0,
    others: 0,
    events: [] as unknown[],
  };

  const http = () => request(app.getHttpServer());
  const chainPrincipal = () => chain.principal.toString();

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
        depositOwnerPda: () => ({ toBase58: () => OWNER }),
        depositTokenAddress: () => ({ toBase58: () => TOKEN_ACCOUNT }),
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
              chain.principal > 0n
                ? ids.map((id) => [
                    id.toString(),
                    {
                      address: POSITION,
                      principal: chain.principal,
                      checkpointPrincipal: 0n,
                      checkpointInterest: 0n,
                      checkpointPenalty: 0n,
                      checkpointPrepaymentFee: 0n,
                    },
                  ])
                : [],
            ),
          ),
        tokenBalance: () => Promise.resolve(chain.balance),
        position: () =>
          Promise.resolve(
            chain.principal > 0n
              ? {
                  address: POSITION,
                  principal: chain.principal,
                  checkpointPrincipal: 0n,
                  checkpointInterest: 0n,
                  checkpointPenalty: 0n,
                  checkpointPrepaymentFee: 0n,
                }
              : null,
          ),
        campaignPositions: () =>
          Promise.resolve(
            chain.principal > 0n
              ? [
                  {
                    address: POSITION,
                    principal: chain.principal,
                    checkpointPrincipal: 0n,
                    checkpointInterest: 0n,
                    checkpointPenalty: 0n,
                    checkpointPrepaymentFee: 0n,
                  },
                  // Чужие позиции: на витрине их показывают не больше десяти.
                  ...Array.from({ length: chain.others }, (_item, index) => ({
                    address: `Other${index}`,
                    principal: BigInt(index + 1) * USDC,
                    checkpointPrincipal: 0n,
                    checkpointInterest: 0n,
                    checkpointPenalty: 0n,
                    checkpointPrepaymentFee: 0n,
                  })),
                ]
              : [],
          ),
        vaultAddress: () => ({ toBase58: () => VAULT }),
        withdrawPayout: () => {
          chain.payouts += 1;
          return Promise.resolve('signature-payout');
        },
        withdrawRefund: () => {
          chain.refunds += 1;
          return Promise.resolve('signature-refund');
        },
        campaignEvents: () => Promise.resolve(chain.events),
        lastSender: () => Promise.resolve(SENDER),
        openDeposit: () => {
          chain.opens += 1;
          return Promise.resolve('signature-open');
        },
        // Считаем зачисление так же, как контракт: минимальный взнос, остаток
        // до максимума сбора, остаток на адресе.
        invest: (id: bigint) => {
          const deal = chain.deals.get(id.toString());
          if (!deal) throw { errorCode: { code: 'InvalidDealState' } };
          if (chain.balance === 0n) {
            throw { errorCode: { code: 'NothingToProcess' } };
          }
          if (chain.principal === 0n && chain.balance < deal.minTicket) {
            throw { errorCode: { code: 'BelowMinTicket' } };
          }
          const room = deal.hardCap - deal.totalRaised;
          const fill = chain.balance < room ? chain.balance : room;
          if (fill <= 0n) throw { errorCode: { code: 'NoCapacity' } };
          chain.balance -= fill;
          chain.principal += fill;
          deal.totalRaised += fill;
          chain.invests += 1;
          return Promise.resolve('signature-invest');
        },
        withdrawDeposit: () => {
          chain.withdraws += 1;
          chain.balance = 0n;
          return Promise.resolve('signature-withdraw');
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

    // Допущенный инвестор с аккаунтом в контракте и адресом вывода.
    const investorUser = await prisma.user.create({
      data: {
        email: INVESTOR.email,
        name: 'Инвестор',
        passwordHash: await hash(INVESTOR.password),
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
    });
    expect(investorUser.id).toBeTruthy();

    // Инвестор без пройденной проверки: ему участие закрыто.
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

    const borrower = await prisma.borrower.create({
      data: { name: 'ТОО «Тест»', bin: BIN },
    });
    const campaign = await prisma.campaign.create({
      data: {
        borrowerId: borrower.id,
        title: 'Оборотный заём',
        state: CampaignState.PUBLISHED,
        onchainId: 101n,
        mint: MINT,
        mintDecimals: 6,
        annualRateBps: 1000,
        periodCount: 6,
        periodsPerYear: 12,
        scheduleStep: ScheduleStep.DAY,
        firstDueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      },
    });
    campaignId = campaign.id;
    chain.deals.set('101', freshDeal());

    // Вторая кампания уже не в сборе — в списке её быть не должно.
    const closed = await prisma.campaign.create({
      data: {
        borrowerId: borrower.id,
        title: 'Закрытый сбор',
        state: CampaignState.PUBLISHED,
        onchainId: 102n,
        mint: MINT,
        mintDecimals: 6,
        annualRateBps: 1200,
        periodCount: 12,
      },
    });
    closedCampaignId = closed.id;
    chain.deals.set('102', { ...freshDeal(), state: 'active' });

    const login = async (email: string, password: string) => {
      const response = await http()
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      return (response.headers['set-cookie'] as unknown as string[])[0];
    };
    investorCookie = await login(INVESTOR.email, INVESTOR.password);
    outsiderCookie = await login(OUTSIDER.email, OUTSIDER.password);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  describe('выбор кампании', () => {
    it('показывает кампании всех стадий с понятным статусом', async () => {
      const response = await http()
        .get('/investors/me/campaigns')
        .set('Cookie', investorCookie)
        .expect(200);

      const byId = new Map(
        (response.body as { id: string; status: string }[]).map((item) => [
          item.id,
          item.status,
        ]),
      );
      expect(byId.get(campaignId)).toBe('FUNDING');
      // Закрытая кампания из витрины не исчезает — у неё свой статус.
      expect(byId.get(closedCampaignId)).toBe('ACTIVE');
    });

    it('витрина открыта и до одобрения', async () => {
      const response = await http()
        .get('/investors/me/campaigns')
        .set('Cookie', outsiderCookie)
        .expect(200);
      expect((response.body as unknown[]).length).toBeGreaterThan(0);
    });

    it('отдаёт условия, по которым инвестор принимает решение', async () => {
      const response = await http()
        .get('/investors/me/campaigns')
        .set('Cookie', investorCookie)
        .expect(200);

      const campaign = (response.body as Record<string, unknown>[]).find(
        (item) => item.id === campaignId,
      );
      expect(campaign?.minTicket).toBe((10n * USDC).toString());
      expect(campaign?.hardCap).toBe((100n * USDC).toString());
      expect(campaign?.annualRateBps).toBe(1000);
    });

    it('без пройденной проверки видно всё, кроме участия', async () => {
      const state = await http()
        .get(`/investors/me/campaigns/${campaignId}/deposit`)
        .set('Cookie', outsiderCookie)
        .expect(200);
      expect(state.body.deposit).toBeNull();
      expect(String(state.body.participationBlock)).toContain('проверка');

      await http()
        .post(`/investors/me/campaigns/${campaignId}/deposit`)
        .set('Cookie', outsiderCookie)
        .expect(403);
    });
  });

  describe('витрина заёмщика', () => {
    it('показывает карточку и все опубликованные кампании', async () => {
      const borrower = await prisma.borrower.findFirst({ where: { bin: BIN } });
      const response = await http()
        .get(`/investors/me/borrowers/${borrower!.id}`)
        .set('Cookie', investorCookie)
        .expect(200);

      const body = response.body as {
        borrower: { name: string; rating: string | null };
        campaigns: { id: string; status: string }[];
        repaid: number;
      };
      expect(body.borrower.name).toContain('Тест');
      const ids = body.campaigns.map((item) => item.id);
      expect(ids).toContain(campaignId);
      expect(ids).toContain(closedCampaignId);
      expect(body.repaid).toBe(0);
      // Реквизитов в публичной карточке нет.
      expect(JSON.stringify(body.borrower)).not.toContain(BIN);
    });

    it('витрина открыта и до одобрения', async () => {
      const borrower = await prisma.borrower.findFirst({ where: { bin: BIN } });
      await http()
        .get(`/investors/me/borrowers/${borrower!.id}`)
        .set('Cookie', outsiderCookie)
        .expect(200);
    });

    it('несуществующего заёмщика не показывает', async () => {
      await http()
        .get('/investors/me/borrowers/2f1b6b3c-0000-4000-8000-000000000000')
        .set('Cookie', investorCookie)
        .expect(404);
    });
  });

  describe('адрес пополнения', () => {
    it('открывается один раз', async () => {
      const first = await http()
        .post(`/investors/me/campaigns/${campaignId}/deposit`)
        .set('Cookie', investorCookie)
        .expect(200);

      expect(chain.opens).toBe(1);
      expect(first.body.deposit.owner).toBe(OWNER);
      expect(first.body.deposit.address).toBe(TOKEN_ACCOUNT);

      await http()
        .post(`/investors/me/campaigns/${campaignId}/deposit`)
        .set('Cookie', investorCookie)
        .expect(200);
      expect(chain.opens).toBe(1);

      const deposits = await prisma.campaignDeposit.count({
        where: { campaignId },
      });
      expect(deposits).toBe(1);
    });

    it('пустой адрес — это ожидание, а не ошибка', async () => {
      const response = await http()
        .get(`/investors/me/campaigns/${campaignId}/deposit`)
        .set('Cookie', investorCookie)
        .expect(200);

      expect(response.body.pending).toBe('0');
      expect(response.body.invested).toBe('0');
      expect(response.body.block).toBeNull();
    });

    it('«Я перевёл» при пустом адресе отвечает по существу', async () => {
      const response = await http()
        .post(`/investors/me/campaigns/${campaignId}/deposit/credit`)
        .set('Cookie', investorCookie)
        .send({ claimed: true })
        .expect(200);

      expect(String(response.body.result.message)).toContain('Поступлений');
      expect(chain.invests).toBe(0);

      const deposit = await prisma.campaignDeposit.findFirst({
        where: { campaignId },
      });
      expect(deposit?.claimedAt).toBeTruthy();
    });
  });

  describe('зачисление', () => {
    it('объясняет, что суммы не хватает до минимального взноса', async () => {
      chain.balance = 5n * USDC;

      const state = await http()
        .get(`/investors/me/campaigns/${campaignId}/deposit`)
        .set('Cookie', investorCookie)
        .expect(200);
      expect(state.body.block.code).toBe('BelowMinTicket');

      // Отказ контракта — это объяснение, а не сбой сервера.
      const credit = await http()
        .post(`/investors/me/campaigns/${campaignId}/deposit/credit`)
        .set('Cookie', investorCookie)
        .expect(200);
      expect(String(credit.body.result.message)).toContain('минимального');
      expect(credit.body.result.credited).toBe('0');
    });

    it('зачисляет взнос и запоминает отправителя', async () => {
      chain.balance = 50n * USDC;

      const response = await http()
        .post(`/investors/me/campaigns/${campaignId}/deposit/credit`)
        .set('Cookie', investorCookie)
        .expect(200);

      expect(chain.invests).toBe(1);
      expect(response.body.result.credited).toBe((50n * USDC).toString());
      expect(response.body.invested).toBe((50n * USDC).toString());
      expect(response.body.pending).toBe('0');
      expect(response.body.credits[0].sender).toBe(SENDER);
      expect(String(response.body.credits[0].url)).toContain(
        'signature-invest',
      );
    });

    it('участие видно на витрине и только своему инвестору', async () => {
      const mine = await http()
        .get('/investors/me/campaigns')
        .set('Cookie', investorCookie)
        .expect(200);
      const card = (mine.body as { id: string; invested: string }[]).find(
        (item) => item.id === campaignId,
      );
      expect(card?.invested).toBe((50n * USDC).toString());

      const others = await http()
        .get('/investors/me/campaigns')
        .set('Cookie', outsiderCookie)
        .expect(200);
      expect(
        (others.body as { invested: string }[]).every(
          (item) => item.invested === '0',
        ),
      ).toBe(true);
    });

    it('оставляет на адресе то, что не влезло в сбор', async () => {
      // До максимума осталось 50 USDC, а на адресе 70.
      chain.balance = 70n * USDC;

      const response = await http()
        .post(`/investors/me/campaigns/${campaignId}/deposit/credit`)
        .set('Cookie', investorCookie)
        .expect(200);

      expect(response.body.result.credited).toBe((50n * USDC).toString());
      expect(response.body.pending).toBe((20n * USDC).toString());
      expect(response.body.block.code).toBe('NoCapacity');
      expect(response.body.block.action).toBe('withdraw');
    });

    it('остаток забирается на адрес вывода', async () => {
      const response = await http()
        .post(`/investors/me/campaigns/${campaignId}/deposit/withdraw`)
        .set('Cookie', investorCookie)
        .expect(200);

      expect(chain.withdraws).toBe(1);
      expect(response.body.pending).toBe('0');
    });
  });

  describe('страница кампании', () => {
    it('отдаёт условия, график, позицию и состав инвесторов', async () => {
      const response = await http()
        .get(`/investors/me/campaigns/${campaignId}`)
        .set('Cookie', investorCookie)
        .expect(200);

      const body = response.body;
      expect(body.status).toBe('FUNDING');
      expect(body.schedules.max.periods).toHaveLength(6);
      expect(body.schedules.collecting).toBe(true);
      // Вся кампания у одного инвестора — доля 100%.
      expect(body.position.shareBps).toBe(10_000);
      expect(body.position.principal).toBe(chainPrincipal());
      expect(body.investors.count).toBe(1);
      expect(body.investors.shares[0].address).toBe(POSITION);
      expect(body.investors.shares[0].mine).toBe(true);
      expect(
        body.addresses.map((item: { label: string }) => item.label),
      ).toContain('Волт кампании');
    });

    it('показывает, сколько причитается и когда следующий платёж', async () => {
      const response = await http()
        .get(`/investors/me/campaigns/${campaignId}`)
        .set('Cookie', investorCookie)
        .expect(200);

      // Распределений ещё не было — забирать нечего.
      expect(response.body.position.payout.total).toBe('0');
      // Вернётся больше вложенного, но соразмерно вложенному, а не сбору.
      const invested = Number(response.body.position.principal);
      const expected = Number(response.body.position.expected);
      expect(expected).toBeGreaterThan(invested);
      expect(expected).toBeLessThan(invested * 1.5);
      expect(response.body.position.next.dueTs).toBeGreaterThan(
        Math.floor(Date.now() / 1000),
      );
    });

    it('кошелька заёмщика среди адресов нет', async () => {
      const response = await http()
        .get(`/investors/me/campaigns/${campaignId}`)
        .set('Cookie', investorCookie)
        .expect(200);

      const labels = (response.body.addresses as { label: string }[]).map(
        (item) => item.label,
      );
      expect(labels).toEqual(['Сделка', 'Волт кампании', 'Расчётный токен']);
    });

    it('в составе инвесторов показываются только первые десять', async () => {
      chain.others = 12;
      const response = await http()
        .get(`/investors/me/campaigns/${campaignId}`)
        .set('Cookie', investorCookie)
        .expect(200);

      expect(response.body.investors.count).toBe(13);
      expect(response.body.investors.shares).toHaveLength(10);
      chain.others = 0;
    });

    it('без одобрения страница открыта, но позиции нет', async () => {
      const response = await http()
        .get(`/investors/me/campaigns/${campaignId}`)
        .set('Cookie', outsiderCookie)
        .expect(200);

      expect(response.body.position).toBeNull();
      expect(String(response.body.participationBlock)).toContain('проверка');
    });
  });

  describe('история операций', () => {
    it('читается из сети и складывается в базу', async () => {
      chain.events = [
        {
          signature: 'signature-invested',
          slot: 100,
          blockTime: Math.floor(Date.now() / 1000),
          index: 0,
          name: 'Invested',
          payload: { amount: '5000000' },
        },
      ];

      const first = await http()
        .get(`/investors/me/campaigns/${campaignId}/history?refresh=1`)
        .set('Cookie', investorCookie)
        .expect(200);
      expect(first.body).toHaveLength(1);
      expect(first.body[0].name).toBe('Invested');
      expect(String(first.body[0].url)).toContain('signature-invested');

      // Второе чтение берёт уже сохранённое, дубля не появляется.
      const second = await http()
        .get(`/investors/me/campaigns/${campaignId}/history?refresh=1`)
        .set('Cookie', investorCookie)
        .expect(200);
      expect(second.body).toHaveLength(1);
    });
  });

  describe('вывод причитающегося', () => {
    it('у идущего сбора зовёт выплату', async () => {
      const before = chain.payouts;
      await http()
        .post(`/investors/me/campaigns/${campaignId}/claim`)
        .set('Cookie', investorCookie)
        .expect(200);
      expect(chain.payouts).toBe(before + 1);
      expect(chain.refunds).toBe(0);
    });

    it('у несостоявшегося сбора зовёт возврат', async () => {
      const deal = chain.deals.get('101');
      if (deal) deal.state = 'failed';

      const before = chain.refunds;
      await http()
        .post(`/investors/me/campaigns/${campaignId}/claim`)
        .set('Cookie', investorCookie)
        .expect(200);
      expect(chain.refunds).toBe(before + 1);

      if (deal) deal.state = 'funding';
    });

    it('без пройденной проверки забрать нельзя', async () => {
      await http()
        .post(`/investors/me/campaigns/${campaignId}/claim`)
        .set('Cookie', outsiderCookie)
        .expect(403);
    });
  });

  describe('права', () => {
    it('без входа участие недоступно', async () => {
      await http().get('/investors/me/campaigns').expect(401);
      await http()
        .get(`/investors/me/campaigns/${campaignId}/deposit`)
        .expect(401);
    });

    it('кампания не в сборе адрес не открывает', async () => {
      await http()
        .post(`/investors/me/campaigns/${closedCampaignId}/deposit`)
        .set('Cookie', investorCookie)
        .expect(400);
    });
  });
});
