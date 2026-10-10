/**
 * Сквозные тесты кампаний: черновик, предпросмотр, выгрузка, проверки, права.
 * Отправку в сеть подменяем: реальная публикация проверяется вживую на devnet.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { BorrowerStatus, Role, UserStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SolanaService } from '../src/solana/solana.service.js';

const ADMIN = {
  email: 'e2e-c-admin@example.com',
  password: 'пароль-админа-длинный',
};
const INVESTOR = {
  email: 'e2e-c-investor@example.com',
  password: 'пароль-инвестора-длин',
};

/** БИН Халык банка: контрольная цифра верная. */
const BIN = '940140000385';
/** Второй заёмщик — чтобы проверить, что чужой кошелёк не подставить. */
const OTHER_BIN = '240140000001';
const WALLET = 'JCLPbcLwdYJs1UJgL6LK1nhYRUcGk5ziFPx55nVL9akB';
/** Devnet USDC: у кампании обязательно есть расчётный токен. */
const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const USDC = 1_000_000n;

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('Кампании (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let adminCookie: string;
  let investorCookie: string;
  let borrowerId: string;
  let walletId: string;
  let campaignId: string;

  const http = () => request(app.getHttpServer());

  async function cleanup() {
    await prisma.campaign.deleteMany({
      where: { borrower: { bin: { in: [BIN, OTHER_BIN] } } },
    });
    await prisma.borrower.deleteMany({
      where: { bin: { in: [BIN, OTHER_BIN] } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [ADMIN.email, INVESTOR.email] } },
    });
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Сеть в тестах не трогаем: проверяем только наши правила и расчёты.
      .overrideProvider(SolanaService)
      .useValue({
        isMintAllowed: async () => true,
        defaultMintAddress: MINT,
        cluster: 'devnet',
        dealPda: () => ({ toBase58: () => 'deal' }),
        explorerTx: (signature: string) =>
          `https://solscan.io/tx/${signature}?cluster=devnet`,
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

    for (const [account, role] of [
      [ADMIN, Role.ADMIN],
      [INVESTOR, Role.INVESTOR],
    ] as const) {
      await prisma.user.create({
        data: {
          email: account.email,
          name: 'Тест',
          passwordHash: await hash(account.password),
          role,
          status: UserStatus.ACTIVE,
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
    investorCookie = await login(INVESTOR.email, INVESTOR.password);

    const borrower = await prisma.borrower.create({
      data: {
        name: 'ТОО «Кампании»',
        bin: BIN,
        status: BorrowerStatus.DRAFT,
        wallets: {
          create: { label: 'Основной', address: WALLET, isDefault: true },
        },
      },
      include: { wallets: true },
    });
    borrowerId = borrower.id;
    walletId = borrower.wallets[0].id;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('инвестор и неавторизованный к кампаниям не допускаются', async () => {
    await http().get('/campaigns').expect(401);
    await http().get('/campaigns').set('Cookie', investorCookie).expect(403);
  });

  it('черновик создаётся и сразу берёт основной кошелёк заёмщика', async () => {
    const response = await http()
      .post('/campaigns')
      .set('Cookie', adminCookie)
      .send({ borrowerId, title: 'Оборотный заём на закуп' })
      .expect(201);

    expect(response.body.state).toBe('DRAFT');
    // Токен по умолчанию подставляется сразу, его можно сменить на шаге «Деньги».
    expect(response.body.mint).toBe(MINT);
    expect(response.body.walletId).toBe(walletId);
    campaignId = response.body.id;
  });

  it('черновик правится шагами и переживает перезагрузку', async () => {
    await http()
      .patch(`/campaigns/${campaignId}`)
      .set('Cookie', adminCookie)
      .send({ purpose: 'Закуп товара к сезону', step: 2 })
      .expect(200);

    await http()
      .patch(`/campaigns/${campaignId}`)
      .set('Cookie', adminCookie)
      .send({
        softCap: (50_000n * USDC).toString(),
        hardCap: (100_000n * USDC).toString(),
        minTicket: (100n * USDC).toString(),
        annualRateBps: 1_000,
        periodsPerYear: 12,
        periodCount: 12,
        step: 3,
      })
      .expect(200);

    const saved = await http()
      .get(`/campaigns/${campaignId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(saved.body.purpose).toBe('Закуп товара к сезону');
    // Суммы отдаются строками: BigInt в JSON не сериализуется.
    expect(saved.body.hardCap).toBe((100_000n * USDC).toString());
    expect(saved.body.step).toBe(3);
  });

  it('чужой кошелёк выбрать нельзя', async () => {
    const other = await prisma.borrowerWallet.create({
      data: {
        borrowerId: (
          await prisma.borrower.create({
            data: { name: 'ТОО «Чужое»', bin: OTHER_BIN },
          })
        ).id,
        label: 'Чужой',
        address: '5vDZ4BWLTZFfumMgSsTQmekF7mnLhJ8VZv7YqnZVyhk2',
      },
    });

    await http()
      .patch(`/campaigns/${campaignId}`)
      .set('Cookie', adminCookie)
      .send({ walletId: other.id })
      .expect(400);

    await prisma.borrower.deleteMany({ where: { bin: OTHER_BIN } });
  });

  it('предпросмотр считает график для минимума и максимума сбора', async () => {
    await http()
      .patch(`/campaigns/${campaignId}`)
      .set('Cookie', adminCookie)
      .send({
        fundingStart: iso(0),
        fundingDeadline: iso(HOUR),
        firstDueAt: iso(DAY),
      })
      .expect(200);

    const response = await http()
      .post(`/campaigns/${campaignId}/preview`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);

    expect(response.body.max.periods).toHaveLength(12);
    // Эталон контракта: платёж ≈ 8 791,59 при 100 000 под 10% на 12 месяцев.
    expect(Number(response.body.max.periods[0].total) / 1e6).toBeCloseTo(
      8_791.59,
      1,
    );
    // Половина суммы — половина платежа.
    expect(Number(response.body.min.periods[0].total) / 1e6).toBeCloseTo(
      4_395.79,
      1,
    );
    expect(response.body.max.periods[11].balance).toBe('0');
  });

  it('предпросмотр учитывает несохранённые правки и объясняет нехватку данных', async () => {
    const coupon = await http()
      .post(`/campaigns/${campaignId}/preview`)
      .set('Cookie', adminCookie)
      .send({ scheduleKind: 'COUPON' })
      .expect(201);
    // У купона тело только в последнем платеже.
    expect(coupon.body.max.periods[0].principal).toBe('0');

    const draft = await http()
      .post('/campaigns')
      .set('Cookie', adminCookie)
      .send({ borrowerId, title: 'Пустой черновик' })
      .expect(201);
    const empty = await http()
      .post(`/campaigns/${draft.body.id}/preview`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(400);
    expect(empty.body.message).toContain('сумму сбора');

    await http()
      .delete(`/campaigns/${draft.body.id}`)
      .set('Cookie', adminCookie)
      .expect(204);
  });

  it('график выгружается в CSV с заголовком и итогом', async () => {
    const response = await http()
      .get(`/campaigns/${campaignId}/schedule.csv`)
      .set('Cookie', adminCookie)
      .expect(200);

    expect(response.headers['content-type']).toContain('text/csv');
    const lines = response.text.trimEnd().split('\r\n');
    expect(lines[0]).toContain('Остаток долга');
    expect(lines).toHaveLength(14);
    expect(lines[13]).toContain('Итого');
  });

  it('проверки показывают, что мешает публикации', async () => {
    const before = await http()
      .get(`/campaigns/${campaignId}/checks`)
      .set('Cookie', adminCookie)
      .expect(200);

    const borrowerCheck = before.body.find(
      (check: { key: string }) => check.key === 'borrower',
    );
    expect(borrowerCheck.ok).toBe(false);
    expect(borrowerCheck.hint).toContain('Допущен');

    // Допускаем заёмщика — проверка проходит, остальные уже в порядке.
    await prisma.borrower.update({
      where: { id: borrowerId },
      data: { status: BorrowerStatus.APPROVED },
    });
    const after = await http()
      .get(`/campaigns/${campaignId}/checks`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(after.body.every((check: { ok: boolean }) => check.ok)).toBe(true);
  });

  it('публикация недопущенного заёмщика отклоняется с понятным текстом', async () => {
    await prisma.borrower.update({
      where: { id: borrowerId },
      data: { status: BorrowerStatus.SUSPENDED },
    });

    const response = await http()
      .post(`/campaigns/${campaignId}/publish`)
      .set('Cookie', adminCookie)
      .expect(400);
    expect(response.body.message).toContain('Заёмщик допущен');

    await prisma.borrower.update({
      where: { id: borrowerId },
      data: { status: BorrowerStatus.APPROVED },
    });
  });

  it('опубликованную кампанию нельзя править и удалять', async () => {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { state: 'PUBLISHED', onchainId: 7n },
    });

    const patch = await http()
      .patch(`/campaigns/${campaignId}`)
      .set('Cookie', adminCookie)
      .send({ title: 'Другое название' })
      .expect(409);
    expect(patch.body.message).toContain('контракт');

    await http()
      .delete(`/campaigns/${campaignId}`)
      .set('Cookie', adminCookie)
      .expect(409);

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { state: 'DRAFT', onchainId: null },
    });
  });

  it('черновик удаляется', async () => {
    await http()
      .delete(`/campaigns/${campaignId}`)
      .set('Cookie', adminCookie)
      .expect(204);
    await http()
      .get(`/campaigns/${campaignId}`)
      .set('Cookie', adminCookie)
      .expect(404);
  });
});
