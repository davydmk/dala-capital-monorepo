'use client';

import { formatDateTime, formatMoney } from './money';
import { Card, CardTitle } from './ui';
import type { Schedule } from '@/lib/types';

/**
 * График платежей: таблица на широком экране, карточки на телефоне.
 * Числа те же, что потом посчитает контракт.
 */
export function ScheduleTable({
  schedule,
  title,
  internal = false,
}: {
  schedule: Schedule;
  title: string;
  /** Комиссия платформы и выплата заёмщику — внутренняя кухня, инвестору её не показываем. */
  internal?: boolean;
}) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>

      {/* Телефон: список карточек — таблица в 375px не помещается */}
      <ul className="space-y-2 sm:hidden">
        {schedule.periods.map((period) => (
          <li
            key={period.index}
            className="rounded-lg border border-border p-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-muted">
                {period.index}. {formatDateTime(period.dueTs)}
              </span>
              <span className="font-medium tabular-nums">
                {formatMoney(period.total)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              тело {formatMoney(period.principal)} · проценты{' '}
              {formatMoney(period.interest)} · остаток{' '}
              {formatMoney(period.balance)}
            </p>
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
              <th className="py-2 text-right font-medium">Остаток</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {schedule.periods.map((period) => (
              <tr key={period.index} className="border-t border-border">
                <td className="py-2">{period.index}</td>
                <td className="py-2">{formatDateTime(period.dueTs)}</td>
                <td className="py-2 text-right">
                  {formatMoney(period.interest)}
                </td>
                <td className="py-2 text-right">
                  {formatMoney(period.principal)}
                </td>
                <td className="py-2 text-right font-medium">
                  {formatMoney(period.total)}
                </td>
                <td className="py-2 text-right text-muted">
                  {formatMoney(period.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="mt-4 grid gap-2 border-t border-border pt-3 text-sm sm:grid-cols-2">
        <Total label="Тело займа" value={schedule.totals.principal} />
        <Total label="Проценты за срок" value={schedule.totals.interest} />
        <Total label="Заёмщик отдаёт всего" value={schedule.totals.total} />
        {internal ? (
          <>
            <Total
              label="Комиссия платформы"
              value={schedule.totals.platformFee}
            />
            <Total
              label="Заёмщик получит на руки"
              value={schedule.totals.payout}
            />
          </>
        ) : null}
      </dl>
    </Card>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{formatMoney(value)}</dd>
    </div>
  );
}
