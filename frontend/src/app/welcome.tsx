'use client';

/**
 * Титульная для тех, кто пришёл без доступов. Главное на ней — войти и
 * посмотреть: три роли, настоящие данные стенда, но сервер не примет ни
 * одного изменения. Кнопка обычного входа стоит рядом и такого же размера:
 * у кого доступы есть, тому не нужно искать её мелким шрифтом внизу.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Notice } from '@/components/ui';
import { api, type ApiError } from '@/lib/api';
import { HOME_BY_ROLE } from '@/lib/types';

type ViewRole = 'admin' | 'investor' | 'borrower';

const ROLES: { role: ViewRole; title: string; hint: string }[] = [
  {
    role: 'admin',
    title: 'Администратор',
    hint: 'Выпуски, корпоративные действия, реестр держателей поимённо',
  },
  {
    role: 'investor',
    title: 'Инвестор',
    hint: 'Бумаги на руках, выплаты, голосования держателей',
  },
  {
    role: 'borrower',
    title: 'Заёмщик',
    hint: 'График платежей, долг посекундно, досрочное погашение',
  },
];

export function Welcome() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<ViewRole | null>(null);

  const enter = useMutation({
    mutationFn: (role: ViewRole) => api.view(role),
    onSuccess: (user) => {
      // Предыдущая роль могла остаться в кэше — тогда новый кабинет откроется
      // с чужим именем и чужим меню, пока запрос не обновится.
      queryClient.clear();
      queryClient.setQueryData(['session'], user);
      router.push(HOME_BY_ROLE[user.role]);
    },
  });

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-4 py-12">
      <p className="text-sm text-muted">Dala Capital · devnet</p>
      <h1 className="mt-2 text-3xl font-semibold">
        Частное кредитование и облигации на Solana
      </h1>
      <p className="mt-4 text-muted">
        Казахстанский бизнес занимает в USDC у иностранных инвесторов.
        Заём и облигацию по нему ведёт смарт-контракт — от сбора до погашения.
      </p>

      <h2 className="mt-10 text-lg font-semibold">Зайти и посмотреть</h2>
      <p className="mt-1 text-sm text-muted">
        Настоящие кабинеты с настоящими данными стенда. Регистрация не нужна,
        изменить ничего нельзя — сервер отклонит любое действие.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {ROLES.map((item) => (
          <button
            key={item.role}
            onClick={() => {
              setPicked(item.role);
              enter.mutate(item.role);
            }}
            disabled={enter.isPending}
            className="rounded-xl border border-border bg-surface p-4 text-left transition hover:border-accent disabled:opacity-60"
          >
            <span className="block font-medium">{item.title}</span>
            <span className="mt-1 block text-sm text-muted">{item.hint}</span>
            {enter.isPending && picked === item.role ? (
              <span className="mt-2 block text-sm text-accent">Открываем…</span>
            ) : null}
          </button>
        ))}
      </div>

      {enter.isError ? (
        <div className="mt-4">
          <Notice tone="danger" title={(enter.error as ApiError).message} />
        </div>
      ) : null}

      <div className="mt-10 border-t border-border pt-6">
        <h2 className="text-lg font-semibold">Есть доступы</h2>
        <p className="mt-1 text-sm text-muted">
          Вход для администратора, инвестора и заёмщика — с правом совершать
          действия.
        </p>
        <div className="mt-3">
          <Button onClick={() => router.push('/login')}>Войти в кабинет</Button>
        </div>
      </div>
    </div>
  );
}
