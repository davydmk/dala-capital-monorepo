'use client';

/**
 * Проверка выпуска без входа.
 *
 * Отпечаток реестра считается по строкам «счёт:токен-счёт:бумаги:сумма» —
 * имён в нём нет. Поэтому список, который он покрывает, публикуется целиком,
 * а браузер пересчитывает SHA-256 прямо здесь и сравнивает с тем, что лежит
 * в аккаунте действия в сети. Именная выписка остаётся у регистратора.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActionCodes,
  ActionKindTitle,
  ActionStatusBadge,
  BondStatusBadge,
  shortHash,
} from '@/components/bond-bits';
import { Copyable } from '@/components/copyable';
import { formatDateTime, formatMoney } from '@/components/money';
import { Button, Card, CardTitle, Notice, StatTile } from '@/components/ui';
import { api } from '@/lib/api';
import type { CorporateAction, PublicRegister } from '@/lib/types';

/** Бумаги считаются штуками: разделитель разрядов и ничего больше. */
const units = (value: string) =>
  new Intl.NumberFormat('ru-RU').format(BigInt(value));

/** Канонизация списка — ровно та же, что в контракте и на бэкенде. */
function canonical(register: PublicRegister): string {
  const rows = register.holders
    .map(
      (row) => `${row.holder}:${row.tokenAccount}:${row.units}:${row.amount}`,
    )
    .join('\n');
  return `${register.recordTs}\n${rows}`;
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function VerifyView() {
  const bonds = useQuery({
    queryKey: ['public-bonds'],
    queryFn: () => api.publicBonds.list(),
  });
  const [picked, setPicked] = useState<string | null>(null);
  const current = picked ?? bonds.data?.[0]?.campaignId ?? null;

  const bond = useQuery({
    queryKey: ['public-bond', current],
    queryFn: () => api.publicBonds.get(current!),
    enabled: Boolean(current),
  });

  if (bonds.isPending) {
    return <p className="text-sm text-muted">Читаем выпуски из сети…</p>;
  }
  if (bonds.isError || !bonds.data?.length) {
    return (
      <Notice tone="warning" title="Выпусков пока нет">
        Как только выпуск будет размещён, он появится здесь.
      </Notice>
    );
  }

  const decimals = bond.data?.mintDecimals ?? 6;

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Выпуск</CardTitle>
        <div className="mb-3 flex flex-wrap gap-2">
          {bonds.data.map((row) => (
            <Button
              key={row.campaignId}
              variant={row.campaignId === current ? 'primary' : 'secondary'}
              onClick={() => setPicked(row.campaignId)}
            >
              {row.isin || row.title}
            </Button>
          ))}
        </div>

        {bond.data ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-medium">{bond.data.title}</span>
              <BondStatusBadge status={bond.data.status} />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="ISIN" value={bond.data.isin || '—'} />
              <StatTile
                label="Номинал"
                value={formatMoney(bond.data.faceValue, decimals)}
              />
              <StatTile
                label="Купон"
                value={`${bond.data.couponRateBps / 100}% · ${bond.data.couponsPerYear} раза в год`}
              />
              <StatTile
                label="В обращении"
                value={`${units(bond.data.outstanding)} из ${units(bond.data.issued)}`}
              />
            </div>
            <p className="mt-3 text-sm text-muted">
              Минт бумаги в сети:{' '}
              <a
                href={bond.data.mintUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                {shortHash(bond.data.mint)}
              </a>{' '}
              — предложение и условия читаются оттуда, а не отсюда.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">Читаем выпуск…</p>
        )}
      </Card>

      {bond.data?.actions.length ? (
        bond.data.actions.map((action) => (
          <ActionCard
            key={action.index}
            campaignId={bond.data!.campaignId}
            action={action}
            decimals={decimals}
          />
        ))
      ) : bond.data ? (
        <Card>
          <p className="text-sm text-muted">
            По этому выпуску корпоративных действий ещё не объявляли.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

/** Одно действие: что записано в сети и список, который покрыт отпечатком. */
function ActionCard({
  campaignId,
  action,
  decimals,
}: {
  campaignId: string;
  action: CorporateAction;
  decimals: number;
}) {
  const [open, setOpen] = useState(false);
  const register = useQuery({
    queryKey: ['public-register', campaignId, action.index],
    queryFn: () => api.publicBonds.register(campaignId, action.index),
    enabled: open && action.status !== 'declared',
  });

  const check = useMutation({
    mutationFn: async () => {
      if (!register.data) throw new Error('Список ещё не загружен');
      const digest = await sha256(canonical(register.data));
      return { digest, match: digest === action.registerHash };
    },
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>
          <ActionKindTitle kind={action.kind} />
          <ActionCodes kind={action.kind} />
        </CardTitle>
        <ActionStatusBadge status={action.status} kind={action.kind} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Дата фиксации" value={formatDateTime(action.recordTs)} />
        <StatTile label="Дата выплаты" value={formatDateTime(action.paymentTs)} />
        <StatTile
          label={action.kind === 'vote' ? 'Бюджет взыскания' : 'На бумагу'}
          value={formatMoney(action.amountPerUnit, decimals)}
        />
        <StatTile
          label="Держателей · бумаг"
          value={`${action.holders} · ${units(action.units)}`}
        />
      </div>

      {action.kind === 'vote' && action.status !== 'declared' ? (
        <p className="mt-3 text-sm">
          Итог в сети: за {units(action.votesFor)}, против{' '}
          {units(action.votesAgainst)}.
        </p>
      ) : null}

      <div className="mt-3 space-y-1 text-sm">
        <p className="text-muted">
          Хеш реестра в сети:{' '}
          <span className="font-mono text-xs">{action.registerHash}</span>
        </p>
        {action.settlementUrl ? (
          <p className="text-muted">
            Расчётная транзакция:{' '}
            <a
              href={action.settlementUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              открыть в обозревателе
            </a>
          </p>
        ) : null}
      </div>

      {action.status === 'declared' ? (
        <p className="mt-3 text-sm text-muted">
          Список держателей по этому действию ещё не составлен: до даты фиксации
          его не снимают.
        </p>
      ) : (
        <div className="mt-3">
          <Button variant="secondary" onClick={() => setOpen(!open)}>
            {open ? 'Скрыть список' : 'Показать список держателей'}
          </Button>
        </div>
      )}

      {open ? (
        register.isPending ? (
          <p className="mt-3 text-sm text-muted">Читаем список…</p>
        ) : register.data ? (
          <div className="mt-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 pr-3 text-left font-normal">Счёт</th>
                    <th className="py-1 pr-3 text-left font-normal">
                      Токен-счёт
                    </th>
                    <th className="py-1 pr-3 text-right font-normal">Бумаг</th>
                    <th className="py-1 text-right font-normal">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {register.data.holders.map((row) => (
                    <tr key={row.tokenAccount} className="border-t border-border">
                      <td className="py-1 pr-3 font-mono text-xs">
                        {shortHash(row.holder)}
                      </td>
                      <td className="py-1 pr-3 font-mono text-xs">
                        {shortHash(row.tokenAccount)}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">
                        {units(row.units)}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {formatMoney(row.amount, decimals)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button loading={check.isPending} onClick={() => check.mutate()}>
                Проверить хеш
              </Button>
              <span className="text-sm text-muted">
                Считается в вашем браузере, без обращения к нам
              </span>
            </div>

            {check.data ? (
              <div className="mt-3">
                <Notice
                  tone={check.data.match ? 'info' : 'danger'}
                  title={
                    check.data.match
                      ? 'Сошлось: список тот самый'
                      : 'Не сошлось'
                  }
                >
                  SHA-256 опубликованного списка —{' '}
                  <span className="font-mono text-xs">{check.data.digest}</span>
                  {check.data.match
                    ? '. Ровно этот отпечаток записан в аккаунте действия в сети, и записан он был до выплаты.'
                    : '. Это значит, что список и отпечаток в сети расходятся.'}
                </Notice>
              </div>
            ) : null}

            <p className="mt-3 text-xs text-muted">
              В отпечаток идут только счёт, токен-счёт, бумаги и сумма. Имя,
              тип и страна держателя — атрибуты анкеты: они есть у регистратора,
              в сеть не уходят и на подсчёт прав не влияют.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">Список недоступен.</p>
        )
      ) : null}

      <div className="mt-3">
        <Copyable value={action.registerHash} />
      </div>
    </Card>
  );
}
