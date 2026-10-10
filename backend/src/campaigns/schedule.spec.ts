import {
  buildSchedule,
  fractionsFor,
  SCALE,
  scheduleToCsv,
  STEP_SECONDS,
} from './schedule.js';

const USDC = 1_000_000n;
const AMOUNT = 100_000n * USDC;
const FIRST_DUE = 1_800_000_000;

/** Эталон из тестов контракта: 100 000 USDC, 12 месяцев, 10% годовых. */
const reference = {
  amount: AMOUNT,
  kind: 'ANNUITY' as const,
  periodCount: 12,
  periodsPerYear: 12,
  annualRateBps: 1_000,
  firstDueTs: FIRST_DUE,
  step: 'MONTH' as const,
};

const usd = (value: bigint) => Number(value) / 1e6;

describe('график платежей', () => {
  it('аннуитет совпадает с эталоном контракта', () => {
    const { periods, totals } = buildSchedule(reference);

    expect(periods).toHaveLength(12);
    // Платёж ≈ 8 791,59, проценты первого месяца ровно 833,33.
    expect(usd(periods[0].total)).toBeCloseTo(8_791.59, 1);
    expect(usd(periods[0].interest)).toBeCloseTo(833.33, 2);
    expect(usd(periods[0].principal)).toBeCloseTo(7_958.26, 1);
    // Остаток после шести платежей ≈ 51 244,54.
    expect(usd(periods[5].balance)).toBeCloseTo(51_244.54, 0);
    // Последний платёж гасит долг полностью.
    expect(periods[11].balance).toBe(0n);
    expect(usd(totals.total)).toBeCloseTo(105_499.07, 0);
  });

  it('тело сходится ровно, без потерь на округлении', () => {
    for (const amount of [AMOUNT, 33_333n * USDC + 333_333n, 7n * USDC + 1n]) {
      for (const periodCount of [1, 5, 12, 37, 60]) {
        const { periods, totals } = buildSchedule({
          ...reference,
          amount,
          periodCount,
        });
        const principal = periods.reduce(
          (sum, period) => sum + period.principal,
          0n,
        );
        expect(principal, `${amount} за ${periodCount} платежей`).toBe(amount);
        expect(totals.principal).toBe(amount);
        expect(periods[periods.length - 1].balance).toBe(0n);
      }
    }
  });

  it('сумма долей всегда ровно SCALE — иначе контракт не примет график', () => {
    for (const kind of ['ANNUITY', 'COUPON'] as const) {
      for (const periodsPerYear of [1, 2, 4, 12]) {
        for (const periodCount of [1, 3, 12, 60]) {
          const fractions = fractionsFor({
            kind,
            annualRateBps: 1_500,
            periodsPerYear,
            periodCount,
          });
          const sum = fractions.reduce((a, b) => a + b, 0n);
          expect(sum, `${kind} ${periodsPerYear}/${periodCount}`).toBe(SCALE);
        }
      }
    }
  });

  it('купон: проценты каждый период, всё тело в последнем платеже', () => {
    const { periods, totals } = buildSchedule({ ...reference, kind: 'COUPON' });

    for (const period of periods.slice(0, 11)) {
      expect(period.principal).toBe(0n);
      // Остаток не гасится, поэтому проценты одинаковые: 833,33.
      expect(usd(period.interest)).toBeCloseTo(833.33, 2);
    }
    expect(periods[11].principal).toBe(AMOUNT);
    expect(usd(periods[11].total)).toBeCloseTo(100_833.33, 2);
    expect(usd(totals.interest)).toBeCloseTo(10_000, 0);
  });

  it('периодичность делит ставку: год, полугодие, квартал, месяц', () => {
    for (const [periodsPerYear, expected] of [
      [1, 10_000],
      [2, 5_000],
      [4, 2_500],
      [12, 833.33],
    ] as const) {
      const { periods } = buildSchedule({
        ...reference,
        kind: 'COUPON',
        periodsPerYear,
        periodCount: 2,
      });
      expect(usd(periods[0].interest), `${periodsPerYear} в год`).toBeCloseTo(
        expected,
        2,
      );
    }
  });

  it('шаг между датами не влияет на суммы — только на даты', () => {
    const monthly = buildSchedule(reference);
    const hourly = buildSchedule({ ...reference, step: 'HOUR' });

    expect(hourly.periods.map((p) => p.total)).toEqual(
      monthly.periods.map((p) => p.total),
    );
    expect(hourly.periods[1].dueTs - hourly.periods[0].dueTs).toBe(
      STEP_SECONDS.HOUR,
    );
    // Двенадцать платежей по часу — цикл за половину суток.
    const span = hourly.periods[11].dueTs - hourly.periods[0].dueTs;
    expect(span).toBe(11 * STEP_SECONDS.HOUR);
  });

  it('ежедневный график: суммы месячные, срок 12 дней', () => {
    const daily = buildSchedule({ ...reference, step: 'DAY' });
    expect(usd(daily.periods[0].total)).toBeCloseTo(8_791.59, 1);
    expect(daily.periods[11].dueTs - daily.periods[0].dueTs).toBe(
      11 * STEP_SECONDS.DAY,
    );
  });

  it('комиссия платформы удерживается при выдаче, платежи не меняет', () => {
    const withFee = buildSchedule({ ...reference, platformFeeBps: 300 });
    const withoutFee = buildSchedule(reference);

    expect(usd(withFee.totals.platformFee)).toBeCloseTo(3_000, 6);
    expect(usd(withFee.totals.payout)).toBeCloseTo(97_000, 6);
    expect(withFee.periods.map((p) => p.total)).toEqual(
      withoutFee.periods.map((p) => p.total),
    );
  });

  it('нулевая ставка даёт равные доли тела и нулевые проценты', () => {
    const { periods, totals } = buildSchedule({
      ...reference,
      annualRateBps: 0,
    });
    expect(totals.interest).toBe(0n);
    expect(periods[0].principal).toBe(periods[5].principal);
  });

  it('выгрузка CSV содержит заголовок, все платежи и итог', () => {
    const csv = scheduleToCsv(buildSchedule(reference));
    const lines = csv.trimEnd().split('\r\n');

    expect(lines[0]).toContain('Остаток долга');
    expect(lines).toHaveLength(14);
    expect(lines[13]).toContain('Итого');
    // BOM нужен Excel, иначе кириллица ломается.
    expect(csv.startsWith('﻿')).toBe(true);
  });
});
