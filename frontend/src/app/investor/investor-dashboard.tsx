'use client';

import { useQuery } from '@tanstack/react-query';
import { Briefcase } from 'lucide-react';
import Link from 'next/link';
import { CampaignStatusBadge } from '@/components/campaign-bits';
import { formatDateTime, formatMoney } from '@/components/money';
import { useSession } from '@/components/session';
import {
  buttonStyles,
  Card,
  CardTitle,
  EmptyState,
  Notice,
  StatTile,
} from '@/components/ui';
import { TasksCard } from '@/components/tasks-card';
import { api, ApiError } from '@/lib/api';
import { ROLE_TITLE } from '@/lib/types';

/** Дашборд инвестора: итоги портфеля и ближайшие выплаты. */
export function InvestorDashboard() {
  const { data: user } = useSession();
  const portfolio = useQuery({
    queryKey: ['portfolio'],
    queryFn: api.portfolio.list,
  });

  if (!user) return null;
  const data = portfolio.data;
  const decimals = data?.rows[0]?.mintDecimals ?? 6;

  // Ближайшие выплаты по всем участиям сразу: их немного, сортируем на месте.
  const upcoming = (data?.rows ?? [])
    .filter((row) => row.next)
    .sort((a, b) => a.next!.dueTs - b.next!.dueTs)
    .slice(0, 5);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold sm:text-2xl">
          Здравствуйте, {user.name}
        </h2>
        <p className="text-sm text-muted">Кабинет · {ROLE_TITLE[user.role]}</p>
      </div>

      <TasksCard />

      {portfolio.isError ? (
        <Notice tone="danger" title={(portfolio.error as ApiError).message} />
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Вложено"
          value={data ? formatMoney(data.totals.invested, decimals) : '—'}
          hint="Сумма ваших взносов"
        />
        <StatTile
          label="Получено"
          value={data ? formatMoney(data.totals.received, decimals) : '—'}
          hint="Пришло на ваш адрес вывода"
        />
        <StatTile
          label="Ожидается"
          value={data ? formatMoney(data.totals.available, decimals) : '—'}
          hint="Доступно к выводу прямо сейчас"
        />
        <StatTile
          label="Активных кампаний"
          value={data ? String(data.totals.activeCount) : '—'}
          hint="Займы, где у вас есть доля"
        />
      </div>

      <Card>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Ближайшие выплаты</CardTitle>
          {data && data.totals.available !== '0' ? (
            <Link
              href="/investor/portfolio"
              className="text-sm text-accent hover:underline"
            >
              Забрать {formatMoney(data.totals.available, decimals)}
            </Link>
          ) : null}
        </div>

        {portfolio.isPending ? (
          <p className="text-sm text-muted">Загружаем портфель…</p>
        ) : upcoming.length > 0 ? (
          <ul className="space-y-2">
            {upcoming.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
              >
                <span className="min-w-0">
                  <Link
                    href={`/investor/campaigns/${row.id}`}
                    className="block truncate font-medium hover:text-accent"
                  >
                    {row.title}
                  </Link>
                  <span className="text-muted">
                    {formatDateTime(row.next!.dueTs)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 tabular-nums">
                  {formatMoney(row.next!.yours, row.mintDecimals)}
                  <CampaignStatusBadge status={row.status} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<Briefcase size={28} aria-hidden />}
            title="Выплат пока не ожидается"
          >
            Они появятся, когда сбор закроется и заёмщик начнёт платить по
            графику.
          </EmptyState>
        )}

        <Link
          href="/investor/campaigns"
          className={buttonStyles('secondary', 'mt-3 w-full')}
        >
          Посмотреть кампании
        </Link>
      </Card>
    </div>
  );
}
