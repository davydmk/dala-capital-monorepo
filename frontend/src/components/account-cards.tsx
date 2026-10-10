'use client';

/**
 * Учётная запись и пароль — одни и те же карточки в кабинете инвестора и
 * заёмщика: почта, имя, смена пароля. Роль тут ничего не меняет.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil } from 'lucide-react';
import { useState } from 'react';
import { formatDateTime } from './money';
import { Button, Card, CardTitle, Field, Notice } from './ui';
import { Row } from './investor-profile';
import { api, ApiError } from '@/lib/api';
import type { User } from '@/lib/types';

// ── Учётная запись ─────────────────────────────────────────────────────────

export function AccountCard({ user }: { user: User }) {
  const client = useQueryClient();
  const [name, setName] = useState(user.name);
  const [editing, setEditing] = useState(false);

  const rename = useMutation<unknown, ApiError, string>({
    mutationFn: (value) => api.updateName(value),
    onSuccess: async () => {
      setEditing(false);
      // Имя стоит в шапке кабинета — обновляем сессию.
      await client.invalidateQueries({ queryKey: ['session'] });
    },
  });

  return (
    <Card>
      <CardTitle>Учётная запись</CardTitle>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Row label="Почта (логин)" value={user.email} />
        <Row label="Зарегистрирован" value={formatDateTime(user.createdAt)} />
        <Row
          label="Предыдущий вход"
          value={
            user.previousLoginAt
              ? formatDateTime(user.previousLoginAt)
              : 'это первый вход'
          }
        />
      </dl>
      <p className="mt-3 text-sm text-muted">
        Почту меняет только платформа: это логин, и подтвердить смену пока
        нечем.
      </p>

      <div className="mt-4 border-t border-border pt-4">
        {editing ? (
          <div className="space-y-3">
            <Field
              label="Имя"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {rename.isError ? (
              <Notice tone="danger" title={rename.error.message} />
            ) : null}
            <div className="flex gap-2">
              <Button
                loading={rename.isPending}
                disabled={name.trim().length < 2}
                onClick={() => rename.mutate(name.trim())}
              >
                Сохранить
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setName(user.name);
                  setEditing(false);
                }}
              >
                Отмена
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm text-muted">Имя в кабинете</p>
              <p className="font-medium">{user.name}</p>
            </div>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil size={16} aria-hidden /> Изменить
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export function PasswordCard() {
  const empty = { current: '', next: '', repeat: '' };
  const [form, setForm] = useState(empty);
  const [done, setDone] = useState(false);

  const change = useMutation<unknown, ApiError, void>({
    mutationFn: () => api.changePassword(form.current, form.next),
    onSuccess: () => {
      setForm(empty);
      setDone(true);
    },
  });

  const mismatch = form.repeat.length > 0 && form.next !== form.repeat;
  const ready = form.current.length > 0 && form.next.length >= 10 && !mismatch;

  return (
    <Card>
      <CardTitle>Пароль</CardTitle>
      <div className="space-y-3">
        <Field
          label="Текущий пароль"
          type="password"
          autoComplete="current-password"
          value={form.current}
          onChange={(event) =>
            setForm({ ...form, current: event.target.value })
          }
        />
        <Field
          label="Новый пароль"
          type="password"
          autoComplete="new-password"
          hint="От 10 до 128 символов"
          value={form.next}
          onChange={(event) => setForm({ ...form, next: event.target.value })}
        />
        <Field
          label="Повторите новый пароль"
          type="password"
          autoComplete="new-password"
          value={form.repeat}
          onChange={(event) => setForm({ ...form, repeat: event.target.value })}
          error={mismatch ? 'Пароли не совпадают' : undefined}
        />

        {change.isError ? (
          <Notice tone="danger" title={change.error.message} />
        ) : null}
        {done ? <Notice tone="info" title="Пароль изменён" /> : null}

        <Button
          disabled={!ready}
          loading={change.isPending}
          onClick={() => {
            setDone(false);
            change.mutate();
          }}
        >
          <KeyRound size={16} aria-hidden /> Сменить пароль
        </Button>
      </div>
    </Card>
  );
}
