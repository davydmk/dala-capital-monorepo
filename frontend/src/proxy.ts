import { NextResponse, type NextRequest } from 'next/server';
import { HOME_BY_ROLE, type Role } from './lib/types';

const SESSION_COOKIE = 'dala_session';
const CABINETS: Record<string, Role> = {
  '/admin': 'ADMIN',
  '/borrower': 'BORROWER',
  '/investor': 'INVESTOR',
};

/**
 * Роль из токена читается без проверки подписи: она нужна только чтобы выбрать,
 * куда вести пользователя. Доступ к данным проверяет бэкенд на каждом запросе.
 */
function roleFromToken(token: string | undefined): Role | null {
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString(),
    ) as { role?: Role };
    return decoded.role ?? null;
  } catch {
    return null;
  }
}

// В Next 16 middleware называется proxy. Здесь только быстрая проверка куки:
// настоящие права проверяет бэкенд на каждом запросе.
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const role = roleFromToken(request.cookies.get(SESSION_COOKIE)?.value);

  const cabinet = Object.keys(CABINETS).find(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (cabinet) {
    if (!role) {
      const login = new URL('/login', request.url);
      // Запомним, куда человек шёл, чтобы вернуть его туда после входа.
      login.searchParams.set('next', pathname);
      return NextResponse.redirect(login);
    }
    // Чужой кабинет — переводим в свой, а не показываем ошибку.
    if (CABINETS[cabinet] !== role) {
      return NextResponse.redirect(new URL(HOME_BY_ROLE[role], request.url));
    }
  }

  // Экран приглашения открыт всем: по нему заёмщик только задаёт пароль.
  if (pathname.startsWith('/invite/')) return NextResponse.next();

  if (
    role &&
    (pathname === '/login' || pathname === '/register' || pathname === '/')
  ) {
    return NextResponse.redirect(new URL(HOME_BY_ROLE[role], request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/login',
    '/register',
    '/admin/:path*',
    '/borrower/:path*',
    '/investor/:path*',
  ],
};
