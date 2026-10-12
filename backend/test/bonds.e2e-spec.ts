/**
 * Сквозные тесты облигаций и корпоративных действий.
 *
 * Программу `dala_actions` подменяем моделью: она так же держит реестр
 * держателей, выдаёт и гасит бумаги и проводит действие по стадиям. Проверяем
 * главное: бумага выпускается только по купонной схеме, появляется в момент
 * взноса, вес голоса берётся из снятого реестра, а не из текущего баланса.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import {
  CampaignState,
  KycStatus,
  Role,
  ScheduleKind,
  ScheduleStep,
  UserStatus,
} from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { BondProgramService } from '../src/bonds/bond-program.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SolanaService } from '../src/solana/solana.service.js';

const ADMIN = {
  email: 'e2e-bond-admin@example.com',
  password: 'пароль-админа-длинный',
};
const ALICE = {
  email: 'e2e-bond-alice@example.com',
  password: 'пароль-алисы-длинный',
};
const BOB = {
  email: 'e2e-bond-bob@example.com',
  password: 'пароль-боба-длинныйй',
};
const EMAILS = [ADMIN.email, ALICE.email, BOB.email];

const BIN = '250140000008';
const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const ALICE_WALLET = 'CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq';
const BOB_WALLET = 'JCLPbcLwdYJs1UJgL6LK1nhYRUcGk5ziFPx55nVL9akB';
const BOND_MINT = 'BondMint11111111111111111111111111111111111';

const USDC = 1_000_000n;
const DAY = 24 * 60 * 60;
/** Номинал бумаги: 1 USDC. */
const FACE = USDC;

interface Action {
  index: number;
  kind: string;
  recordTs: number;
  paymentTs: number;
  amountPerUnit: bigint;
  holders: number;
  units: bigint;
  totalAmount: bigint;
  registerHash: string;
  settlement: string | null;
  votesFor: bigint;
  votesAgainst: bigint;
  status: string;
}

