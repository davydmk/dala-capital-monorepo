'use client';

import { useQuery } from '@tanstack/react-query';
import { Briefcase } from 'lucide-react';
import Link from 'next/link';
import { LoanRow } from '@/components/loan-bits';
import { formatDateTime, formatMoney } from '@/components/money';
import { useSession } from '@/components/session';
import {
  buttonStyles,
  Card,
  CardTitle,
  EmptyState,
  Notice,
  StatTile,
  Steps,
} from '@/components/ui';
import { TasksCard } from '@/components/tasks-card';
import { api, ApiError } from '@/lib/api';
import { ROLE_TITLE, type LoanCard } from '@/lib/types';

/** Дашборд заёмщика: ближайший платёж, долг и список своих займов. */
export function BorrowerDashboard() {
  const { data: user } = useSession();
  const loans = useQuery({ queryKey: ['loans'], queryFn: api.loans.list });

  if (!user) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold sm:text-2xl">
          Здравствуйте, {user.name}
        </h2>
        <p className="text-sm text-muted">Кабинет · {ROLE_TITLE[user.role]}</p>
      </div>

      <TasksCard />

      {user.status === 'PENDING' ? (
        <Notice tone="warning" title="Профиль на проверке">
          Обычно проверка занимает один рабочий день. Операции станут доступны
          после одобрения.
        </Notice>
      ) : null}

      {loans.isError ? (
        <Notice tone="danger" title={(loans.error as ApiError).message} />
      ) : null}

      <Tiles loans={loans.data} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Мои займы</CardTitle>
          {loans.isPending ? (
            <p className="text-sm text-muted">Загружаем…</p>
          ) : loans.data && loans.data.length > 0 ? (
            <div className="space-y-2">
              {loans.data.map((loan) => (
                <LoanRow key={loan.id} loan={loan} />
              ))}
              <Link
                href="/borrower/loan"
                className={buttonStyles('secondary', 'mt-2 w-full')}
              >
                Подробно о займе
              </Link>
            </div>
          ) : (
            <EmptyState
              icon={<Briefcase size={28} aria-hidden />}
              title="Займов пока нет"
            >
              Кампанию по вашему займу создаёт платформа. Как только сбор
              откроется, он появится здесь — и вы увидите, сколько уже собрано.
            </EmptyState>
          )}
        </Card>

        <Card>
          <CardTitle>Следующие шаги</CardTitle>
          <Steps
            items={[
              'Проверить данные компании',
              'Указать кошелёк для получения займа',
              'Дождаться завершения сбора',
              'Платить по графику',
            ].map((title) => ({ title }))}
          />
        </Card>
      </div>
    </div>
  );
}

/** Плитки по всем займам: чаще всего он один, но складывать умеем. */
function Tiles({ loans }: { loans: LoanCard[] | undefined }) {
  const active = (loans ?? []).filter((loan) => loan.next || loan.due !== '0');
  const due = active.reduce((sum, loan) => sum + BigInt(loan.due), 0n);
  const outstanding = (loans ?? []).reduce(
    (sum, loan) => sum + BigInt(loan.outstanding),
    0n,
  );
  const overdue = Math.max(0, ...(loans ?? []).map((loan) => loan.daysPastDue));
  const decimals = loans?.[0]?.mintDecimals ?? 6;

  // Ближайшая дата платежа по всем займам.
  const next = active
    .map((loan) => loan.next)
    .filter((payment): payment is NonNullable<typeof payment> =>
      Boolean(payment),
    )
    .sort((a, b) => a.dueTs - b.dueTs)[0];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label="Следующий платёж"
        value={next ? formatMoney(next.total, decimals) : '—'}
        hint="Сумма по графику"
      />
      <StatTile
        label="Дата платежа"
        value={next ? formatDateTime(next.dueTs) : '—'}
        hint="Ближайшая дата из графика"
      />
      <StatTile
        label="Остаток долга"
        value={loans ? formatMoney(outstanding.toString(), decimals) : '—'}
        hint="Непогашенное тело займа"
      />
      <StatTile
        label={due > 0n ? 'К оплате сейчас' : 'Просрочка'}
        value={
          due > 0n ? formatMoney(due.toString(), decimals) : loans ? 'нет' : '—'
        }
        hint={overdue > 0 ? `${overdue} дней просрочки` : 'Платежи по графику'}
      />
    </div>
  );
}
