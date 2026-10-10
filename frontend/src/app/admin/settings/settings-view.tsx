'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Copyable } from '@/components/copyable';
import { formatDateTime } from '@/components/money';
import { Button, Card, CardTitle, Field, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import {
  ADMIN_ACTION_TITLE,
  type PlatformState,
  type TokenInfo,
} from '@/lib/types';

/** Остаток токена показываем с его собственным числом знаков. */
function formatAmount(amount: string | null, decimals: number | null) {
  if (amount === null) return 'счёта нет';
  const value = Number(BigInt(amount)) / 10 ** (decimals ?? 6);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(
    value,
  );
}

export function SettingsView() {
  const client = useQueryClient();
  const platform = useQuery({
    queryKey: ['platform'],
    queryFn: api.platform.state,
  });
  const log = useQuery({ queryKey: ['admin-log'], queryFn: api.platform.log });

  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['platform'] }),
      client.invalidateQueries({ queryKey: ['admin-log'] }),
    ]);
  };

  if (platform.isPending)
    return <p className="text-sm text-muted">Читаем контракт…</p>;
  if (platform.isError) {
    return (
      <Notice
        tone="danger"
        title={`Контракт недоступен: ${platform.error.message}`}
      />
    );
  }

  const data = platform.data;
  const lowKeys = data.roles.filter((role) => role.low);

  return (
    <div className="space-y-4">
      {lowKeys.length > 0 ? (
        <Notice tone="warning" title="Заканчивается SOL">
          Пополните {lowKeys.map((role) => role.title).join(' и ')}: без SOL
          транзакции платформы перестанут проходить.
        </Notice>
      ) : null}

      <Card>
        <CardTitle>Сеть и программа</CardTitle>
        <dl className="grid gap-2 text-sm">
          <Row
            label="Сеть"
            value={<span className="font-medium">{data.cluster}</span>}
          />
          <Row
            label="Программа"
            value={
              <span className="inline-flex items-center gap-2">
                <Copyable value={data.programId} short />
                <a
                  href={data.programUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent"
                >
                  <ExternalLink size={14} aria-hidden />
                </a>
              </span>
            }
          />
          <Row label="Создано кампаний" value={data.campaignCount} />
        </dl>
      </Card>

      <Card>
        <CardTitle>Ключи платформы</CardTitle>
        <ul className="space-y-3">
          {data.roles.map((role) => (
            <li key={role.key} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {role.title}{' '}
                  {/* Техническое имя рядом: по нему сверяются с контрактом. */}
                  <span className="font-normal text-muted">({role.key})</span>
                </span>
                <span
                  className={
                    role.low ? 'font-medium text-warning' : 'text-sm text-muted'
                  }
                >
                  {role.sol === null
                    ? 'баланс недоступен'
                    : `${role.sol.toFixed(3)} SOL`}
                  {role.low ? (
                    <AlertTriangle
                      size={14}
                      className="ml-1 inline"
                      aria-hidden
                    />
                  ) : null}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">{role.purpose}</p>
              <div className="mt-2">
                <Copyable value={role.address} />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Tokens data={data} onChange={refresh} />

      <Card>
        <CardTitle>Журнал действий</CardTitle>
        {log.data?.length ? (
          <ul className="space-y-2 text-sm">
            {log.data.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-x-2 text-muted"
              >
                <span className="text-foreground">
                  {ADMIN_ACTION_TITLE[entry.action] ?? entry.action}
                </span>
                <Copyable value={entry.target} short />
                <span>{entry.actor.email}</span>
                {/* Нажал сотрудник, а подписал ключ роли — это разные вещи. */}
                {entry.roleTitle ? (
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                    {entry.roleTitle}
                  </span>
                ) : null}
                <span className="ml-auto">
                  {formatDateTime(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Пока ничего не происходило.</p>
        )}
      </Card>
    </div>
  );
}

function Tokens({
  data,
  onChange,
}: {
  data: PlatformState;
  onChange: () => Promise<void>;
}) {
  const [mint, setMint] = useState('');
  const [info, setInfo] = useState<TokenInfo | null>(null);

  const check = useMutation<TokenInfo, ApiError, string>({
    mutationFn: api.platform.token,
    onSuccess: setInfo,
  });

  const allow = useMutation<unknown, ApiError, string>({
    mutationFn: api.platform.allowMint,
    onSuccess: async () => {
      setMint('');
      setInfo(null);
      await onChange();
    },
  });

  const remove = useMutation<unknown, ApiError, string>({
    mutationFn: api.platform.removeMint,
    onSuccess: onChange,
  });

  return (
    <Card>
      <CardTitle>Расчётные токены</CardTitle>
      <p className="mb-3 text-sm text-muted">
        Контракт принимает взносы только в разрешённых токенах, не больше
        восьми. Кампания хранит свой токен, поэтому у разных кампаний он может
        отличаться.
      </p>

      {data.tokens.length === 0 ? (
        <Notice tone="warning" title="Токенов нет">
          Пока не разрешён ни один токен, кампанию опубликовать нельзя.
        </Notice>
      ) : (
        <ul className="space-y-2">
          {data.tokens.map((token) => (
            <li
              key={token.address}
              className="rounded-lg border border-border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Copyable value={token.address} />
                <button
                  aria-label="Убрать токен"
                  className="flex size-11 items-center justify-center rounded-lg text-muted hover:text-danger"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Убрать токен? Новые кампании в нём создать будет нельзя.',
                      )
                    )
                      remove.mutate(token.address);
                  }}
                >
                  <Trash2 size={18} />
                </button>
              </div>
              <p className="mt-1 text-xs text-muted">
                знаков: {token.decimals ?? '—'} · в казне:{' '}
                {formatAmount(token.treasuryAmount, token.decimals)} · кампаний:{' '}
                {token.campaigns}
                {token.isToken2022 ? ' · Token-2022' : ''}
              </p>
              {token.hasExtensions ? (
                <p className="mt-1 text-xs text-warning">
                  У токена есть расширения Token-2022. Если среди них комиссия
                  за перевод, инвесторы получат меньше расчётной суммы.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {remove.isError ? (
        <div className="mt-3">
          <Notice tone="danger" title={remove.error.message} />
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field
          label="Адрес токена"
          className="font-mono"
          placeholder="Минт в base58"
          value={mint}
          onChange={(event) => {
            setMint(event.target.value);
            setInfo(null);
            check.reset();
          }}
        />
        <Button
          variant="secondary"
          loading={check.isPending}
          disabled={mint.trim().length < 32}
          onClick={() => check.mutate(mint.trim())}
        >
          Проверить
        </Button>
      </div>

      {check.isError ? (
        <div className="mt-3">
          <Notice tone="danger" title={check.error.message} />
        </div>
      ) : null}

      {info ? (
        <div className="mt-3 space-y-3">
          <Notice
            tone={info.hasExtensions ? 'warning' : 'info'}
            title={`Токен найден: ${info.decimals} знаков после запятой${info.isToken2022 ? ', Token-2022' : ''}`}
          >
            {info.hasExtensions
              ? 'У токена есть расширения. Проверьте, нет ли среди них комиссии за перевод: она съест часть выплат инвесторам.'
              : 'Расширений нет — переводы придут полностью.'}
          </Notice>
          {allow.isError ? (
            <Notice tone="danger" title={allow.error.message} />
          ) : null}
          <Button
            loading={allow.isPending}
            onClick={() => allow.mutate(info.address)}
          >
            Разрешить токен
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-1.5 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