describe('Облигации и корпоративные действия (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let adminCookie: string;
  let aliceCookie: string;
  let bobCookie: string;
  let bondId: string;
  let loanId: string;

  /** Модель программы: реестр держателей и журнал действий. */
  const chain = {
    registry: null as null | {
      faceValue: bigint;
      couponRateBps: number;
      couponsPerYear: number;
      maturityTs: number;
      maxSupply: bigint;
      issued: bigint;
      outstanding: bigint;
      status: 'active' | 'defaulted' | 'redeemed';
    },
    holders: new Map<string, bigint>(),
    actions: [] as Action[],
    burns: [] as { holder: string; units: bigint; redemption: boolean }[],
  };

  const http = () => request(app.getHttpServer());

  /** Состояние займа в контракте: бумаги гасятся только у погашенного. */
  let dealState = 'active';

  async function cleanup() {
    await prisma.campaign.deleteMany({ where: { borrower: { bin: BIN } } });
    await prisma.borrower.deleteMany({ where: { bin: BIN } });
    // Выгрузка персональных данных пишется в журнал админа, а он ссылается
    // на пользователя: без этого удаление упирается во внешний ключ.
    await prisma.adminAction.deleteMany({
      where: { actor: { email: ADMIN.email } },
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
        explorerAddress: (a: string) => `https://solscan.io/a/${a}`,
        explorerTx: (s: string) => `https://solscan.io/t/${s}`,
        dealPda: () => ({ toBase58: () => 'deal' }),
        isMintAllowed: () => Promise.resolve(true),
        campaignEvents: () => Promise.resolve([]),
        deals: (ids: bigint[]) =>
          Promise.resolve(
            new Map(ids.map((id) => [String(id), { state: dealState }])),
          ),
        campaignPositions: () => Promise.resolve([]),
        vaultAddress: () => ({ toBase58: () => 'vault' }),
        positionPda: () => ({ toBase58: () => 'position' }),
        position: () => Promise.resolve(null),
        deal: () =>
          Promise.resolve({
            state: dealState,
            totalRaised: 10n * USDC,
            hardCap: 100n * USDC,
            softCap: USDC,
            fundingDeadline: Math.floor(Date.now() / 1000) - DAY,
            lastDueTs: Math.floor(Date.now() / 1000) + 365 * DAY,
            overduePrincipal: 0n,
            overdueScheduledInterest: 0n,
            extraInterest: 0n,
            penalty: 0n,
            defaultPrincipal: 0n,
            defaultInterest: 0n,
            interestCarry: 0n,
            penaltyCarry: 0n,
            lastAccrualTs: Math.floor(Date.now() / 1000),
            annualRateBps: 1200,
            penaltyRateBps: 2000,
            nextPeriod: 0,
            periods: [],
          }),
      })
      .overrideProvider(BondProgramService)
      .useValue({
        explorerAddress: (a: string) => `https://explorer/a/${a}`,
        explorerTx: (s: string) => `https://explorer/t/${s}`,
        explorerToken: (a: string) =>
          `https://explorer/a/${a}/token-extensions`,
        registryPda: () => ({ toBase58: () => 'registry' }),
        mintPda: () => ({ toBase58: () => BOND_MINT }),
        registry: () =>
          Promise.resolve(
            chain.registry
              ? {
                  address: 'registry',
                  mint: BOND_MINT,
                  campaignId: 1n,
                  ...chain.registry,
                }
              : null,
          ),
        issueBond: (_id: bigint, params: Record<string, unknown>) => {
          chain.registry = {
            faceValue: params.faceValue as bigint,
            couponRateBps: params.couponRateBps as number,
            couponsPerYear: params.couponsPerYear as number,
            maturityTs: params.maturityTs as number,
            maxSupply: params.maxSupply as bigint,
            issued: 0n,
            outstanding: 0n,
            status: 'active',
          };
          return Promise.resolve('signature-issue');
        },
        mintToHolder: (_id: bigint, holder: string, units: bigint) => {
          chain.holders.set(holder, (chain.holders.get(holder) ?? 0n) + units);
          chain.registry!.issued += units;
          chain.registry!.outstanding += units;
          return Promise.resolve('signature-mint');
        },
        burnFromHolder: (
          _id: bigint,
          holder: string,
          units: bigint,
          redemption: boolean,
        ) => {
          chain.holders.set(holder, (chain.holders.get(holder) ?? 0n) - units);
          chain.registry!.outstanding -= units;
          if (chain.registry!.outstanding === 0n && redemption) {
            chain.registry!.status = 'redeemed';
          }
          chain.burns.push({ holder, units, redemption });
          return Promise.resolve('signature-burn');
        },
        setBondStatus: (_id: bigint, defaulted: boolean) => {
          chain.registry!.status = defaulted ? 'defaulted' : 'active';
          return Promise.resolve('signature-status');
        },
        holders: () =>
          Promise.resolve(
            [...chain.holders.entries()]
              .filter(([, units]) => units > 0n)
              .map(([holder, units]) => ({
                holder,
                tokenAccount: `${holder}-token`,
                units,
              })),
          ),
        actions: () => Promise.resolve([...chain.actions].reverse()),
        action: (_id: bigint, index: number) =>
          Promise.resolve(chain.actions[index] ?? null),
        declareAction: (
          _id: bigint,
          index: number,
          kind: string,
          recordTs: number,
          paymentTs: number,
          amountPerUnit: bigint,
        ) => {
          chain.actions[index] = {
            index,
            kind,
            recordTs,
            paymentTs,
            amountPerUnit,
            holders: 0,
            units: 0n,
            totalAmount: 0n,
            registerHash: '',
            settlement: null,
            votesFor: 0n,
            votesAgainst: 0n,
            status: 'declared',
          };
          return Promise.resolve('signature-declare');
        },
        recordSnapshot: (
          _id: bigint,
          index: number,
          holders: number,
          units: bigint,
          totalAmount: bigint,
          registerHash: Buffer,
        ) => {
          const action = chain.actions[index];
          Object.assign(action, {
            holders,
            units,
            totalAmount,
            registerHash: registerHash.toString('hex'),
            status: 'snapshot',
          });
          return Promise.resolve('signature-snapshot');
        },
        settleAction: (
          _id: bigint,
          index: number,
          settlement: string | null,
          votesFor: bigint,
          votesAgainst: bigint,
        ) => {
          Object.assign(chain.actions[index], {
            settlement,
            votesFor,
            votesAgainst,
            status: 'settled',
          });
          return Promise.resolve('signature-settle');
        },
        closeAction: (_id: bigint, index: number) => {
          chain.actions[index].status = 'closed';
          return Promise.resolve('signature-close');
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

    await prisma.user.create({
      data: {
        email: ADMIN.email,
        name: 'Админ',
        passwordHash: await hash(ADMIN.password),
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    const holder = (
      email: string,
      passwordHash: string,
      wallet: string,
      // Имя и страна нужны реестру: регистратор знает держателей поимённо.
      person: { firstName: string; lastName: string; country: string },
    ) =>
      prisma.user.create({
        data: {
          email,
          name: `${person.firstName} ${person.lastName}`,
          passwordHash,
          role: Role.INVESTOR,
          status: UserStatus.ACTIVE,
          investor: {
            create: {
              status: KycStatus.APPROVED,
              withdrawalAddress: wallet,
              onchainAccount: 'UserAccount1111111111111111111111111111111',
              whitelistStatus: true,
              firstName: person.firstName,
              lastName: person.lastName,
              country: person.country,
            },
          },
        },
      });
    await holder(ALICE.email, await hash(ALICE.password), ALICE_WALLET, {
      firstName: 'Alice',
      lastName: 'Nakamura',
      country: 'SGP',
    });
    await holder(BOB.email, await hash(BOB.password), BOB_WALLET, {
      firstName: 'Bob',
      lastName: 'Keller',
      country: 'CHE',
    });

    const borrower = await prisma.borrower.create({
      data: { name: 'ТОО «Эмитент»', bin: BIN },
    });
    const campaign = (title: string, kind: ScheduleKind, onchainId: bigint) =>
      prisma.campaign.create({
        data: {
          borrowerId: borrower.id,
          title,
          state: CampaignState.PUBLISHED,
          onchainId,
          mint: MINT,
          mintDecimals: 6,
          scheduleKind: kind,
          annualRateBps: 1200,
          periodsPerYear: 2,
          periodCount: 4,
          minTicket: USDC,
          bondFaceValue: FACE,
          scheduleStep: ScheduleStep.MONTH,
        },
      });

    bondId = (
      await campaign('Облигация на проверку', ScheduleKind.COUPON, 501n)
    ).id;
    loanId = (await campaign('Кредит на проверку', ScheduleKind.ANNUITY, 502n))
      .id;

    // Адреса пополнения: по ним платформа и знает, кто держатель. Без них
    // реестр остался бы безымянным, как было до появления этой связи.
    for (const email of [ALICE.email, BOB.email]) {
      const investor = await prisma.investor.findFirstOrThrow({
        where: { user: { email } },
        select: { id: true, withdrawalAddress: true },
      });
      await prisma.campaignDeposit.create({
        data: {
          investorId: investor.id,
          campaignId: bondId,
          owner: `owner-${investor.withdrawalAddress}`,
          address: `token-${investor.withdrawalAddress}`,
        },
      });
    }

    const login = async (email: string, password: string) => {
      const response = await http()
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      return (response.headers['set-cookie'] as unknown as string[])[0];
    };
    adminCookie = await login(ADMIN.email, ADMIN.password);
    aliceCookie = await login(ALICE.email, ALICE.password);
    bobCookie = await login(BOB.email, BOB.password);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  describe('выпуск', () => {
    it('по кредиту бумага не выпускается', async () => {
      await http()
        .post(`/bonds/${loanId}/issue`)
        .set('Cookie', adminCookie)
        .expect(404);
    });

    it('по облигации выпускается с условиями из кампании', async () => {
      const response = await http()
        .post(`/bonds/${bondId}/issue`)
        .set('Cookie', adminCookie)
        .expect(200);

      const body = response.body as {
        registry: {
          faceValue: string;
          couponRateBps: number;
          outstanding: string;
        };
        couponPerUnit: string;
      };
      expect(body.registry.faceValue).toBe(FACE.toString());
      expect(body.registry.couponRateBps).toBe(1200);
      expect(body.registry.outstanding).toBe('0');
      // 1 USDC × 12% ÷ 2 = 0,06 USDC на бумагу.
      expect(body.couponPerUnit).toBe('60000');
    });

    it('повторный выпуск ничего не ломает', async () => {
      await http()
        .post(`/bonds/${bondId}/issue`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(chain.registry?.issued.toString()).toBe('0');
    });
  });

  describe('бумаги у держателей', () => {
    it('выдаются в момент взноса', async () => {
      const alice = await prisma.investor.findFirst({
        where: { user: { email: ALICE.email } },
      });
      const bob = await prisma.investor.findFirst({
        where: { user: { email: BOB.email } },
      });

      const bonds = app.get<{
        mintForInvestment: (c: string, i: string, a: bigint) => Promise<void>;
      }>(
        // Сервис зовут из зачисления взноса — здесь делаем то же самое.
        (await import('../src/bonds/bonds.service.js')).BondsService,
      );
      await bonds.mintForInvestment(bondId, alice!.id, 4n * USDC);
      await bonds.mintForInvestment(bondId, bob!.id, 6n * USDC);
      // Половина номинала бумагой не оформляется.
      await bonds.mintForInvestment(bondId, alice!.id, USDC / 2n);

      expect(chain.holders.get(ALICE_WALLET)?.toString()).toBe('4');
      expect(chain.holders.get(BOB_WALLET)?.toString()).toBe('6');
      expect(chain.registry?.outstanding.toString()).toBe('10');
    });

    it('держатель видит свои бумаги и сколько придёт купоном', async () => {
      const response = await http()
        .get('/investors/me/bonds')
        .set('Cookie', aliceCookie)
        .expect(200);

      const row = (response.body.rows as Record<string, string>[])[0];
      expect(row.units).toBe('4');
      // 4 бумаги × 0,06 USDC.
      expect(row.couponAmount).toBe('240000');
      expect(row.mint).toBe(BOND_MINT);
    });
  });

  describe('купон', () => {
    const recordTs = Math.floor(Date.now() / 1000) - 60;

    it('объявляется с датой фиксации и суммой из условий', async () => {
      const response = await http()
        .post(`/bonds/${bondId}/actions`)
        .set('Cookie', adminCookie)
        .send({ kind: 'coupon', recordTs, paymentTs: recordTs + 60 })
        .expect(200);

      const body = response.body as { index: number; amountPerUnit: string };
      expect(body.index).toBe(0);
      expect(body.amountPerUnit).toBe('60000');
    });

    it('дата исполнения раньше даты фиксации отклоняется', async () => {
      await http()
        .post(`/bonds/${bondId}/actions`)
        .set('Cookie', adminCookie)
        .send({ kind: 'coupon', recordTs, paymentTs: recordTs - 1 })
        .expect(400);
    });

    it('снятый реестр совпадает с держателями и даёт хеш', async () => {
      const response = await http()
        .post(`/bonds/${bondId}/actions/0/snapshot`)
        .set('Cookie', adminCookie)
        .expect(200);

      const body = (
        response.body as {
          snapshot: {
            holders: number;
            units: string;
            total: string;
            hash: string;
          };
        }
      ).snapshot;
      expect(body.holders).toBe(2);
      expect(body.units).toBe('10');
      // 10 бумаг × 0,06 USDC = 0,6 USDC на весь выпуск.
      expect(body.total).toBe('600000');
      expect(body.hash).toHaveLength(64);
    });

    it('опубликованный реестр сходится с тем, что ушло в сеть', async () => {
      const response = await http()
        .get(`/bonds/${bondId}/register/0`)
        .set('Cookie', adminCookie)
        .expect(200);

      const body = response.body as {
        hash: string;
        holders: { holder: string; units: string; amount: string }[];
      };
      expect(body.hash).toBe(chain.actions[0].registerHash);
      const alice = body.holders.find((row) => row.holder === ALICE_WALLET);
      expect(alice?.units).toBe('4');
      expect(alice?.amount).toBe('240000');
    });

    it('исполнение само находит подпись платежа из dala_capital', async () => {
      // Платёж до даты фиксации к этому купону отношения не имеет: тогда
      // платить держателям было ещё не из чего.
      await prisma.campaignEvent.createMany({
        data: [
          {
            campaignId: bondId,
            signature: 'repayment-before-record',
            slot: 100n,
            blockTime: new Date((recordTs - 600) * 1000),
            index: 0,
            name: 'RepaymentProcessed',
            payload: {},
          },
          {
            campaignId: bondId,
            signature: 'repayment-after-record',
            slot: 200n,
            blockTime: new Date((recordTs + 600) * 1000),
            index: 0,
            name: 'RepaymentProcessed',
            payload: {},
          },
        ],
      });

      const response = await http()
        .post(`/bonds/${bondId}/actions/0/settle`)
        .set('Cookie', adminCookie)
        .send({})
        .expect(200);

      expect((response.body as { settlement: string }).settlement).toBe(
        'repayment-after-record',
      );
      expect(chain.actions[0].status).toBe('settled');
      expect(chain.actions[0].settlement).toBe('repayment-after-record');
    });

    it('исполненное, но не закрытое действие попадает в задачи админа', async () => {
      const response = await http()
        .get('/tasks')
        .set('Cookie', adminCookie)
        .expect(200);

      const task = (response.body as { key: string; href: string }[]).find(
        (item) => item.key === 'actions',
      );
      // Ведёт в облигации; когда ждёт один выпуск — прямо в него. Точную
      // ссылку здесь не проверяем: сквозные файлы идут параллельно, и чужие
      // купонные выпуски попадают в тот же счёт.
      expect(task?.href.startsWith('/admin/bonds')).toBe(true);
    });

    it('и закрывается', async () => {
      await http()
        .post(`/bonds/${bondId}/actions/0/close`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(chain.actions[0].status).toBe('closed');
    });
  });

  describe('голосование по дефолту', () => {
    const recordTs = Math.floor(Date.now() / 1000) - 60;

    it('без бюджета взыскания не объявляется', async () => {
      const response = await http()
        .post(`/bonds/${bondId}/actions`)
        .set('Cookie', adminCookie)
        .send({ kind: 'vote', recordTs, paymentTs: recordTs + 60 })
        .expect(400);

      expect((response.body as { message: string }).message).toContain(
        'бюджет взыскания',
      );
    });

    it('объявляется с одобряемым бюджетом взыскания', async () => {
      const response = await http()
        .post(`/bonds/${bondId}/actions`)
        .set('Cookie', adminCookie)
        .send({
          kind: 'vote',
          recordTs,
          paymentTs: recordTs + 60,
          amountPerUnit: (5n * USDC).toString(),
        })
        .expect(200);
      expect((response.body as { index: number }).index).toBe(1);

      const snapshot = await http()
        .post(`/bonds/${bondId}/actions/1/snapshot`)
        .set('Cookie', adminCookie)
        .expect(200);

      // Бюджет взыскания — сумма на всё дело: на бумаги он не множится.
      const body = snapshot.body as {
        snapshot: { total: string; units: string; rows: { amount: string }[] };
      };
      expect(body.snapshot.units).toBe('10');
      expect(body.snapshot.total).toBe('0');
      expect(body.snapshot.rows.every((row) => row.amount === '0')).toBe(true);
    });

    it('держателю видно, что голосование ждёт его', async () => {
      const waiting = await http()
        .get('/tasks')
        .set('Cookie', aliceCookie)
        .expect(200);

      const vote = (
        waiting.body as { key: string; count: number; deadline: number }[]
      ).find((task) => task.key === 'vote');
      expect(vote?.count).toBe(1);
      // Срок виден сразу: у голосования он решает, успеешь ты или нет.
      expect(vote?.deadline).toBe(recordTs + 60);
    });

    it('вес голоса берётся из реестра на дату фиксации', async () => {
      const response = await http()
        .post(`/investors/me/bonds/${bondId}/actions/1/vote`)
        .set('Cookie', aliceCookie)
        .send({ choice: 'FOR' })
        .expect(200);

      const tally = (response.body as { tally: Record<string, unknown> }).tally;
      expect(tally.forUnits).toBe('4');
      // 4 из 10 бумаг — явка 40%, кворума в половину выпуска ещё нет.
      expect(tally.turnoutBps).toBe(4_000);
      expect(tally.quorumReached).toBe(false);
    });

    it('после голоса задача пропадает сама', async () => {
      const done = await http()
        .get('/tasks')
        .set('Cookie', aliceCookie)
        .expect(200);

      expect(
        (done.body as { key: string }[]).some((task) => task.key === 'vote'),
      ).toBe(false);
    });

    it('второй голос добирает кворум и решает исход', async () => {
      const response = await http()
        .post(`/investors/me/bonds/${bondId}/actions/1/vote`)
        .set('Cookie', bobCookie)
        .send({ choice: 'AGAINST' })
        .expect(200);

      const tally = (response.body as { tally: Record<string, unknown> }).tally;
      expect(tally.forUnits).toBe('4');
      expect(tally.againstUnits).toBe('6');
      expect(tally.quorumReached).toBe(true);
      // Против больше — дефолт не объявляется.
      expect(tally.passed).toBe(false);
    });

    it('держатель видит текущий итог до записи в сеть', async () => {
      const response = await http()
        .get('/investors/me/bonds')
        .set('Cookie', aliceCookie)
        .expect(200);

      const row = (response.body as { rows: Record<string, unknown>[] })
        .rows[0];
      const action = (row.actions as Record<string, string | boolean>[]).find(
        (item) => item.kind === 'vote',
      )!;

      // В сети итога ещё нет: он уходит туда только при исполнении.
      expect(action.votesFor).toBe('0');
      expect(action.votesAgainst).toBe('0');
      // А подсчёт по бюллетеням уже виден — и чужие голоса в нём тоже.
      expect(action.liveFor).toBe('4');
      expect(action.liveAgainst).toBe('6');
      expect(action.liveQuorumReached).toBe(true);
      // Свой голос держатель видит отдельно от чужих.
      expect(action.myVote).toBe('FOR');
    });

    it('голос можно изменить до закрытия, двойного веса не появляется', async () => {
      const response = await http()
        .post(`/investors/me/bonds/${bondId}/actions/1/vote`)
        .set('Cookie', bobCookie)
        .send({ choice: 'FOR' })
        .expect(200);

      const tally = (response.body as { tally: Record<string, unknown> }).tally;
      expect(tally.forUnits).toBe('10');
      expect(tally.againstUnits).toBe('0');
      expect(tally.passed).toBe(true);
    });

    it('админ видит текущий итог до записи в сеть', async () => {
      const response = await http()
        .get(`/bonds/${bondId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const action = (
        response.body as { actions: Record<string, string | boolean>[] }
      ).actions.find((item) => item.kind === 'vote')!;

      expect(action.votesFor).toBe('0');
      expect(action.liveFor).toBe('10');
      expect(action.liveAgainst).toBe('0');
      expect(action.liveQuorumReached).toBe(true);
    });

    it('итог голосования уходит в сеть при исполнении', async () => {
      await http()
        .post(`/bonds/${bondId}/actions/1/settle`)
        .set('Cookie', adminCookie)
        .send({ settlement: 'ballots-hash' })
        .expect(200);

      // Переданную подпись не подменяем: у голосования платежа и нет.
      expect(chain.actions[1].settlement).toBe('ballots-hash');

      expect(chain.actions[1].votesFor.toString()).toBe('10');
      expect(chain.actions[1].votesAgainst.toString()).toBe('0');
    });

    it('не держатель проголосовать не может', async () => {
      await prisma.bondVote.deleteMany({
        where: { investor: { user: { email: { in: EMAILS } } } },
      });
      const stranger = await prisma.investor.findFirst({
        where: { user: { email: ALICE.email } },
      });
      await prisma.investor.update({
        where: { id: stranger!.id },
        data: {
          withdrawalAddress: 'StrangerWallet1111111111111111111111111111',
        },
      });

      await http()
        .post(`/investors/me/bonds/${bondId}/actions/1/vote`)
        .set('Cookie', aliceCookie)
        .send({ choice: 'FOR' })
        .expect(403);

      await prisma.investor.update({
        where: { id: stranger!.id },
        data: { withdrawalAddress: ALICE_WALLET },
      });
    });
  });

  describe('реестр без выплаты', () => {
    const recordTs = Math.floor(Date.now() / 1000) - 30;

    it('объявляется без суммы и без второй даты', async () => {
      const declared = await http()
        .post(`/bonds/${bondId}/actions`)
        .set('Cookie', adminCookie)
        // Сумму и дату шлём нарочно: у этого вида их не бывает.
        .send({
          kind: 'record',
          recordTs,
          paymentTs: recordTs + 10_000,
          amountPerUnit: (7n * USDC).toString(),
        })
        .expect(200);

      const index = (declared.body as { index: number }).index;
      expect((declared.body as { amountPerUnit: string }).amountPerUnit).toBe(
        '0',
      );

      const page = await http()
        .get(`/bonds/${bondId}`)
        .set('Cookie', adminCookie)
        .expect(200);
      const action = (
        page.body as { actions: Record<string, string | number>[] }
      ).actions.find((item) => item.index === index)!;

      expect(action.amountPerUnit).toBe('0');
      // Второй даты у него нет: контракт её требует, мы приравниваем.
      expect(action.paymentTs).toBe(recordTs);
    });

    it('закрывается сразу после снятия реестра, без исполнения', async () => {
      const page = await http()
        .get(`/bonds/${bondId}`)
        .set('Cookie', adminCookie)
        .expect(200);
      const index = (
        page.body as { actions: Record<string, string | number>[] }
      ).actions.find((item) => item.kind === 'record')!.index as number;

      await http()
        .post(`/bonds/${bondId}/actions/${index}/snapshot`)
        .set('Cookie', adminCookie)
        .expect(200);
      await http()
        .post(`/bonds/${bondId}/actions/${index}/close`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(chain.actions[index].status).toBe('closed');
    });
  });

  describe('реестр поимённо', () => {
    /** Служебный реестр уже снят предыдущим блоком — на нём и проверяем. */
    const recordIndex = async () => {
      const page = await http()
        .get(`/bonds/${bondId}`)
        .set('Cookie', adminCookie)
        .expect(200);
      return (page.body as { actions: { kind: string; index: number }[] })
        .actions.find((item) => item.kind === 'record')!.index;
    };

    it('держатели на экране админа названы по анкете', async () => {
      const page = await http()
        .get(`/bonds/${bondId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const holders = (
        page.body as {
          holders: {
            holder: string;
            investor: { title: string; investorId: string; country: string } | null;
          }[];
        }
      ).holders;
      const alice = holders.find((row) => row.holder === ALICE_WALLET);
      expect(alice?.investor?.title).toBe('Alice Nakamura');
      expect(alice?.investor?.country).toBe('SGP');
      expect(alice?.investor?.investorId).toBeTruthy();
    });

    it('выписка — документ: имя, доля и оговорка про хеш', async () => {
      const response = await http()
        .get(`/bonds/${bondId}/register/${await recordIndex()}/csv`)
        .set('Cookie', adminCookie)
        .expect(200);

      const body = response.text;
      expect(body).toContain('Лицевой счёт');
      expect(body).toContain('Доля, %');
      expect(body).toContain('Alice Nakamura');
      expect(body).toContain('Физическое лицо');
      // Ответ на вопрос «что мешает подменить имя» стоит в самом документе.
      expect(body).toContain('имя и страна — атрибуты анкеты');
      // Удостоверяющих данных в обычной выписке нет.
      expect(body).not.toContain('Удостоверяющий документ');
    });

    it('расширенная выписка добавляет документы и пишется в журнал', async () => {
      const index = await recordIndex();
      const before = await prisma.adminAction.count({
        where: { action: 'registerFullExport' },
      });

      const response = await http()
        .get(`/bonds/${bondId}/register/${index}/csv?full=1`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(response.text).toContain('Удостоверяющий документ');
      expect(
        await prisma.adminAction.count({
          where: { action: 'registerFullExport' },
        }),
      ).toBe(before + 1);
    });

    it('журнал выгружается таблицей с кодами ISO 15022', async () => {
      const response = await http()
        .get(`/bonds/${bondId}/journal/csv`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(response.text).toContain('CAEV');
      expect(response.text).toContain('Купон');
      expect(response.text).toContain('INTR');
    });

    /**
     * Имена — только админу. Инвестор видит анонимные доли, и это не вопрос
     * вкуса: иначе платформа раздавала бы персональные данные участникам.
     */
    it('инвестору имена других не достаются', async () => {
      const response = await http()
        .get(`/investors/me/campaigns/${bondId}`)
        .set('Cookie', bobCookie)
        .expect(200);

      const body = JSON.stringify(response.body);
      expect(body).not.toContain('Nakamura');
      expect(body).not.toContain('investorId');
    });
  });

  describe('смена адреса вывода', () => {
    const MOVED = 'MovedWallet11111111111111111111111111111111';

    it('бумаги переезжают на новый адрес, в обращении не меняется', async () => {
      const bonds = app.get<{
        moveBonds: (from: string, to: string) => Promise<void>;
      }>((await import('../src/bonds/bonds.service.js')).BondsService);

      await bonds.moveBonds(ALICE_WALLET, MOVED);

      expect(chain.holders.get(ALICE_WALLET)?.toString()).toBe('0');
      expect(chain.holders.get(MOVED)?.toString()).toBe('4');
      // Сожгли столько же, сколько выпустили: выпуск не изменился.
      expect(chain.registry?.outstanding.toString()).toBe('10');

      await bonds.moveBonds(MOVED, ALICE_WALLET);
      expect(chain.holders.get(ALICE_WALLET)?.toString()).toBe('4');
      expect(chain.registry?.outstanding.toString()).toBe('10');
    });
  });

  describe('дефолт и погашение', () => {
    it('дефолт меняет статус выпуска, бумаги остаются', async () => {
      const bonds = app.get<{
        setDefaulted: (c: string, d: boolean) => Promise<void>;
      }>((await import('../src/bonds/bonds.service.js')).BondsService);
      await bonds.setDefaulted(bondId, true);

      expect(chain.registry?.status).toBe('defaulted');
      expect(chain.registry?.outstanding.toString()).toBe('10');
    });

    it('у действующего займа бумаги не гасятся', async () => {
      const response = await http()
        .post(`/bonds/${bondId}/redeem`)
        .set('Cookie', adminCookie)
        .expect(400);

      expect((response.body as { message: string }).message).toContain(
        'полностью погашен',
      );
      // Бумаги на месте: отказ случился до прожига.
      expect(chain.registry?.outstanding.toString()).toBe('10');
    });

    it('погашение сжигает бумаги всех держателей и закрывает выпуск', async () => {
      dealState = 'repaid';
      // Переносы адреса тоже жгут бумаги, но без пометки о погашении:
      // смотрим только то, что сожжено этим вызовом.
      const before = chain.burns.length;
      const response = await http()
        .post(`/bonds/${bondId}/redeem`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect((response.body as { burned: number }).burned).toBe(2);
      expect(chain.registry?.outstanding.toString()).toBe('0');
      expect(chain.registry?.status).toBe('redeemed');
      expect(chain.burns.slice(before).every((burn) => burn.redemption)).toBe(
        true,
      );
    });
  });

  describe('доступ', () => {
    it('инвестора в управление выпуском не пускают', async () => {
      await http().get('/bonds').set('Cookie', aliceCookie).expect(403);
      await http()
        .post(`/bonds/${bondId}/actions`)
        .set('Cookie', aliceCookie)
        .send({ kind: 'coupon', recordTs: 1, paymentTs: 2 })
        .expect(403);
    });

    it('админа в кабинет держателя не пускают', async () => {
      await http()
        .get('/investors/me/bonds')
        .set('Cookie', adminCookie)
        .expect(403);
    });
  });
});
