/**
 * Сквозной тест входа: реальные HTTP, Nest и база из docker compose.
 * Тестовые пользователи удаляются до и после прогона.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SESSION_COOKIE } from '../src/auth/auth.guard.js';
import { VIEWER_EMAIL } from '../src/auth/auth.service.js';

const INVESTOR = {
  email: 'e2e-investor@example.com',
  password: 'пароль-инвестора',
  name: 'Инвестор',
};
const ADMIN = {
  email: 'e2e-admin@example.com',
  password: 'пароль-админа',
  name: 'Админ',
};

describe('Аутентификация (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const cleanup = () =>
    prisma.user.deleteMany({
      where: {
        email: { in: [INVESTOR.email, ADMIN.email, VIEWER_EMAIL.investor] },
      },
    });

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
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('проверка живости открыта без входа', async () => {
    const response = await http().get('/health').expect(200);
    expect(response.body.status).toBe('ok');
  });

  it('регистрация создаёт инвестора со статусом «на проверке»', async () => {
    const response = await http()
      .post('/auth/register')
      .send(INVESTOR)
      .expect(201);
    expect(response.body).toMatchObject({
      email: INVESTOR.email,
      role: Role.INVESTOR,
      status: UserStatus.PENDING,
    });
    expect(response.body.passwordHash).toBeUndefined();
  });

  it('короткий пароль и кривая почта отклоняются', async () => {
    await http()
      .post('/auth/register')
      .send({ email: 'не-почта', password: 'короткий', name: 'Кто-то' })
      .expect(400);
    await http()
      .post('/auth/register')
      .send({ ...INVESTOR, email: 'other@example.com', password: '123' })
      .expect(400);
  });

  it('лишние поля в запросе отклоняются', async () => {
    await http()
      .post('/auth/register')
      .send({ ...INVESTOR, email: 'extra@example.com', role: Role.ADMIN })
      .expect(400);
  });

  it('вход с неверным паролем не выдаёт куку', async () => {
    const response = await http()
      .post('/auth/login')
      .send({ email: INVESTOR.email, password: 'неверный' })
      .expect(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('вход выдаёт httpOnly-куку, «кто я» её принимает, выход её гасит', async () => {
    const login = await http()
      .post('/auth/login')
      .send({ email: INVESTOR.email, password: INVESTOR.password })
      .expect(200);

    const cookie = (login.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toContain(SESSION_COOKIE);
    expect(cookie).toContain('HttpOnly');

    await http().get('/auth/me').expect(401);
    const me = await http().get('/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.email).toBe(INVESTOR.email);

    const logout = await http()
      .post('/auth/logout')
      .set('Cookie', cookie)
      .expect(204);
    const cleared = (logout.headers['set-cookie'] as unknown as string[])[0];
    expect(cleared).toContain(`${SESSION_COOKIE}=;`);
  });

  it('чужой или испорченный токен не проходит', async () => {
    await http()
      .get('/auth/me')
      .set('Cookie', `${SESSION_COOKIE}=tampered.token.value`)
      .expect(401);
  });

  it('заблокированному вход закрыт, а выданная ранее сессия перестаёт работать', async () => {
    const login = await http()
      .post('/auth/login')
      .send({ email: INVESTOR.email, password: INVESTOR.password })
      .expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0];

    await prisma.user.update({
      where: { email: INVESTOR.email },
      data: { status: UserStatus.BLOCKED },
    });

    await http().get('/auth/me').set('Cookie', cookie).expect(401);
    await http()
      .post('/auth/login')
      .send({ email: INVESTOR.email, password: INVESTOR.password })
      .expect(401);

    await prisma.user.update({
      where: { email: INVESTOR.email },
      data: { status: UserStatus.ACTIVE },
    });
  });

  it('роль в токене берётся из базы: инвестор не может стать админом', async () => {
    await prisma.user.create({
      data: {
        email: ADMIN.email,
        name: ADMIN.name,
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
        // Хеш создаётся сервисом при регистрации; здесь достаточно заведомо неподходящего.
        passwordHash: 'не-хеш',
      },
    });
    const response = await http()
      .post('/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password })
      .expect(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });


  /**
   * Режим просмотра: судья заходит в настоящий кабинет без пароля, но
   * сервер не должен принять ни одного изменения — ни сейчас, ни по маршрутам,
   * которые появятся потом.
   */
  describe('режим просмотра', () => {
    let viewerCookie: string;

    beforeAll(async () => {
      await prisma.user.upsert({
        where: { email: VIEWER_EMAIL.investor },
        update: {},
        create: {
          email: VIEWER_EMAIL.investor,
          passwordHash: await hash('пароль-держателя'),
          name: 'Держатель бумаг',
          role: Role.INVESTOR,
        },
      });
      const response = await http().post('/auth/view/investor').expect(200);
      viewerCookie = (
        response.headers['set-cookie'] as unknown as string[]
      )[0];
    });

    it('вход без пароля даёт сессию с пометкой просмотра', async () => {
      const me = await http()
        .get('/auth/me')
        .set('Cookie', viewerCookie)
        .expect(200);
      expect((me.body as { viewer?: boolean }).viewer).toBe(true);
      expect((me.body as { email: string }).email).toBe(VIEWER_EMAIL.investor);
    });

    it('чтение работает, изменения отклоняются', async () => {
      await http().get('/tasks').set('Cookie', viewerCookie).expect(200);

      const denied = await http()
        .patch('/auth/me')
        .set('Cookie', viewerCookie)
        .send({ name: 'Новое имя' })
        .expect(403);
      expect((denied.body as { message: string }).message).toContain(
        'Режим просмотра',
      );

      await http()
        .post('/auth/password')
        .set('Cookie', viewerCookie)
        .send({ currentPassword: 'a', newPassword: 'длинный-пароль' })
        .expect(403);
    });

    it('чужая роль в режим просмотра не пускает', async () => {
      await http().post('/auth/view/treasury').expect(400);
    });

    it('выйти из режима просмотра можно', async () => {
      await http().post('/auth/logout').set('Cookie', viewerCookie).expect(204);
    });
  });

  describe('свой профиль', () => {
    const NEW_PASSWORD = 'новый-пароль-инвестора';
    let cookie: string;

    const login = async (password: string) => {
      const response = await http()
        .post('/auth/login')
        .send({ email: INVESTOR.email, password })
        .expect(200);
      return (response.headers['set-cookie'] as unknown as string[])[0];
    };

    beforeAll(async () => {
      cookie = await login(INVESTOR.password);
    });

    it('без входа профиль недоступен', async () => {
      await http().patch('/auth/me').send({ name: 'Кто-то' }).expect(401);
      await http()
        .post('/auth/password')
        .send({ currentPassword: 'a', newPassword: 'длинный-пароль' })
        .expect(401);
    });

    it('меняет имя и не даёт сменить почту', async () => {
      const renamed = await http()
        .patch('/auth/me')
        .set('Cookie', cookie)
        .send({ name: 'Иван Петров' })
        .expect(200);
      expect(renamed.body.name).toBe('Иван Петров');
      expect(renamed.body.email).toBe(INVESTOR.email);

      // Лишнее поле отсекает ValidationPipe: почта — это логин.
      await http()
        .patch('/auth/me')
        .set('Cookie', cookie)
        .send({ name: 'Иван', email: 'другая@example.com' })
        .expect(400);
    });

    it('не меняет пароль при неверном текущем', async () => {
      await http()
        .post('/auth/password')
        .set('Cookie', cookie)
        .send({ currentPassword: 'не тот', newPassword: NEW_PASSWORD })
        .expect(401);
    });

    it('не принимает короткий новый пароль', async () => {
      await http()
        .post('/auth/password')
        .set('Cookie', cookie)
        .send({ currentPassword: INVESTOR.password, newPassword: 'короткий' })
        .expect(400);
    });

    it('после смены пароля работает только новый', async () => {
      await http()
        .post('/auth/password')
        .set('Cookie', cookie)
        .send({
          currentPassword: INVESTOR.password,
          newPassword: NEW_PASSWORD,
        })
        .expect(204);

      await http()
        .post('/auth/login')
        .send({ email: INVESTOR.email, password: INVESTOR.password })
        .expect(401);
      await login(NEW_PASSWORD);
    });

    it('показывает предыдущий вход, а не текущий', async () => {
      const me = await http()
        .get('/auth/me')
        .set('Cookie', await login(NEW_PASSWORD))
        .expect(200);
      expect(me.body.previousLoginAt).toBeTruthy();
      expect(new Date(me.body.previousLoginAt).getTime()).toBeLessThan(
        Date.now(),
      );
      expect(me.body.createdAt).toBeTruthy();
    });
  });
});
