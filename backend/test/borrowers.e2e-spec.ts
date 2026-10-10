/**
 * Сквозные тесты справочника заёмщиков: права, проверки, документы, журнал.
 * Работают через HTTP с реальной базой из docker compose.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BorrowerStatus, CreditRating, Role, UserStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { hash } from '@node-rs/argon2';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/borrowers/storage.js';

const ADMIN = {
  email: 'e2e-b-admin@example.com',
  password: 'пароль-админа-длинный',
};
const INVESTOR = {
  email: 'e2e-b-investor@example.com',
  password: 'пароль-инвестора-длин',
};
const BORROWER_LOGIN = {
  email: 'e2e-b-company@example.com',
  password: 'пароль-компании-длин',
};

/** Публично известный БИН Kaspi Bank: контрольная цифра верная. */
const BIN = '971240001315';
const OTHER_BIN = '940140000385';
const THIRD_BIN = '020240000555';
const FOURTH_BIN = '220140000008';
const WALLET = 'JCLPbcLwdYJs1UJgL6LK1nhYRUcGk5ziFPx55nVL9akB';
const SECOND_WALLET = '5vDZ4BWLTZFfumMgSsTQmekF7mnLhJ8VZv7YqnZVyhk2';
/** Адрес devnet USDC: это минт, то есть аккаунт токен-программы. */
const TOKEN_ACCOUNT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('Заёмщики (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storage: StorageService;
  let adminCookie: string;
  let investorCookie: string;
  let borrowerId: string;
  let walletIds: string[] = [];
  let photoId: string;

  const http = () => request(app.getHttpServer());

  async function cleanup() {
    await prisma.borrower.deleteMany({
      where: { bin: { in: [BIN, OTHER_BIN, THIRD_BIN, FOURTH_BIN] } },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [
            ADMIN.email,
            INVESTOR.email,
            BORROWER_LOGIN.email,
            'expired@example.com',
            'revoke@example.com',
          ],
        },
      },
    });
  }

  async function login(email: string, password: string) {
    const response = await http()
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return (response.headers['set-cookie'] as unknown as string[])[0];
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
    storage = app.get(StorageService);
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
    adminCookie = await login(ADMIN.email, ADMIN.password);
    investorCookie = await login(INVESTOR.email, INVESTOR.password);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('инвестор и неавторизованный к справочнику не допускаются', async () => {
    await http().get('/borrowers').expect(401);
    await http().get('/borrowers').set('Cookie', investorCookie).expect(403);
    await http()
      .post('/borrowers')
      .set('Cookie', investorCookie)
      .send({ name: 'ТОО «Чужое»', bin: BIN })
      .expect(403);
  });

  it('создание карточки: БИН с опечаткой и слишком короткое название отклоняются', async () => {
    await http()
      .post('/borrowers')
      .set('Cookie', adminCookie)
      .send({ name: 'ТОО «Опечатка»', bin: '971240001316' })
      .expect(400);
    await http()
      .post('/borrowers')
      .set('Cookie', adminCookie)
      .send({ name: 'Т', bin: BIN })
      .expect(400);
  });

  it('карточка создаётся в статусе «черновик»', async () => {
    const response = await http()
      .post('/borrowers')
      .set('Cookie', adminCookie)
      .send({
        name: 'ТОО «Астана Трейд»',
        bin: BIN,
        industry: 'Оптовая торговля',
        annualRevenueUsd: 2_400_000,
        contactEmail: 'ceo@astana-trade.kz',
      })
      .expect(201);

    expect(response.body.borrower.status).toBe(BorrowerStatus.DRAFT);
    // Выручка хранится как BigInt, наружу отдаётся числом.
    expect(response.body.borrower.annualRevenueUsd).toBe(2_400_000);
    borrowerId = response.body.borrower.id;
  });

  it('повторный БИН отклоняется с понятным текстом', async () => {
    const response = await http()
      .post('/borrowers')
      .set('Cookie', adminCookie)
      .send({ name: 'ТОО «Двойник»', bin: BIN })
      .expect(409);
    expect(response.body.message).toContain('БИН');
  });

  it('допуск к кампаниям без кошельков не даётся', async () => {
    const response = await http()
      .patch(`/borrowers/${borrowerId}`)
      .set('Cookie', adminCookie)
      .send({ status: BorrowerStatus.APPROVED })
      .expect(400);
    expect(response.body.message).toContain('кошелёк');
  });

  it('токен-счёт и кривой адрес кошельком указать нельзя', async () => {
    await http()
      .post(`/borrowers/${borrowerId}/wallets`)
      .set('Cookie', adminCookie)
      .send({ label: 'Кривой', address: 'не-адрес' })
      .expect(400);

    const response = await http()
      .post(`/borrowers/${borrowerId}/wallets`)
      .set('Cookie', adminCookie)
      .send({ label: 'Минт', address: TOKEN_ACCOUNT })
      .expect(400);
    expect(response.body.message).toContain('токен-счёт');
  });

  it('кошельков может быть несколько, основной ровно один', async () => {
    const first = await http()
      .post(`/borrowers/${borrowerId}/wallets`)
      .set('Cookie', adminCookie)
      .send({ label: 'Основной', address: WALLET })
      .expect(201);
    // Первый адрес сам становится основным: иначе мастеру кампании нечего подставить.
    expect(first.body.wallet.isDefault).toBe(true);

    await http()
      .post(`/borrowers/${borrowerId}/wallets`)
      .set('Cookie', adminCookie)
      .send({ label: 'Дубль', address: WALLET })
      .expect(409);

    const second = await http()
      .post(`/borrowers/${borrowerId}/wallets`)
      .set('Cookie', adminCookie)
      .send({ label: 'Binance', address: SECOND_WALLET })
      .expect(201);
    expect(second.body.wallet.isDefault).toBe(false);

    await http()
      .patch(`/borrowers/${borrowerId}/wallets/${second.body.wallet.id}`)
      .set('Cookie', adminCookie)
      .send({ isDefault: true })
      .expect(200);

    const card = await http()
      .get(`/borrowers/${borrowerId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    const defaults = card.body.wallets.filter(
      (w: { isDefault: boolean }) => w.isDefault,
    );
    expect(defaults).toHaveLength(1);
    expect(defaults[0].address).toBe(SECOND_WALLET);
    walletIds = card.body.wallets.map((w: { id: string }) => w.id);

    // В журнале видно, с какого адреса на какой переключились.
    const history = await http()
      .get(`/borrowers/${borrowerId}/history`)
      .set('Cookie', adminCookie)
      .expect(200);
    const swap = history.body.find(
      (event: { field: string }) => event.field === 'defaultWallet',
    );
    expect(swap.oldValue).toBe(WALLET);
    expect(swap.newValue).toBe(SECOND_WALLET);
  });

  it('с кошельком и рейтингом карточка допускается, изменения попадают в журнал', async () => {
    await http()
      .patch(`/borrowers/${borrowerId}`)
      .set('Cookie', adminCookie)
      .send({ rating: CreditRating.B, address: 'Астана, Кунаева 12' })
      .expect(200);
    const approved = await http()
      .patch(`/borrowers/${borrowerId}`)
      .set('Cookie', adminCookie)
      .send({ status: BorrowerStatus.APPROVED })
      .expect(200);
    expect(approved.body.borrower.status).toBe(BorrowerStatus.APPROVED);

    const history = await http()
      .get(`/borrowers/${borrowerId}/history`)
      .set('Cookie', adminCookie)
      .expect(200);
    const fields = history.body.map((event: { field: string }) => event.field);
    expect(fields).toContain('wallet');
    expect(fields).toContain('rating');
    expect(fields).toContain('status');
    // Адрес — обычный реквизит, в журнал не пишется.
    expect(fields).not.toContain('address');
  });

  it('поиск находит по названию и по БИН, архивные скрыты по умолчанию', async () => {
    const byName = await http()
      .get('/borrowers?query=астана')
      .set('Cookie', adminCookie)
      .expect(200);
    // В базе могут лежать и другие карточки: важно, что наша нашлась.
    expect(byName.body.map((b: { id: string }) => b.id)).toContain(borrowerId);

    const byBin = await http()
      .get(`/borrowers?query=${BIN}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(byBin.body[0].id).toBe(borrowerId);

    await prisma.borrower.create({
      data: {
        name: 'ТОО «Архив»',
        bin: OTHER_BIN,
        status: BorrowerStatus.ARCHIVED,
      },
    });
    const visible = await http()
      .get('/borrowers')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(visible.body.map((b: { bin: string }) => b.bin)).not.toContain(
      OTHER_BIN,
    );

    const withArchived = await http()
      .get('/borrowers?includeArchived=true')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(withArchived.body.map((b: { bin: string }) => b.bin)).toContain(
      OTHER_BIN,
    );
  });

  it('документ загружается и скачивается, чужой тип и большой файл отклоняются', async () => {
    const pdf = Buffer.from('%PDF-1.4 тестовый документ');
    const upload = await http()
      .post(`/borrowers/${borrowerId}/documents`)
      .set('Cookie', adminCookie)
      .field('kind', 'CHARTER')
      .attach('file', pdf, {
        filename: 'устав.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    expect(upload.body.fileName).toBe('устав.pdf');

    const download = await http()
      .get(`/borrowers/${borrowerId}/documents/${upload.body.id}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(Buffer.from(download.body).toString()).toBe(pdf.toString());
    // Имя файла в заголовке закодировано, иначе кириллица ломает заголовок.
    expect(download.headers['content-disposition']).toContain('UTF-8');

    await http()
      .post(`/borrowers/${borrowerId}/documents`)
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('исполняемый'), {
        filename: 'virus.exe',
        contentType: 'application/x-msdownload',
      })
      .expect(400);

    await http()
      .post(`/borrowers/${borrowerId}/documents`)
      .set('Cookie', adminCookie)
      .attach('file', Buffer.alloc(11 * 1024 * 1024), {
        filename: 'огромный.pdf',
        contentType: 'application/pdf',
      })
      .expect((response) => {
        // Либо наша проверка, либо отсечка multer — главное, что файл не принят.
        expect([400, 413]).toContain(response.status);
      });

    await http()
      .delete(`/borrowers/${borrowerId}/documents/${upload.body.id}`)
      .set('Cookie', adminCookie)
      .expect(204);
    const after = await http()
      .get(`/borrowers/${borrowerId}`)
      .set('Cookie', adminCookie);
    expect(after.body.documents).toHaveLength(0);
  });

  it('файл на диске не выходит за каталог загрузок', async () => {
    const upload = await http()
      .post(`/borrowers/${borrowerId}/documents`)
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('%PDF-1.4'), {
        filename: '../../побег.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    expect(upload.body.storageKey.startsWith(`borrowers/${borrowerId}/`)).toBe(
      true,
    );
    expect(storage.absolutePath(upload.body.storageKey)).toContain(borrowerId);
  });

  it('фотографии предприятия: загрузка, подпись, порядок, предел в восемь штук', async () => {
    const photo = (name: string) =>
      http()
        .post(`/borrowers/${borrowerId}/photos`)
        .set('Cookie', adminCookie)
        .field('caption', name)
        .attach('file', Buffer.from(`изображение ${name}`), {
          filename: `${name}.jpg`,
          contentType: 'image/jpeg',
        });

    const first = await photo('цех').expect(201);
    expect(first.body.caption).toBe('цех');
    expect(first.body.sortOrder).toBe(0);
    photoId = first.body.id;

    for (let i = 1; i < 8; i++) await photo(`снимок-${i}`).expect(201);
    // Девятая уже лишняя: карусель превращается в свалку.
    const extra = await photo('лишняя').expect(400);
    expect(extra.body.message).toContain('8');

    await http()
      .patch(`/borrowers/${borrowerId}/photos/${photoId}`)
      .set('Cookie', adminCookie)
      .send({ caption: 'цех по розливу', sortOrder: 3 })
      .expect(200);

    // PDF картинкой не считается.
    await http()
      .post(`/borrowers/${borrowerId}/photos`)
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('%PDF-1.4'), {
        filename: 'документ.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
  });

  it('логотип и фотографии видны вошедшему инвестору, но не анониму', async () => {
    await http()
      .post(`/borrowers/${borrowerId}/logo`)
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('логотип'), {
        filename: 'logo.png',
        contentType: 'image/png',
      })
      .expect(201);

    await http().get(`/borrowers/${borrowerId}/logo`).expect(401);
    const logo = await http()
      .get(`/borrowers/${borrowerId}/logo`)
      .set('Cookie', investorCookie)
      .expect(200);
    expect(logo.headers['content-type']).toContain('image/png');

    await http()
      .get(`/borrowers/${borrowerId}/photos/${photoId}`)
      .set('Cookie', investorCookie)
      .expect(200);
    // Внутренние данные инвестору по-прежнему закрыты.
    await http()
      .get(`/borrowers/${borrowerId}`)
      .set('Cookie', investorCookie)
      .expect(403);
  });

  it('приглашение: заёмщик сам задаёт пароль и сразу попадает в кабинет', async () => {
    const invite = await http()
      .post(`/borrowers/${borrowerId}/invite`)
      .set('Cookie', adminCookie)
      .send({ email: BORROWER_LOGIN.email })
      .expect(201);
    expect(invite.body.path).toContain('/invite/');
    const token = invite.body.token;

    // По ссылке видно, в какую компанию приглашают.
    const preview = await http().get(`/invite/${token}`).expect(200);
    expect(preview.body.company).toBe('ТОО «Астана Трейд»');
    expect(preview.body.email).toBe(BORROWER_LOGIN.email);

    // Короткий пароль не принимается.
    await http()
      .post(`/invite/${token}`)
      .send({ password: 'короткий' })
      .expect(400);

    const accepted = await http()
      .post(`/invite/${token}`)
      .send({ password: BORROWER_LOGIN.password })
      .expect(200);
    expect(accepted.body.role).toBe(Role.BORROWER);
    expect(accepted.body.status).toBe(UserStatus.ACTIVE);

    // Кука сессии выдаётся сразу: повторно вводить пароль незачем.
    const cookie = (accepted.headers['set-cookie'] as unknown as string[])[0];
    const me = await http().get('/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.email).toBe(BORROWER_LOGIN.email);
    // В чужой справочник заёмщику хода нет.
    await http().get('/borrowers').set('Cookie', cookie).expect(403);

    // Ссылка одноразовая.
    await http().get(`/invite/${token}`).expect(404);
    await http()
      .post(`/invite/${token}`)
      .send({ password: 'другой-пароль-длинный' })
      .expect(404);

    // Пароль, заданный заёмщиком, работает при обычном входе.
    const again = await login(BORROWER_LOGIN.email, BORROWER_LOGIN.password);
    expect(again).toContain('dala_session');

    // Кабинет уже есть — повторное приглашение не выдаётся.
    await http()
      .post(`/borrowers/${borrowerId}/invite`)
      .set('Cookie', adminCookie)
      .send({ email: 'another@example.com' })
      .expect(409);
  });

  it('действующее приглашение видно в карточке и отзывается', async () => {
    const other = await prisma.borrower.create({
      data: { name: 'ТОО «Отзыв»', bin: FOURTH_BIN },
    });
    const invite = await http()
      .post(`/borrowers/${other.id}/invite`)
      .set('Cookie', adminCookie)
      .send({ email: 'revoke@example.com' })
      .expect(201);

    // Саму ссылку не восстановить, но видно, что доступ выдан и до какого числа.
    const card = await http()
      .get(`/borrowers/${other.id}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(card.body.invites).toHaveLength(1);
    expect(card.body.invites[0].email).toBe('revoke@example.com');
    expect(card.body.invites[0].tokenHash).toBeUndefined();

    await http()
      .delete(`/borrowers/${other.id}/invite`)
      .set('Cookie', adminCookie)
      .expect(204);

    // После отзыва ссылка не работает, и карточка это показывает.
    await http().get(`/invite/${invite.body.token}`).expect(404);
    const after = await http()
      .get(`/borrowers/${other.id}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(after.body.invites).toHaveLength(0);
    await http()
      .delete(`/borrowers/${other.id}/invite`)
      .set('Cookie', adminCookie)
      .expect(404);
  });

  it('истёкшая ссылка отклоняется', async () => {
    const other = await prisma.borrower.create({
      data: { name: 'ТОО «Просрочка»', bin: THIRD_BIN },
    });
    const invite = await http()
      .post(`/borrowers/${other.id}/invite`)
      .set('Cookie', adminCookie)
      .send({ email: 'expired@example.com' })
      .expect(201);

    await prisma.borrowerInvite.updateMany({
      where: { borrowerId: other.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await http()
      .get(`/invite/${invite.body.token}`)
      .expect(400);
    expect(response.body.message).toContain('истёк');
  });

  it('последний кошелёк допущенного заёмщика удалить нельзя', async () => {
    // Удаляем все, кроме одного: на этом шаге отказ.
    for (const walletId of walletIds.slice(0, -1)) {
      await http()
        .delete(`/borrowers/${borrowerId}/wallets/${walletId}`)
        .set('Cookie', adminCookie)
        .expect(204);
    }
    const last = walletIds[walletIds.length - 1];
    const response = await http()
      .delete(`/borrowers/${borrowerId}/wallets/${last}`)
      .set('Cookie', adminCookie)
      .expect(400);
    expect(response.body.message).toContain('последний');

    // Оставшийся автоматически стал основным.
    const card = await http()
      .get(`/borrowers/${borrowerId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(card.body.wallets).toHaveLength(1);
    expect(card.body.wallets[0].isDefault).toBe(true);
  });
});
