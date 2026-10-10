'use client';

/** Части кабинета заёмщика: выбор займа, разбивка долга, график с отметками. */
import clsx from 'clsx';
import { CampaignStatusBadge } from './campaign-bits';
import { formatDateTime, formatMoney } from './money';
import { Card, CardTitle } from './ui';
import type {
  AmountDue,
  LoanCard,
  LoanPeriodStatus,
  LoanSchedulePeriod,
} from '@/lib/types';

const PERIOD_TITLE: Record<LoanPeriodStatus, string> = {
  paid: 'оплачен',
  overdue: 'просрочен',
  due: 'наступил',
  upcoming: 'впереди',
};

const PERIOD_STYLE: Record<LoanPeriodStatus, string> = {
  paid: 'border-transparent bg-accent-soft text-accent',
  overdue: 'border-transparent bg-danger-soft text-danger',
  due: 'border-transparent bg-warning-soft text-warning',
  upcoming: 'border-border text-muted',
};

export function PeriodBadge({ status }: { status: LoanPeriodStatus }) {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        PERIOD_STYLE[status],
      )}
    >
      {PERIOD_TITLE[status]}
    </span>
  );
}

/**
 * Переключатель займов. Показывается только когда их больше одного: у
 * большинства заёмщиков заём один, и лишний ряд кнопок ему ни о чём.
 */
export function LoanPicker({
  loans,
  value,
  onChange,
}: {
  loans: LoanCard[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (loans.length < 2) return null;
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <div className="flex gap-2">
        {loans.map((loan) => (
          <button
            key={loan.id}
            onClick={() => onChange(loan.id)}
            className={clsx(
              'min-h-11 shrink-0 rounded-lg border px-3 text-sm',
              loan.id === value
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border bg-surface text-muted',
            )}
          >
            {loan.title}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Разбивка суммы к оплате. Сумма посчитана на момент `now`: контракт сам
 * считал долг раньше — по `accruedTo`, — а проценты с пенёй между этими
 * моментами досчитала платформа теми же правилами.
 */
export function DueBreakdown({
  due,
  decimals,
  accruedTo,
  now,
}: {
  due: AmountDue;
  decimals: number;
  accruedTo: number;
  now: number;
}) {
  const rows: [string, string][] = [
    ['Проценты по графику', due.scheduledInterest],
    ['Проценты на просрочку', due.extraInterest],
    ['Тело займа', due.principal],
    ['Пеня', due.penalty],
  ];
  return (
    <div>
      <dl className="space-y-1 text-sm">
        {rows
          .filter(([, value]) => value !== '0')
          .map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted">{label}</dt>
              <dd className="tabular-nums">{formatMoney(value, decimals)}</dd>
            </div>
          ))}
        <div className="flex justify-between gap-3 border-t border-border pt-2 font-medium">
          <dt>Итого к оплате</dt>
          <dd className="tabular-nums">{formatMoney(due.total, decimals)}</dd>
        </div>
      </dl>
      {due.total !== '0' && accruedTo < now ? (
        <p className="mt-2 text-xs text-muted">
          Проценты и пеня посчитаны на {formatDateTime(now)}; контракт закрепит
          их в момент платежа. Переводите с небольшим запасом — излишек
          останется на адресе погашения и не пропадёт.
        </p>
      ) : null}
    </div>
  );
}

/** График платежей с отметками: что оплачено, что наступило, что впереди. */
export function LoanSchedule({
  periods,
  decimals,
  title = 'График платежей',
}: {
  periods: LoanSchedulePeriod[];
  decimals: number;
  title?: string;
}) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>

      {/* Телефон: список карточек — таблица в 375px не помещается */}
      <ul className="space-y-2 sm:hidden">
        {periods.map((period) => (
          <li
            key={period.index}
            className="rounded-lg border border-border p-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-muted">
                {period.index}. {formatDateTime(period.dueTs)}
              </span>
              <PeriodBadge status={period.status} />
            </div>
            <p className="mt-1 text-sm tabular-nums">
              {formatMoney(period.total, decimals)}
              <span className="ml-2 text-xs text-muted">
                тело {formatMoney(period.principal, decimals)} · проценты{' '}
                {formatMoney(period.interest, decimals)}
              </span>
            </p>
            {period.paid !== '0' && period.paid !== period.total ? (
              <p className="mt-1 text-xs text-muted">
                внесено {formatMoney(period.paid, decimals)}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-2 font-medium">№</th>
              <th className="py-2 font-medium">Дата</th>
              <th className="py-2 text-right font-medium">Проценты</th>
              <th className="py-2 text-right font-medium">Тело</th>
              <th className="py-2 text-right font-medium">Платёж</th>
              <th className="py-2 text-right font-medium">Внесено</th>
              <th className="py-2 text-right font-medium">Состояние</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {periods.map((period) => (
              <tr key={period.index} className="border-t border-border">
                <td className="py-2">{period.index}</td>
                <td className="py-2">{formatDateTime(period.dueTs)}</td>
                <td className="py-2 text-right">
                  {formatMoney(period.interest, decimals)}
                </td>
                <td className="py-2 text-right">
                  {formatMoney(period.principal, decimals)}
                </td>
                <td className="py-2 text-right font-medium">
                  {formatMoney(period.total, decimals)}
                </td>
                <td className="py-2 text-right text-muted">
                  {formatMoney(period.paid, decimals)}
                </td>
                <td className="py-2 text-right">
                  <PeriodBadge status={period.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Строка займа в списке: статус, собранная сумма и ближайший платёж. */
export function LoanRow({
  loan,
  active,
  onSelect,
}: {
  loan: LoanCard;
  active?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      disabled={!onSelect}
      className={clsx(
        'w-full rounded-xl border p-4 text-left transition',
        active ? 'border-accent bg-accent-soft' : 'border-border bg-surface',
        onSelect ? 'hover:border-accent' : 'cursor-default',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{loan.title}</span>
        <CampaignStatusBadge status={loan.status} />
      </div>
      <p className="mt-1 text-sm text-muted tabular-nums">
        {formatMoney(loan.totalRaised, loan.mintDecimals)} · {note(loan)}
      </p>
      {loan.due !== '0' ? (
        <p className="mt-1 text-sm font-medium text-warning tabular-nums">
          к оплате {formatMoney(loan.due, loan.mintDecimals)}
          {loan.daysPastDue > 0 ? ` · просрочка ${loan.daysPastDue} дн` : ''}
        </p>
      ) : null}
    </button>
  );
}

/** Что написать под суммой: у сбора и у выданного займа это разные вещи. */
function note(loan: LoanCard): string {
  if (loan.status === 'FAILED') return 'сбор не состоялся, взносы у инвесторов';
  if (loan.status === 'FUNDING' || loan.status === 'FUNDING_ENDED') {
    return `сбор до ${formatDateTime(loan.fundingDeadline)}`;
  }
  return loan.next
    ? `следующий платёж ${formatDateTime(loan.next.dueTs)}`
    : 'платежей по графику больше нет';
}
