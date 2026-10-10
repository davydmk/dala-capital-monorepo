/**
 * Сквозные тесты онбординга инвестора: анкета по шагам, отправка, решение
 * админа и заведение аккаунта в контракте. Сеть подменяем: реальное создание
 * аккаунта проверяется вживую на devnet.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import {
  InvestorType,
  KycStatus,
  Role,
  UserStatus,
  type Investor,
} from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SolanaService } from '../src/solana/solana.service.js';
import { WalletCheckService } from '../src/borrowers/wallet-check.js';

const ADMIN = {
  email: 'e2e-i-admin@example.com',
  password: 'пароль-админа-длин',
};
const INVESTOR = {
  email: 'e2e-i-person@example.com',
  password: 'пароль-инвестора-длин',
};
const COMPANY = {
  email: 'e2e-i-company@example.com',
  password: 'пароль-компании-длинн',
};
const EMAILS = [ADMIN.email, INVESTOR.email, COMPANY.email];

const WITHDRAWAL = 'CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq';
const OTHER_WITHDRAWAL = 'JCLPbcLwdYJs1UJgL6LK1nhYRUcGk5ziFPx55nVL9akB';
const USER_PDA = 'DaLaUserPdaAddress11111111111111111111111111';

/** Полная анкета физлица: тесты отправляют её целиком или по частям. */
const PROFILE = {
  firstName: 'Ivan',
  lastName: 'Petrov',
  dob: '1990-05-01T00:00:00.000Z',
  countryOfBirth: 'KAZ',
  nationality: 'KAZ',
  country: 'ARE',
  addressLine: 'Marina 1',
  city: 'Dubai',
  phone: '+971500000000',
  idDocType: 'PASSPORT',
  idDocNumber: 'N12345678',
  idDocCountry: 'KAZ',
  idDocValidUntil: '2030-01-01T00:00:00.000Z',
  sourceOfFunds: 'SALARY',
  isPep: false,
  acceptTerms: true,
  acceptRisk: true,
  withdrawalAddress: WITHDRAWAL,
};

