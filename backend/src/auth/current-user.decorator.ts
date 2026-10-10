import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionPayload } from './auth.service.js';

/** Данные сессии из токена. Маршрут без `@Public()` всегда их получает. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionPayload =>
    context.switchToHttp().getRequest<Request>().user!,
);
