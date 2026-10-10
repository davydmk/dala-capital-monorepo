'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { CampaignStatusBadge } from '@/components/campaign-bits';
import { formatMoney } from '@/components/money';
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

/** Дашборд админа: что сейчас требует внимания. */
export function AdminDashboard() {
  const { data: user } = useSession();
  const dashboard = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: api.admin.dashboard,
    // Состояние кампаний живёт в сети и меняется само: обновляем раз в минуту.
    refetchInterval: 60_000,
  });

  if (!user) return null;
  const data = dashboard.data;
  const decimals = data?.overdue[0]?.mintDecimals ?? 6;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold sm:text-2xl">
          Здравствуйте, {user.name}
        </h2>
        <p className="text-sm text-muted">Кабинет · {ROLE_TITLE[user.role]}</p>
      </div>

      <TasksCard />

      {dashboard.isError ? (
        <Notice tone="danger" title={(dashboard.error as ApiError).message} />
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Кампаний в сборе"
          value={data ? String(data.funding) : '—'}
          hint="Идёт приём взносов"
        />
        <StatTile
          label="Собрано за месяц"
          value={data ? formatMoney(data.raised, decimals) : '—'}
          hint="Закрытые сборы за 30 дней"
        />
        <StatTile
          label="Просрочек"
          value={data ? String(data.overdueCount) : '—'}
          hint="Займы с пропущенным платежом"
        />
        <StatTile
          label="Заявок на проверку"
          value={data ? String(data.pendingKyc) : '—'}
          hint="Инвесторы ждут одобрения"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Просрочки</CardTitle>
            {data && data.pendingKyc > 0 ? (
              <Link
                href="/admin/investors"
                className="text-sm text-accent hover:underline"
              >
                {data.pendingKyc} на проверку
              </Link>
            ) : null}
          </div>

          {dashboard.isPending ? (
            <p className="text-sm text-muted">Читаем состояние из сети…</p>
          ) : data && data.overdue.length > 0 ? (
            <ul className="space-y-2">
              {data.overdue.map((loan) => (
                <li key={loan.id}>
                  <Link
                    href={`/admin/campaigns/${loan.id}`}
                    className="block rounded-xl border border-border p-3 transition hover:border-accent"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{loan.title}</span>
                      <CampaignStatusBadge status={loan.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {loan.borrower.name}
                    </p>
                    <p className="mt-1 text-sm tabular-nums">
                      <span
                        className={
                          loan.status === 'DEFAULT'
                            ? 'font-medium text-danger'
                            : 'font-medium text-warning'
                        }
                      >
                        {loan.daysPastDue} дн
                      </span>{' '}
                      {loan.status === 'DEFAULT'
                        ? 'просрочки · во взыскании'
                        : `из ${loan.defaultThresholdDays} до дефолта`}{' '}
                      · к оплате {formatMoney(loan.due, loan.mintDecimals)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<ShieldCheck size={28} aria-hidden />}
              title="Просрочек нет"
            >
              Все действующие займы обслуживаются по графику.
            </EmptyState>
          )}
        </Card>

        {/* Статичного списка шагов здесь больше нет: он был одинаковым
            всегда и к состоянию платформы отношения не имел. Что делать
            сейчас — в карточке «Требует внимания» наверху. */}
        <Card>
          <CardTitle>Куда идти</CardTitle>
          <p className="text-sm text-muted">
            Кампании собирают деньги и выдают займы, заёмщики и инвесторы
            проходят проверку, облигации ведут журнал корпоративных действий.
          </p>
          <Link
            href="/admin/campaigns"
            className={buttonStyles('secondary', 'mt-3 w-full')}
          >
            К кампаниям
          </Link>
        </Card>
      </div>
    </div>
  );
}
