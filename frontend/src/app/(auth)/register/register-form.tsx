'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import type { User } from '@/lib/types';
import { Button, Card, Field, Notice } from '@/components/ui';

// Те же правила, что на бэкенде: иначе пользователь узнает об ошибке только после запроса.
const schema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Имя от 2 символов')
    .max(120, 'Слишком длинное имя'),
  email: z.email({ message: 'Введите корректную почту' }),
  password: z
    .string()
    .min(10, 'Пароль от 10 символов')
    .max(128, 'Слишком длинный пароль'),
});
type Values = z.infer<typeof schema>;

export function RegisterForm() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const signUp = useMutation<User, ApiError, Values>({
    mutationFn: api.register,
  });

  if (signUp.isSuccess) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 className="text-accent" size={40} aria-hidden />
          <h1 className="text-xl font-semibold">Кабинет создан</h1>
          <p className="text-sm text-muted">
            Войдите и заполните анкету инвестора: до проверки личности кампании
            и пополнение недоступны. Проверка занимает около рабочего дня.
          </p>
          <Link href="/login" className="mt-2 font-medium text-accent">
            Перейти ко входу
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-xl font-semibold">Регистрация инвестора</h1>
      <p className="mt-1 mb-5 text-sm text-muted">
        Заёмщиков и сотрудников добавляет администратор платформы.
      </p>

      <form
        className="space-y-4"
        onSubmit={handleSubmit((values) => signUp.mutate(values))}
        noValidate
      >
        <Field
          label="Имя"
          autoComplete="name"
          placeholder="Иван Иванов"
          error={errors.name?.message}
          {...register('name')}
        />
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
          autoComplete="new-password"
          hint="Не короче 10 символов"
          error={errors.password?.message}
          {...register('password')}
        />

        {signUp.isError ? (
          <Notice tone="danger" title={signUp.error.message} />
        ) : null}

        <Button type="submit" className="w-full" loading={signUp.isPending}>
          Зарегистрироваться
        </Button>
      </form>

      <p className="mt-5 text-sm text-muted">
        Уже есть аккаунт?{' '}
        <Link href="/login" className="font-medium text-accent">
          Войти
        </Link>
      </p>
    </Card>
  );
}
