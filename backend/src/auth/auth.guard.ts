import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role, UserStatus } from '@prisma/client';
import type { Request } from 'express';
import type { SessionPayload } from './auth.service.js';

export const SESSION_COOKIE = 'dala_session';

const IS_PUBLIC = 'auth:public';
const ROLES = 'auth:roles';
const ACTIVE_ONLY = 'auth:active';

/** Маршрут доступен без входа. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Маршрут доступен только перечисленным ролям. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Маршрут требует подтверждённого пользователя: до проверки операции недоступны. */
export const ActiveOnly = () => SetMetadata(ACTIVE_ONLY, true);

declare module 'express' {
  interface Request {
    user?: SessionPayload;
  }
}

/**
 * Глобальная охрана: читает токен из httpOnly-куки и проверяет роль.
 * Куку браузер не отдаёт скриптам, поэтому украсть сессию через XSS сложнее, чем из localStorage.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets))
      return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = (request.cookies as Record<string, string> | undefined)?.[
      SESSION_COOKIE
    ];
    if (!token) throw new UnauthorizedException('Требуется вход');

    let payload: SessionPayload;
    try {
      payload = await this.jwt.verifyAsync<SessionPayload>(token);
    } catch {
      throw new UnauthorizedException('Сессия истекла, войдите заново');
    }
    request.user = payload;

    // Режим просмотра: читать можно всё, менять — ничего. Запрет стоит
    // здесь, а не на экранах: так он действует и на те маршруты, которые
    // появятся потом, и его нельзя забыть в одной кнопке из сотни.
    if (payload.viewer && request.method !== 'GET') {
      throw new ForbiddenException(
        'Режим просмотра: изменения недоступны. Войдите со своими доступами, чтобы действовать',
      );
    }

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);
    if (roles?.length && !roles.includes(payload.role)) {
      throw new ForbiddenException('Недостаточно прав');
    }
    if (
      this.reflector.getAllAndOverride<boolean>(ACTIVE_ONLY, targets) &&
      payload.status !== UserStatus.ACTIVE
    ) {
      throw new ForbiddenException('Профиль ещё не подтверждён');
    }
    return true;
  }
}