describe('Онбординг инвестора (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let adminCookie: string;
  let investorCookie: string;
  let companyCookie: string;
  let investorId: string;

  /** Состояние подменённой сети: аккаунт появляется после createUser. */
  const chain = {
    accounts: new Map<
      string,
      { whitelistStatus: boolean; changedAt: number }
    >(),
    created: 0,
    whitelistCalls: 0,
  };

  const http = () => request(app.getHttpServer());

  async function cleanup() {
    // Журнал действий ссылается на админа: без этого пользователя не удалить.
    await prisma.adminAction.deleteMany({
      where: { actor: { email: { in: EMAILS } } },
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
        explorerAddress: (address: string) =>
          `https://solscan.io/account/${address}?cluster=devnet`,
        explorerTx: (signature: string) =>
          `https://solscan.io/tx/${signature}?cluster=devnet`,
        userAccount: (userId: Uint8Array) => {
          const key = userId.join('-');
          const account = chain.accounts.get(key);
          return Promise.resolve(
            account
              ? {
                  address: USER_PDA,
                  entityType: 'INDIVIDUAL',
                  withdrawalAddress: WITHDRAWAL,
                  whitelistStatus: account.whitelistStatus,
                  withdrawalAddressChangedAt: account.changedAt,
                }
              : null,
          );
        },
        createUser: (userId: Uint8Array) => {
          chain.created += 1;
          chain.accounts.set(userId.join('-'), {
            whitelistStatus: true,
            changedAt: 0,
          });
          return Promise.resolve('signature-create');
        },
        setWhitelistStatus: (userId: Uint8Array, enabled: boolean) => {
          chain.whitelistCalls += 1;
          const account = chain.accounts.get(userId.join('-'));
          if (account) account.whitelistStatus = enabled;
          return Promise.resolve('signature-whitelist');
        },
        setWithdrawalAddress: (userId: Uint8Array) => {
          const account = chain.accounts.get(userId.join('-'));
          if (account) {
            account.whitelistStatus = false;
            account.changedAt = Math.floor(Date.now() / 1000);
          }
          return Promise.resolve('signature-address');
        },
      })
      // Проверка адреса ходит в сеть: в тестах она не нужна.
      .overrideProvider(WalletCheckService)
      .useValue({ check: () => Promise.resolve({ ok: true }) })
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

    for (const [account, role, status] of [
      [ADMIN, Role.ADMIN, UserStatus.ACTIVE],
      [INVESTOR, Role.INVESTOR, UserStatus.PENDING],
      [COMPANY, Role.INVESTOR, UserStatus.PENDING],
    ] as const) {
      await prisma.user.create({
        data: {
          email: account.email,
          name: 'Тест',
          passwordHash: await hash(account.password),
          role,
          status,
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
    companyCookie = await login(COMPANY.email, COMPANY.password);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  /** Загружает документ нужного вида от имени инвестора. */
  const upload = (cookie: string, kind: string) =>
    http()
      .post('/investors/me/documents')
      .set('Cookie', cookie)
      .field('kind', kind)
      .attach('file', Buffer.from(`файл ${kind}`), {
        filename: `${kind}.png`,
        contentType: 'image/png',
      })
      .expect(201);

  describe('анкета', () => {
    it('заводится при первом обращении и сразу показывает, чего не хватает', async () => {
      const response = await http()
        .get('/investors/me')
        .set('Cookie', investorCookie)
        .expect(200);

      investorId = (response.body.investor as Investor).id;
      expect(response.body.investor.status).toBe(KycStatus.DRAFT);
      expect(response.body.investor.type).toBe(InvestorType.INDIVIDUAL);
      expect(
        (response.body.checks as { key: string; ok: boolean }[]).some(
          (check) => !check.ok,
        ),
      ).toBe(true);
    });

    it('сохраняется по шагам и переживает перезагрузку', async () => {
      await http()
        .put('/investors/me')
        .set('Cookie', investorCookie)
        .send({ firstName: 'Ivan', lastName: 'Petrov', step: 2 })
        .expect(200);

      // Второй шаг не должен затирать первый.
      await http()
        .put('/investors/me')
        .set('Cookie', investorCookie)
        .send({ city: 'Dubai', step: 3 })
        .expect(200);

      const response = await http()
        .get('/investors/me')
        .set('Cookie', investorCookie)
        .expect(200);
      expect(response.body.investor.firstName).toBe('Ivan');
      expect(response.body.investor.city).toBe('Dubai');
      expect(response.body.investor.step).toBe(3);
    });

    it('принимает пустые поля: незаполненный черновик — это норма', async () => {
      await http()
        .put('/investors/me')
        .set('Cookie', investorCookie)
        .send({
          dob: '',
          country: '',
          nationality: '',
          idDocValidUntil: '',
          withdrawalAddress: '',
        })
        .expect(200);
    });

    it('очищает поле, если его стёрли в форме', async () => {
      await http()
        .put('/investors/me')
        .set('Cookie', investorCookie)
        .send({ middleName: 'Сергеевич' })
        .expect(200);
      const cleared = await http()
        .put('/investors/me')
        .set('Cookie', investorCookie)
        .send({ middleName: '' })
        .expect(200);
      expect(cleared.body.investor.middleName).toBeNull();
    });

    it('не принимает страну не из справочника', async () => {
      await http()
        .put('/investors/me')
        .set('Cookie', investorCookie)
        .send({ country: 'Эмираты' })
        .expect(400);
    });

    it('отдаёт справочник стран без запрещённых подсказок', async () => {
      const response = await http()
        .get('/countries')
        .set('Cookie', investorCookie)
        .expect(200);

      const countries = response.body as {
        code: string;
        name: string;
        blocked: boolean;
      }[];
      expect(countries.find((item) => item.code === 'KAZ')?.name).toBe(
        'Казахстан',
      );
      expect(countries.find((item) => item.code === 'PRK')?.blocked).toBe(true);
    });

    it('не отправляет неполную анкету и объясняет, что дозаполнить', async () => {
      const response = await http()
        .post('/investors/me/submit')
        .set('Cookie', investorCookie)
        .expect(400);
      expect(String(response.body.message)).toMatch(
        /дат|документ|адрес|стран/i,
      );
    });

    it('отправляется, когда заполнена и документы загружены', async () => {
      await http()
        .put('/investors/me')
        .set('Cookie', investorCookie)
        .send(PROFILE)
        .expect(200);
      await upload(investorCookie, 'IDENTITY');
      await upload(investorCookie, 'SELFIE');

      const response = await http()
        .post('/investors/me/submit')
        .set('Cookie', investorCookie)
        .expect(200);
      expect(response.body.investor.status).toBe(KycStatus.PENDING);
      expect(response.body.investor.levelName).toBe('basic-kyc-level');
      expect(response.body.investor.submittedAt).toBeTruthy();
    });

    it('на проверке анкету менять нельзя', async () => {
      await http()
        .put('/investors/me')
        .set('Cookie', investorCookie)
        .send({ city: 'Abu Dhabi' })
        .expect(409);
    });
  });

  describe('решение админа', () => {
    it('показывает заявку в списке со счётчиком ожидающих', async () => {
      const response = await http()
        .get('/investors')
        .set('Cookie', adminCookie)
        .query({ status: KycStatus.PENDING })
        .expect(200);

      expect(response.body.pending).toBeGreaterThan(0);
      expect(
        (response.body.investors as Investor[]).some(
          (item) => item.id === investorId,
        ),
      ).toBe(true);
    });

    it('не даёт вернуть анкету на доработку без объяснения', async () => {
      await http()
        .post(`/investors/${investorId}/decision`)
        .set('Cookie', adminCookie)
        .send({ action: 'retry' })
        .expect(400);
    });

    it('возвращает на доработку с комментарием инвестору', async () => {
      await http()
        .post(`/investors/${investorId}/decision`)
        .set('Cookie', adminCookie)
        .send({
          action: 'retry',
          clientComment: 'Переснимите документ: не читается номер',
          moderationComment: 'снимок размыт',
        })
        .expect(200);

      const response = await http()
        .get('/investors/me')
        .set('Cookie', investorCookie)
        .expect(200);
      expect(response.body.investor.status).toBe(KycStatus.RETRY);
      expect(response.body.investor.clientComment).toContain('Переснимите');
      // Внутренняя заметка инвестору не показывается.
      expect(response.body.investor.moderationComment).toBeUndefined();
    });

    it('после доработки анкета отправляется снова и прошлое решение стирается', async () => {
      await upload(investorCookie, 'IDENTITY');
      const response = await http()
        .post('/investors/me/submit')
        .set('Cookie', investorCookie)
        .expect(200);

      expect(response.body.investor.status).toBe(KycStatus.PENDING);
      expect(response.body.investor.clientComment).toBeNull();
      expect(response.body.investor.reviewAnswer).toBeNull();
    });

    it('одобрение открывает кабинет', async () => {
      await http()
        .post(`/investors/${investorId}/decision`)
        .set('Cookie', adminCookie)
        .send({ action: 'approve', moderationComment: 'документы сверены' })
        .expect(200);

      const user = await prisma.user.findUnique({
        where: { email: INVESTOR.email },
      });
      expect(user?.status).toBe(UserStatus.ACTIVE);

      const history = await http()
        .get(`/investors/${investorId}/history`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(
        (history.body as { field: string; newValue: string }[]).some(
          (event) => event.newValue === KycStatus.APPROVED,
        ),
      ).toBe(true);
    });

    it('одобрить одобренного нельзя', async () => {
      await http()
        .post(`/investors/${investorId}/decision`)
        .set('Cookie', adminCookie)
        .send({ action: 'approve' })
        .expect(409);
    });
  });

  describe('аккаунт в контракте', () => {
    it('создаётся один раз, повторное нажатие только подтягивает состояние', async () => {
      const before = chain.created;
      const first = await http()
        .post(`/investors/${investorId}/onchain`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(chain.created).toBe(before + 1);
      expect(first.body.investor.onchainAccount).toBe(USER_PDA);
      expect(first.body.investor.whitelistStatus).toBe(true);

      const second = await http()
        .post(`/investors/${investorId}/onchain`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(chain.created).toBe(before + 1);
      expect(second.body.investor.onchainAccount).toBe(USER_PDA);
    });

    it('отдаёт инвестору адрес аккаунта и ссылку на обозреватель', async () => {
      const response = await http()
        .get('/investors/me')
        .set('Cookie', investorCookie)
        .expect(200);

      expect(response.body.investor.onchainAccount).toBe(USER_PDA);
      expect(String(response.body.accountUrl)).toContain(USER_PDA);
    });

    it('допуск снимается и возвращается', async () => {
      const off = await http()
        .post(`/investors/${investorId}/whitelist`)
        .set('Cookie', adminCookie)
        .send({ enabled: false })
        .expect(200);
      expect(off.body.whitelistStatus).toBe(false);

      const on = await http()
        .post(`/investors/${investorId}/whitelist`)
        .set('Cookie', adminCookie)
        .send({ enabled: true })
        .expect(200);
      expect(on.body.whitelistStatus).toBe(true);
    });
  });

  describe('после одобрения', () => {
    it('телефон меняется, остальная анкета заморожена', async () => {
      const updated = await http()
        .put('/investors/me')
        .set('Cookie', investorCookie)
        .send({ phone: '+971 50 000 00 00' })
        .expect(200);
      expect(updated.body.investor.phone).toBe('+971 50 000 00 00');

      await http()
        .put('/investors/me')
        .set('Cookie', investorCookie)
        .send({ lastName: 'Сидоров' })
        .expect(409);
    });

    it('проверенные поля не проходят даже вместе с телефоном', async () => {
      const response = await http()
        .put('/investors/me')
        .set('Cookie', investorCookie)
        .send({ phone: '+971 50 111 11 11', country: 'KAZ' })
        .expect(200);

      expect(response.body.investor.phone).toBe('+971 50 111 11 11');
      // Страна проживания осталась прежней: её проверяли документами.
      expect(response.body.investor.country).toBe('ARE');
    });
  });

  describe('повторная проверка', () => {
    it('без объяснения допущенного инвестора не трогают', async () => {
      await http()
        .post(`/investors/${investorId}/decision`)
        .set('Cookie', adminCookie)
        .send({ action: 'retry' })
        .expect(400);
    });

    it('возврат на доработку закрывает выводы в контракте', async () => {
      const before = chain.whitelistCalls;
      const response = await http()
        .post(`/investors/${investorId}/decision`)
        .set('Cookie', adminCookie)
        .send({
          action: 'retry',
          clientComment: 'Срок действия паспорта истёк, приложите новый',
        })
        .expect(200);

      expect(response.body.status).toBe(KycStatus.RETRY);
      expect(response.body.whitelistStatus).toBe(false);
      // Допуск снят именно в сети, а не только в базе.
      expect(chain.whitelistCalls).toBe(before + 1);

      const user = await prisma.user.findUnique({
        where: { email: INVESTOR.email },
      });
      expect(user?.status).toBe(UserStatus.PENDING);
    });

    it('инвестор видит причину и снова может править анкету', async () => {
      const profile = await http()
        .get('/investors/me')
        .set('Cookie', investorCookie)
        .expect(200);
      expect(profile.body.investor.clientComment).toContain('паспорта');

      const updated = await http()
        .put('/investors/me')
        .set('Cookie', investorCookie)
        .send({ idDocNumber: 'N87654321' })
        .expect(200);
      expect(updated.body.investor.idDocNumber).toBe('N87654321');
    });

    it('повторное одобрение не создаёт второй аккаунт и возвращает допуск', async () => {
      await http()
        .post('/investors/me/submit')
        .set('Cookie', investorCookie)
        .expect(200);

      const created = chain.created;
      await http()
        .post(`/investors/${investorId}/decision`)
        .set('Cookie', adminCookie)
        .send({ action: 'approve', moderationComment: 'новый паспорт сверен' })
        .expect(200);

      const synced = await http()
        .post(`/investors/${investorId}/onchain`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(chain.created).toBe(created);
      expect(synced.body.investor.onchainAccount).toBe(USER_PDA);

      const allowed = await http()
        .post(`/investors/${investorId}/whitelist`)
        .set('Cookie', adminCookie)
        .send({ enabled: true })
        .expect(200);
      expect(allowed.body.whitelistStatus).toBe(true);

      const user = await prisma.user.findUnique({
        where: { email: INVESTOR.email },
      });
      expect(user?.status).toBe(UserStatus.ACTIVE);
    });
  });

  describe('смена адреса вывода', () => {
    it('идёт через заявку и закрывает выводы на 48 часов', async () => {
      await http()
        .post('/investors/me/withdrawal-address')
        .set('Cookie', investorCookie)
        .send({ address: OTHER_WITHDRAWAL })
        .expect(200);

      // Админ не должен искать заявку руками: она сама появляется в задачах.
      const waiting = await http()
        .get('/tasks')
        .set('Cookie', adminCookie)
        .expect(200);
      expect(
        (waiting.body as { key: string; count: number }[]).find(
          (task) => task.key === 'withdrawalAddress',
        )?.count,
      ).toBe(1);

      const confirmed = await http()
        .post(`/investors/${investorId}/withdrawal-address`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(confirmed.body.withdrawalAddress).toBe(OTHER_WITHDRAWAL);
      expect(confirmed.body.pendingWithdrawalAddress).toBeNull();
      expect(confirmed.body.whitelistStatus).toBe(false);
      expect(
        new Date(confirmed.body.whitelistBlockedUntil).getTime(),
      ).toBeGreaterThan(Date.now());

      // Дело сделано — задача исчезает сама, отмечать ничего не надо.
      const done = await http()
        .get('/tasks')
        .set('Cookie', adminCookie)
        .expect(200);
      expect(
        (done.body as { key: string }[]).some(
          (task) => task.key === 'withdrawalAddress',
        ),
      ).toBe(false);

      // Пока идут 48 часов, контракт допуск не вернёт — не тратим на это транзакцию.
      await http()
        .post(`/investors/${investorId}/whitelist`)
        .set('Cookie', adminCookie)
        .send({ enabled: true })
        .expect(400);
    });
  });

  describe('компания', () => {
    it('без бенефициаров анкету не принимает', async () => {
      await http()
        .put('/investors/me')
        .set('Cookie', companyCookie)
        .send({
          ...PROFILE,
          type: InvestorType.COMPANY,
          position: 'Director',
          companyName: 'Dala Holdings Ltd',
          registrationNumber: 'AE-123456',
          incorporatedOn: '2019-03-10T00:00:00.000Z',
          companyCountry: 'ARE',
          legalAddress: 'DIFC, Dubai',
        })
        .expect(200);
      for (const kind of ['IDENTITY', 'SELFIE']) {
        await upload(companyCookie, kind);
      }

      const response = await http()
        .post('/investors/me/submit')
        .set('Cookie', companyCookie)
        .expect(400);
      expect(String(response.body.message)).toMatch(/владельц|бенефициар/i);
    });

    it('принимает бенефициаров и отклоняет долю больше ста процентов', async () => {
      await http()
        .post('/investors/me/beneficiaries')
        .set('Cookie', companyCookie)
        .send({ fullName: 'Ivan Petrov', country: 'KAZ', shareBps: 10_000 })
        .expect(201);

      await http()
        .post('/investors/me/beneficiaries')
        .set('Cookie', companyCookie)
        .send({ fullName: 'Too Much', country: 'KAZ', shareBps: 10_001 })
        .expect(400);
    });

    it('требует свой набор документов', async () => {
      const response = await http()
        .post('/investors/me/submit')
        .set('Cookie', companyCookie)
        .expect(400);
      expect(String(response.body.message)).toMatch(/выписк|устав|реестр/i);

      for (const kind of [
        'COMPANY_REGISTRY',
        'COMPANY_CHARTER',
        'DIRECTOR_APPOINTMENT',
        'OWNERSHIP_STRUCTURE',
      ]) {
        await upload(companyCookie, kind);
      }

      const submitted = await http()
        .post('/investors/me/submit')
        .set('Cookie', companyCookie)
        .expect(200);
      expect(submitted.body.investor.status).toBe(KycStatus.PENDING);
      expect(submitted.body.investor.levelName).toBe('kyb-level');
    });

    it('физлицу бенефициаров заводить нечего', async () => {
      await http()
        .post('/investors/me/beneficiaries')
        .set('Cookie', investorCookie)
        .send({ fullName: 'Кто-то', country: 'KAZ', shareBps: 5000 })
        .expect(409);
    });
  });

  describe('права', () => {
    it('инвестор не видит чужие анкеты', async () => {
      await http().get('/investors').set('Cookie', investorCookie).expect(403);
      await http()
        .post(`/investors/${investorId}/decision`)
        .set('Cookie', investorCookie)
        .send({ action: 'approve' })
        .expect(403);
    });

    it('у админа своей анкеты инвестора нет', async () => {
      await http().get('/investors/me').set('Cookie', adminCookie).expect(403);
    });

    it('без входа анкета недоступна', async () => {
      await http().get('/investors/me').expect(401);
    });
  });
});
