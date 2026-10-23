'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import { HOME_BY_ROLE, type User } from '@/lib/types';
import { Button, Card, Field, Notice } from '@/components/ui';

const schema = z.object({
  email: z.email({ message: 'Введите корректную почту' }),
  password: z.string().min(1, 'Введите пароль'),
});
type Values = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const queryClient = useQueryClient();
  const login = useMutation<User, ApiError, Values>({
    mutationFn: ({ email, password }) => api.login(email, password),
    onSuccess: (user) => {
      // В одной вкладке могли войти другим человеком — старый кэш ему не принадлежит.
      queryClient.clear();
      queryClient.setQueryData(['session'], user);
      // Возвращаем туда, куда человек шёл до входа, иначе — в кабинет его роли.
      const next = params.get('next');
      router.replace(next?.startsWith('/') ? next : HOME_BY_ROLE[user.role]);
      router.refresh();
    },
  });

  return (
    <Card>
      <h1 className="text-xl font-semibold">Вход</h1>
      <p className="mt-1 mb-5 text-sm text-muted">Войдите в свой кабинет</p>

      <form
        className="space-y-4"
        onSubmit={handleSubmit((values) => login.mutate(values))}
        noValidate
      >
        <Field
          label="Почта"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          error={errors.email?.message}
          {...register('email')}
        />
        <Field
          label="Пароль"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />

        {login.isError ? (
          <Notice tone="danger" title={login.error.message} />
        ) : null}

        <Button type="submit" className="w-full" loading={login.isPending}>
          Войти
        </Button>
      </form>

      <div className="mt-5 flex flex-col gap-2 text-sm">
        <span className="text-muted">
          Нет аккаунта?{' '}
          <Link href="/register" className="font-medium text-accent">
            Зарегистрироваться
          </Link>
        </span>
        {/* Сброс пароля включим вместе с отправкой писем. */}
        <span
          className="text-muted opacity-60"
          title="Появится после подключения почты"
        >
          Забыли пароль?
        </span>
      </div>
    </Card>
  );
}
