'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, Field, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { HOME_BY_ROLE, type User } from '@/lib/types';

const MIN_PASSWORD = 10;

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');

  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.invite.read(token),
  });

  const accept = useMutation<User, ApiError, string>({
    mutationFn: (value) => api.invite.accept(token, value),
    onSuccess: (user) => {
      // Кука уже стоит: ведём сразу в кабинет.
      router.replace(HOME_BY_ROLE[user.role]);
      router.refresh();
    },
  });

  if (invite.isPending)
    return <p className="text-center text-sm text-muted">Проверяем ссылку…</p>;

  if (invite.isError) {
    return (
      <Card>
        <h1 className="text-xl font-semibold">Ссылка не работает</h1>
        <p className="mt-2 text-sm text-muted">{invite.error.message}</p>
        <p className="mt-4 text-sm text-muted">
          Попросите новую ссылку у Dala Capital или{' '}
          <Link href="/login" className="font-medium text-accent">
            войдите
          </Link>
          , если доступ уже есть.
        </p>
      </Card>
    );
  }

  const mismatch = repeat !== '' && password !== repeat;
  const tooShort = password !== '' && password.length < MIN_PASSWORD;

  return (
    <Card>
      <h1 className="text-xl font-semibold">Доступ в кабинет</h1>
      <p className="mt-1 mb-5 text-sm text-muted">
        {invite.data.company}, вход по адресу {invite.data.email}. Придумайте
        пароль — его знаете только вы.
      </p>

      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!mismatch && !tooShort && password) accept.mutate(password);
        }}
      >
        <Field
          label="Пароль"
          type="password"
          autoComplete="new-password"
          hint={`Не короче ${MIN_PASSWORD} символов`}
          error={tooShort ? `Пароль от ${MIN_PASSWORD} символов` : undefined}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Field
          label="Повторите пароль"
          type="password"
          autoComplete="new-password"
          error={mismatch ? 'Пароли не совпадают' : undefined}
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
        />

        {accept.isError ? (
          <Notice tone="danger" title={accept.error.message} />
        ) : null}

        <Button
          type="submit"
          className="w-full"
          loading={accept.isPending}
          disabled={!password || mismatch || tooShort}
        >
          Создать пароль и войти
        </Button>
      </form>
    </Card>
  );
}
