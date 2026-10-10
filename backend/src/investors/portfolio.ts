/**
 * Расчёты портфеля инвестора: что он уже получил, что получит ближайшим
 * платежом и как это складывается в итог.
 *
 * Отдельного поля «выведено» в контракте нет, но оно выводится из чекпоинтов:
 * позиция заводится во время сбора, когда все аккумуляторы на нуле, а
 * `withdraw_payout` сдвигает чекпоинты до текущих аккумуляторов. Значит
 * выведенное по статье — это `floor(principal × checkpoint / SCALE)`, той же
 * формулой и с тем же округлением, что и `pendingPayout`.
 */

import { SCALE, type PayoutParts, type PositionState } from './payout.js';

/** Сколько инвестор уже забрал из кампании, по статьям распределения. */
export function withdrawnSoFar(position: PositionState): PayoutParts {
  const part = (checkpoint: bigint) =>
    (position.principal * checkpoint) / SCALE;
  const principal = part(position.checkpointPrincipal);
  const interest = part(position.checkpointInterest);
  const penalty = part(position.checkpointPenalty);
  const prepaymentFee = part(position.checkpointPrepaymentFee);
  return {
    principal,
    interest,
    penalty,
    prepaymentFee,
    total: principal + interest + penalty + prepaymentFee,
  };
}

/** Платёж графика так, как он лежит в сделке. */
export interface SchedulePeriod {
  dueTs: number;
  principalAmount: bigint;
  interestAmount: bigint;
}

/** Ближайший платёж и доля инвестора в нём. */
export interface NextPayment {
  /** Номер с единицы: так его видит человек в графике. */
  index: number;
  dueTs: number;
  /** Весь платёж по кампании. */
  total: bigint;
  /** Сколько из него придётся на эту позицию. */
  yours: bigint;
}

/**
 * Ближайший платёж, дата которого ещё не наступила, и доля инвестора в нём.
 * Пока сбор идёт, суммы платежей нулевые — контракт считает их при закрытии, —
 * поэтому платежа нет: показывать «следующий платёж 0,00» было бы обманом.
 */
export function nextPaymentShare(
  deal: {
    state: string;
    totalRaised: bigint;
    periods: SchedulePeriod[];
  },
  principal: bigint,
  now: number,
): NextPayment | null {
  if (deal.state !== 'active') return null;

  const index = deal.periods.findIndex((period) => period.dueTs > now);
  const period = deal.periods[index];
  if (!period) return null;

  const total = period.principalAmount + period.interestAmount;
  return {
    index: index + 1,
    dueTs: period.dueTs,
    total,
    yours: deal.totalRaised > 0n ? (total * principal) / deal.totalRaised : 0n,
  };
}

/** Строка портфеля в той части, что участвует в итогах. */
export interface PortfolioAmounts {
  invested: bigint;
  received: bigint;
  available: bigint;
}

export interface PortfolioTotals extends PortfolioAmounts {
  /** Сколько кампаний ещё не завершились: по ним деньги продолжают работать. */
  activeCount: number;
}

/** Итоговые плитки: вложено, получено, ожидается. */
export function portfolioTotals(
  rows: (PortfolioAmounts & { finished: boolean })[],
): PortfolioTotals {
  return rows.reduce<PortfolioTotals>(
    (totals, row) => ({
      invested: totals.invested + row.invested,
      received: totals.received + row.received,
      available: totals.available + row.available,
      activeCount: totals.activeCount + (row.finished ? 0 : 1),
    }),
    { invested: 0n, received: 0n, available: 0n, activeCount: 0 },
  );
}
