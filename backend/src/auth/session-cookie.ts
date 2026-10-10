import type { User } from '@prisma/client';
import type { CookieOptions, Response } from 'express';
import { AuthService } from './auth.service.js';
import { SESSION_COOKIE } from './auth.guard.js';

/** Срок жизни куки совпадает со сроком токена. */
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // По HTTP кука в проде не уйдёт.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  };
}

/** Ставит куку сессии: используется и при входе, и при приёме приглашения. */
export async function setSessionCookie(
  response: Response,
  user: User,
  auth: AuthService,
): Promise<void> {
  response.cookie(
    SESSION_COOKIE,
    await auth.issueToken(user),
    sessionCookieOptions(),
  );
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE, {
    ...sessionCookieOptions(),
    maxAge: undefined,
  });
}
