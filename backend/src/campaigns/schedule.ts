/**
 * Расчёт графика платежей — повторяет логику контракта, чтобы админ и заёмщик
 * видели те же числа, что потом посчитает программа.
 *
 * Источник правды по формулам: `build_schedule` и `recompute_interest`
 * в dala_capital/programs/dala_capital/src/state/accounting.rs.
 */

/** Масштаб долей тела: контракт хранит их как доли от 1e12. */
export const SCALE = 1_000_000_000_000n;
const BPS = 10_000n;

export type ScheduleKind = 'ANNUITY' | 'COUPON';

/**
 * Шаг между датами платежей. Даты контракт получает готовыми метками, шага он
 * не хранит — поэтому интервал любой. Месяц здесь 30 суток, как и везде на
 * ACT/360, отсюда квартал 90, полугодие 180 и год 360.
 */
export type ScheduleStep =
  'YEAR' | 'HALF_YEAR' | 'QUARTER' | 'MONTH' | 'WEEK' | 'DAY' | 'HOUR';

const DAY_SECONDS = 24 * 60 * 60;

export const STEP_SECONDS: Record<ScheduleStep, number> = {
  YEAR: 360 * DAY_SECONDS,
  HALF_YEAR: 180 * DAY_SECONDS,
  QUARTER: 90 * DAY_SECONDS,
  MONTH: 30 * DAY_SECONDS,
  WEEK: 7 * DAY_SECONDS,
  DAY: DAY_SECONDS,
  HOUR: 60 * 60,
};

export interface SchedulePeriod {
  /** Номер платежа, с единицы. */
  index: number;
  dueTs: number;
  /** Доля тела в платеже, масштаб SCALE — именно её получает контракт. */
  principalFraction: bigint;
  principal: bigint;
  interest: bigint;
  total: bigint;
  /** Остаток тела после платежа. */
  balance: bigint;
}

export interface ScheduleTotals {
  principal: bigint;
  interest: bigint;
  /** Всё, что заёмщик отдаёт за срок займа. */
  total: bigint;
  /** Комиссия платформы удерживается при выдаче, а не с платежей. */
  platformFee: bigint;
  /** Сколько заёмщик получит на руки после удержания комиссии. */
  payout: bigint;
}

export interface ScheduleParams {
  amount: bigint;
  kind: ScheduleKind;
  periodCount: number;
  /** 1, 2, 4 или 12 — делитель годовой ставки. */
  periodsPerYear: number;
  annualRateBps: number;
  platformFeeBps?: number;
  /** Дата первого платежа; остальные идут с шагом `step`. */
  firstDueTs: number;
  step: ScheduleStep;
}

export interface Schedule {
  periods: SchedulePeriod[];
  totals: ScheduleTotals;
}

/**
 * Доли тела для аннуитета: платёж постоянный, доля тела растёт.
 * Считаем в числах с плавающей точкой, как клиент контракта в тестах,
 * а последняя доля добирает остаток — сумма обязана быть ровно SCALE.
 */
export function annuityFractions(
  annualRateBps: number,
  periodsPerYear: number,
  periodCount: number,
): bigint[] {
  const rate = annualRateBps / 10_000 / periodsPerYear;
  // При нулевой ставке аннуитет вырождается в равные доли тела.
  const payment =
    rate === 0
      ? 1 / periodCount
      : rate / (1 - Math.pow(1 + rate, -periodCount));

  let balance = 1;
  let assigned = 0n;
  const fractions: bigint[] = [];

  for (let k = 0; k < periodCount; k++) {
    const principal = payment - balance * rate;
    balance -= principal;
    const fraction =
      k + 1 === periodCount
        ? SCALE - assigned
        : BigInt(Math.round(principal * 1e12));
    assigned += fraction;
    fractions.push(fraction);
  }
  return fractions;
}

/** Купон: проценты каждый период, всё тело — последним платежом. */
export function couponFractions(periodCount: number): bigint[] {
  return Array.from({ length: periodCount }, (_, k) =>
    k + 1 === periodCount ? SCALE : 0n,
  );
}

export function fractionsFor(params: {
  kind: ScheduleKind;
  annualRateBps: number;
  periodsPerYear: number;
  periodCount: number;
}): bigint[] {
  return params.kind === 'ANNUITY'
    ? annuityFractions(
        params.annualRateBps,
        params.periodsPerYear,
        params.periodCount,
      )
    : couponFractions(params.periodCount);
}

/**
 * Полный график: тело из долей, проценты — от остатка долга.
 * Последний платёж добирает остаток тела, как в контракте.
 */
export function buildSchedule(params: ScheduleParams): Schedule {
  const fractions = fractionsFor(params);
  const rate = BigInt(params.annualRateBps);
  const denominator = BPS * BigInt(params.periodsPerYear);
  const stepSeconds = STEP_SECONDS[params.step];

  let balance = params.amount;
  let assigned = 0n;
  const periods: SchedulePeriod[] = [];

  for (let k = 0; k < params.periodCount; k++) {
    const principal =
      k + 1 === params.periodCount
        ? params.amount - assigned
        : (params.amount * fractions[k]) / SCALE;
    assigned += principal;

    // Проценты считаются от остатка ДО списания тела этого платежа.
    const interest = (balance * rate) / denominator;
    balance -= principal;

    periods.push({
      index: k + 1,
      dueTs: params.firstDueTs + k * stepSeconds,
      principalFraction: fractions[k],
      principal,
      interest,
      total: principal + interest,
      balance,
    });
  }

  const interest = periods.reduce((sum, period) => sum + period.interest, 0n);
  const platformFee =
    (params.amount * BigInt(params.platformFeeBps ?? 0)) / BPS;

  return {
    periods,
    totals: {
      principal: params.amount,
      interest,
      total: params.amount + interest,
      platformFee,
      payout: params.amount - platformFee,
    },
  };
}

/** График в CSV: для заёмщика и юристов. Разделитель — точка с запятой, как ждёт Excel. */
export function scheduleToCsv(schedule: Schedule, decimals = 6): string {
  const money = (value: bigint) => {
    const unit = 10n ** BigInt(decimals);
    const whole = value / unit;
    const fraction = (value % unit)
      .toString()
      .padStart(decimals, '0')
      .slice(0, 2);
    return `${whole},${fraction}`;
  };
  const date = (ts: number) => new Date(ts * 1000).toLocaleString('ru-RU');

  const rows = [
    ['№', 'Дата', 'Проценты', 'Тело', 'Платёж', 'Остаток долга'].join(';'),
    ...schedule.periods.map((period) =>
      [
        period.index,
        date(period.dueTs),
        money(period.interest),
        money(period.principal),
        money(period.total),
        money(period.balance),
      ].join(';'),
    ),
    [
      'Итого',
      '',
      money(schedule.totals.interest),
      money(schedule.totals.principal),
      money(schedule.totals.total),
      '',
    ].join(';'),
  ];
  // BOM — иначе Excel открывает кириллицу кракозябрами.
  return `﻿${rows.join('\r\n')}\r\n`;
}
