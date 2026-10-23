'use client';

/**
 * Обёртка страниц кабинета: тянет сессию и рисует каркас.
 * Доступ уже проверен в `proxy.ts`, здесь — только данные и состояние загрузки.
 */
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppShell } from './app-shell';
import { useLogout, useSession } from './session';
import { Notice } from './ui';

export function Cabinet({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  const { data: user, isPending, isError } = useSession();
  const logout = useLogout();
  const router = useRouter();

  // Кука есть, но сервер её отверг (истекла или пользователя заблокировали).
  // При своём выходе сюда не лезем: сессия тоже отвечает 401, и этот переход
  // перебивал бы тот, что делает сам выход, — гостя уносило на форму входа.
  useEffect(() => {
    if (isError && logout.isIdle) router.replace('/login');
  }, [isError, logout.isIdle, router]);

  if (isPending || isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-sm text-muted">Загружаем кабинет…</p>
      </div>
    );
  }

  return (
    <AppShell user={user} title={title} onLogout={() => logout.mutate()}>
      {children ?? <Notice title="Раздел пока пуст" />}
    </AppShell>
  );
}
