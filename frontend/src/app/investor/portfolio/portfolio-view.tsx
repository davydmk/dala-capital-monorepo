'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Briefcase, Download } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { CampaignStatusBadge } from '@/components/campaign-bits';
import { CompanyAvatar } from '@/components/company-avatar';
import { formatDateTime, formatMoney } from '@/components/money';
import {
  Button,
  buttonStyles,
  Card,
  EmptyState,
  Chip,
  Notice,
  StatTile,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type {
  MyBond,
  Portfolio,
  PortfolioRow,
  PortfolioTotals,
  ScheduleKind,
} from '@/lib/types';
import { words } from '@/lib/wording';

/** Вид вложения: кредит и облигация живут по разным правилам. */
type Kind = 'all' | ScheduleKind;

const KINDS: { value: Kind; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'ANNUITY', label: 'Кредиты' },
  { value: 'COUPON', label: 'Облигации' },
];

/** Портфель: все участия инвестора одним экраном и вывод по каждому. */
export function PortfolioView() {
  const client = useQueryClient();
  const [kind, setKind] = useState<Kind>('all');
  const portfolio = useQuery({
    queryKey: ['portfolio'],
    queryFn: api.portfolio.list,
  });

  const claim = useMutation<Portfolio, ApiError, string>({
    mutationFn: (campaignId) => api.portfolio.claim(campaignId),
    onSuccess: (data) => client.setQueryData(['portfolio'], data),
  });

  // Сколько бумаг на руках, знает экран бумаг — ключ тот же, так что при
  // переходе туда запрос не повторится. Читать балансы ещё и в портфеле
  // значило бы замедлить его ради цифры, которая уже посчитана рядом.
  const hasBonds = portfolio.data?.rows.some(
    (row) => row.scheduleKind === 'COUPON',
  );
  const bonds = useQuery({
    queryKey: ['my-bonds'],
    queryFn: api.myBonds.list,
    enabled: Boolean(hasBonds),
  });

  if (portfolio.isPending) {
    return <p className="text-sm text-muted">Загружаем портфель…</p>;
  }
  if (portfolio.isError) {
    return (
      <Notice tone="danger" title={(portfolio.error as ApiError).message} />
    );
  }

  const { rows, totals, participationBlock } = portfolio.data;
  const decimals = rows[0]?.mintDecimals ?? 6;
  const shown = rows.filter(
    (row) => kind === 'all' || row.scheduleKind === kind,
  );
  // Плитки считаются по тому, что на экране: иначе итоги сверху обещали бы
  // не то, что видно в списке.
  const sums = kind === 'all' ? totals : sumOf(shown);

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        {participationBlock ? (
          <Notice tone="warning" title={participationBlock} />
        ) : null}
        <Card>
          <EmptyState
            icon={<Briefcase size={28} aria-hidden />}
            title="Участий пока нет"
          >
            Здесь появятся кампании, в которые вы вложились: доля, выплаты по
            графику и вывод средств.
          </EmptyState>
          <Link
            href="/investor/campaigns"
            className={buttonStyles('primary', 'mt-3')}
          >
            Посмотреть кампании <ArrowRight size={16} aria-hidden />
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={kind === 'COUPON' ? 'Размещено' : 'Вложено'}
          value={formatMoney(sums.invested, decimals)}
          hint={
            kind === 'COUPON' ? 'Сумма ваших заявок' : 'Сумма ваших взносов'
          }
        />
        <StatTile
          label="Получено"
          value={formatMoney(sums.received, decimals)}
          hint="Пришло на ваш адрес вывода"
        />
        <StatTile
          label="Ожидается"
          value={formatMoney(sums.available, decimals)}
          hint="Доступно к выводу прямо сейчас"
        />
        <StatTile
          label={
            kind === 'COUPON' ? 'Действующих выпусков' : 'Действующих кампаний'
          }
          value={String(sums.activeCount)}
          hint={
            kind === 'COUPON'
              ? 'Выпуски, где у вас есть доля'
              : 'Займы, где у вас есть доля'
          }
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {KINDS.map((item) => {
          const count =
            item.value === 'all'
              ? rows.length
              : rows.filter((row) => row.scheduleKind === item.value).length;
          return (
            <Chip
              key={item.value}
              active={kind === item.value}
              onClick={() => setKind(item.value)}
            >
              {item.label} · {count}
            </Chip>
          );
        })}
      </div>

      {participationBlock && totals.available !== '0' ? (
        <Notice tone="warning" title={participationBlock}>
          Деньги никуда не денутся: они лежат в контракте и дождутся, когда
          вывод откроется.
        </Notice>
      ) : null}

      {claim.isError ? (
        <Notice tone="danger" title={claim.error.message} />
      ) : null}

      {shown.length === 0 ? (
        <p className="text-sm text-muted">
          {kind === 'COUPON'
            ? 'Облигаций в вашем портфеле нет.'
            : 'Кредитов в вашем портфеле нет.'}
        </p>
      ) : null}

      <ul className="space-y-3">
        {shown.map((row) => (
          <li key={row.id}>
            <Row
              row={row}
              bond={bonds.data?.rows.find(
                (item) => item.campaignId === row.id && item.units !== '0',
              )}
              blocked={Boolean(participationBlock)}
              busy={claim.isPending && claim.variables === row.id}
              onClaim={() => claim.mutate(row.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({
  row,
  bond,
  blocked,
  busy,
  onClaim,
}: {
  row: PortfolioRow;
  /** Бумаги по этому выпуску, если они у держателя есть. */
  bond?: MyBond;
  blocked: boolean;
  busy: boolean;
  onClaim: () => void;
}) {
  const decimals = row.mintDecimals;
  const claimable = row.available !== '0';
  // У облигации это не взнос в кампанию, а заявка на размещение.
  const w = words(row.scheduleKind);
  const isBond = row.scheduleKind === 'COUPON';

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/investor/campaigns/${row.id}`}
          className="flex min-w-0 items-center gap-3"
        >
          <CompanyAvatar
            id={row.borrower.id}
            name={row.borrower.name}
            hasLogo={Boolean(row.borrower.logoKey)}
          />
          <span className="min-w-0">
            <span className="block truncate font-medium">{row.title}</span>
            <span className="block truncate text-sm text-muted">
              {row.borrower.name}
            </span>
          </span>
        </Link>
        <CampaignStatusBadge status={row.status} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
        <Cell label={w.raised} value={formatMoney(row.invested, decimals)} />
        <Cell
          label="Доля"
          value={row.shareBps > 0 ? `${row.shareBps / 100}%` : '—'}
        />
        <Cell label="Получено" value={formatMoney(row.received, decimals)} />
        <Cell
          label={row.refund ? 'К возврату' : 'Доступно к выводу'}
          value={formatMoney(row.available, decimals)}
          accent={claimable}
          hint={row.refund ? undefined : 'растёт в момент платежа, T+0'}
        />
      </dl>

      <p className="mt-3 text-sm text-muted">{note(row, decimals)}</p>

      {bond ? (
        <Link
          href="/investor/bonds"
          className="mt-2 inline-flex items-center gap-1 text-sm text-accent"
        >
          {bond.units} бумаг · купон{' '}
          {formatMoney(bond.couponAmount, bond.mintDecimals)}
          <ArrowRight size={14} aria-hidden />
        </Link>
      ) : null}

      {claimable ? (
        <Button
          className="mt-3"
          disabled={blocked}
          loading={busy}
          onClick={onClaim}
        >
          <Download size={16} aria-hidden />
          {row.refund
            ? isBond
              ? 'Забрать заявку'
              : 'Забрать взнос'
            : 'Забрать'}
        </Button>
      ) : null}
    </Card>
  );
}

function Cell({
  label,
  value,
  accent = false,
  hint,
}: {
  label: string;
  value: string;
  accent?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd
        className={`mt-0.5 font-medium tabular-nums${accent ? ' text-accent' : ''}`}
      >
        {value}
      </dd>
      {hint ? <dd className="text-xs text-muted">{hint}</dd> : null}
    </div>
  );
}

/**
 * Итоги по выбранному срезу. Считаем теми же правилами, что и бэкенд по
 * всему портфелю: простой суммой, действующими — незавершённые.
 */
function sumOf(rows: PortfolioRow[]): PortfolioTotals {
  return {
    invested: rows
      .reduce((sum, row) => sum + BigInt(row.invested), 0n)
      .toString(),
    received: rows
      .reduce((sum, row) => sum + BigInt(row.received), 0n)
      .toString(),
    available: rows
      .reduce((sum, row) => sum + BigInt(row.available), 0n)
      .toString(),
    activeCount: rows.filter((row) => !row.finished).length,
  };
}

/** Строка под суммами: у каждой стадии займа она своя. */
function note(row: PortfolioRow, decimals: number): string {
  if (row.next) {
    return `Следующий платёж ${formatDateTime(row.next.dueTs)} — ваша доля ${formatMoney(row.next.yours, decimals)}`;
  }
  const bond = row.scheduleKind === 'COUPON';
  switch (row.status) {
    case 'FUNDING':
      return `${words(row.scheduleKind).deadline} ${formatDateTime(row.fundingDeadline)}`;
    case 'FUNDING_ENDED':
      return bond
        ? 'Размещение закончилось: платформа подводит итоги и выдаёт заём'
        : 'Сбор закончился: платформа закрывает его и выдаёт заём';
    case 'FAILED':
      return bond
        ? 'Размещение не состоялось: заявка возвращается целиком'
        : 'Сбор не состоялся: взнос возвращается целиком';
    case 'OVERDUE':
      return 'Заёмщик просрочил платёж: на просрочку идут проценты и пеня';
    case 'DEFAULT':
      return 'Объявлен дефолт: идёт взыскание';
    case 'REPAID':
      return 'Заём погашен полностью';
    default:
      return 'Все платежи по графику прошли';
  }
}
