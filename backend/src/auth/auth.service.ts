import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { Role, UserStatus, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/** Содержимое токена сессии. */
export interface SessionPayload {
  sub: string;
  email: string;
  role: Role;
  status: UserStatus;
}

/** Пользователь в ответах API: без хеша пароля. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  createdAt: Date;
  /// Вход, предшествующий текущему; у новичка пустой.
  previousLoginAt: Date | null;
}

export const toPublicUser = (user: User): PublicUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
  previousLoginAt: user.previousLoginAt,
});

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Приводит адрес к единому виду: почта регистронезависима. */
  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async register(input: {
    email: string;
    password: string;
    name: string;
  }): Promise<PublicUser> {
    const email = this.normalizeEmail(input.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    // Регистрация открыта только инвесторам: заёмщиков и админов заводит админ.
    if (existing)
      throw new UnauthorizedException('Пользователь с такой почтой уже есть');

    const user = await this.prisma.user.create({
      data: {
        email,
        name: input.name.trim(),
        passwordHash: await hash(input.password),
        role: Role.INVESTOR,
        status: UserStatus.PENDING,
      },
    });
    return toPublicUser(user);
  }

  /**
   * Проверяет пару почта–пароль. Ответ одинаковый и когда пользователя нет,
   * и когда пароль неверный: иначе по ответу можно собирать список почт.
   */
  async validate(email: string, password: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { email: this.normalizeEmail(email) },
    });
    const invalid = new UnauthorizedException('Неверная почта или пароль');
    if (!user) {
      // Считаем хеш вхолостую, чтобы время ответа не выдавало существование пользователя.
      await hash(password);
      throw invalid;
    }
    // verify бросает исключение на испорченном хеше — это тоже неверный пароль, а не сбой.
    const matches = await verify(user.passwordHash, password).catch(
      () => false,
    );
    if (!matches) throw invalid;
    if (user.status === UserStatus.BLOCKED) {
      throw new UnauthorizedException('Доступ закрыт, обратитесь в поддержку');
    }
    return user;
  }

  /** Токен сессии для пользователя: нужен и при входе, и при приёме приглашения. */
  async issueToken(user: User): Promise<string> {
    const payload: SessionPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    };
    return this.jwt.signAsync(payload);
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ token: string; user: PublicUser }> {
    const user = await this.validate(email, password);
    // Прежний вход сохраняем: иначе «последний вход» всегда равен текущему
    // сеансу и ничего пользователю не говорит.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { previousLoginAt: user.lastLoginAt, lastLoginAt: new Date() },
    });

    return { token: await this.issueToken(user), user: toPublicUser(user) };
  }

  /** Смена пароля из кабинета. Почтового сервиса нет, поэтому это единственный способ. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Сессия недействительна');

    // verify бросает исключение на испорченном хеше — это неверный пароль, а не сбой.
    const matches = await verify(user.passwordHash, currentPassword).catch(
      () => false,
    );
    if (!matches) throw new UnauthorizedException('Текущий пароль неверный');
    if (currentPassword === newPassword) {
      throw new BadRequestException('Новый пароль совпадает с текущим');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hash(newPassword) },
    });
  }

  /** Отображаемое имя. Почту менять нельзя: она же логин, а подтвердить смену нечем. */
  async rename(userId: string, name: string): Promise<PublicUser> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { name: name.trim() },
    });
    return toPublicUser(user);
  }

  /** Текущий пользователь по токену: роль и статус читаются из базы, а не из токена. */
  async currentUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status === UserStatus.BLOCKED) {
      throw new UnauthorizedException('Сессия недействительна');
    }
    return toPublicUser(user);
  }
}
