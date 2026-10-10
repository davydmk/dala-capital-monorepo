import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { hash, verify } from '@node-rs/argon2';
import { Role, UserStatus, type User } from '@prisma/client';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PASSWORD = 'правильный-пароль';

async function makeUser(overrides: Partial<User> = {}): Promise<User> {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'investor@example.com',
    passwordHash: await hash(PASSWORD),
    role: Role.INVESTOR,
    status: UserStatus.ACTIVE,
    name: 'Инвестор',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
    previousLoginAt: null,
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: new JwtService({ secret: 'test-secret' }),
        },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('вход возвращает токен с ролью и отмечает время входа', async () => {
    const user = await makeUser();
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.user.update.mockResolvedValue(user);

    const { token, user: publicUser } = await service.login(
      'Investor@Example.com ',
      PASSWORD,
    );

    // Почта приводится к нижнему регистру и без пробелов.
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'investor@example.com' },
    });
    expect(publicUser).toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
      role: Role.INVESTOR,
      status: UserStatus.ACTIVE,
      createdAt: user.createdAt,
      previousLoginAt: null,
    });
    expect(publicUser).not.toHaveProperty('passwordHash');
    const payload = new JwtService({ secret: 'test-secret' }).verify(token);
    expect(payload.sub).toBe(user.id);
    expect(payload.role).toBe(Role.INVESTOR);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: user.id } }),
    );
  });

  it('вход запоминает предыдущий вход, а не только текущий', async () => {
    const before = new Date('2026-09-01T10:00:00.000Z');
    const user = await makeUser({ lastLoginAt: before });
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.user.update.mockResolvedValue(user);

    await service.login('investor@example.com', PASSWORD);

    const { data } = prisma.user.update.mock.calls[0][0];
    expect(data.previousLoginAt).toBe(before);
    expect(data.lastLoginAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it('неверный пароль и несуществующая почта дают одинаковую ошибку', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(await makeUser());
    const wrongPassword = await service
      .login('investor@example.com', 'другой-пароль')
      .catch((e) => e);

    prisma.user.findUnique.mockResolvedValueOnce(null);
    const noUser = await service
      .login('никого@example.com', PASSWORD)
      .catch((e) => e);

    expect(wrongPassword).toBeInstanceOf(UnauthorizedException);
    expect(noUser).toBeInstanceOf(UnauthorizedException);
    expect(noUser.message).toBe(wrongPassword.message);
  });

  it('заблокированный пользователь не входит', async () => {
    prisma.user.findUnique.mockResolvedValue(
      await makeUser({ status: UserStatus.BLOCKED }),
    );
    await expect(
      service.login('investor@example.com', PASSWORD),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('регистрация создаёт инвестора на проверке и хеширует пароль', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }: { data: User }) => ({
      ...(await makeUser()),
      ...data,
    }));

    const created = await service.register({
      email: ' New@Example.com',
      password: PASSWORD,
      name: '  Новый инвестор ',
    });

    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.email).toBe('new@example.com');
    expect(data.name).toBe('Новый инвестор');
    expect(data.passwordHash).not.toBe(PASSWORD);
    expect(data.role).toBe(Role.INVESTOR);
    expect(created.status).toBe(UserStatus.PENDING);
  });

  it('повторная регистрация на ту же почту отклоняется', async () => {
    prisma.user.findUnique.mockResolvedValue(await makeUser());
    await expect(
      service.register({
        email: 'investor@example.com',
        password: PASSWORD,
        name: 'Дубль',
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('роль и статус для «кто я» читаются из базы, а не из токена', async () => {
    prisma.user.findUnique.mockResolvedValue(
      await makeUser({ status: UserStatus.PENDING }),
    );
    await expect(
      service.currentUser('11111111-1111-1111-1111-111111111111'),
    ).resolves.toMatchObject({ status: UserStatus.PENDING });

    prisma.user.findUnique.mockResolvedValue(
      await makeUser({ status: UserStatus.BLOCKED }),
    );
    await expect(
      service.currentUser('11111111-1111-1111-1111-111111111111'),
    ).rejects.toThrow(UnauthorizedException);
  });

  describe('смена пароля', () => {
    const NEW = 'совсем-другой-пароль';

    it('меняет хеш при верном текущем пароле', async () => {
      const user = await makeUser();
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue(user);

      await service.changePassword(user.id, PASSWORD, NEW);

      const { data } = prisma.user.update.mock.calls[0][0];
      expect(data.passwordHash).not.toBe(user.passwordHash);
      expect(await verify(data.passwordHash, NEW)).toBe(true);
    });

    it('не меняет пароль при неверном текущем', async () => {
      const user = await makeUser();
      prisma.user.findUnique.mockResolvedValue(user);

      await expect(
        service.changePassword(user.id, 'не тот пароль', NEW),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('испорченный хеш не даёт сбоя сервера', async () => {
      prisma.user.findUnique.mockResolvedValue(
        await makeUser({ passwordHash: 'не-хеш' }),
      );

      await expect(service.changePassword('id', PASSWORD, NEW)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('не принимает новый пароль, совпадающий со старым', async () => {
      prisma.user.findUnique.mockResolvedValue(await makeUser());

      await expect(
        service.changePassword('id', PASSWORD, PASSWORD),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  it('переименование обрезает пробелы и не трогает почту', async () => {
    const user = await makeUser();
    prisma.user.update.mockImplementation(
      async ({ data }: { data: { name: string } }) => ({ ...user, ...data }),
    );

    const renamed = await service.rename(user.id, '  Иван Петров  ');

    expect(renamed.name).toBe('Иван Петров');
    expect(renamed.email).toBe(user.email);
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      name: 'Иван Петров',
    });
  });
});
