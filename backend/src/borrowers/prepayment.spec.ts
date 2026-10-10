import { describe, expect, it } from 'vitest';
import { buildSchedule } from '../campaigns/schedule.js';
import type { DebtPeriod } from './debt.js';
import {
  partialWindow,
  prepaymentAllowed,
  quoteFull,
  quotePartial,
  type PrepayInput,
} from './prepayment.js';

const USDC = 1_000_000n;
const DAY = 86_400;
const MONTH = 30 * DAY;
/** Те же условия, что в тестах контракта: 100 000 USDC, 12 месяцев, 10%, комиссия 1%. */
const DEADLINE = 1_700_000_000;
const TOTAL = 100_000n * USDC;

const usdc = (value: number) => BigInt(Math.round(value * 1e6));

/** График из тех же формул, что у контракта: `buildSchedule` их и повторяет. */
function schedule(): DebtPeriod[] {
  const built = buildSchedule({
    amount: TOTAL,
    kind: 'ANNUITY',
    periodCount: 12,
    periodsPerYear: 12,
    annualRateBps: 1_000,
    firstDueTs: DEADLINE + MONTH,
    step: 'MONTH',
  });
  return built.periods.map((period) => ({
    dueTs: period.dueTs,
    principalAmount: period.principal,
    interestAmount: period.interest,
    principalPaid: 0n,
    interestPaid: 0n,
  }));
}

const deal = (overrides: Partial<PrepayInput> = {}): PrepayInput => ({
  state: 'active',
  scheduleType: 'annuity',
  nextPeriod: 0,
  periods: schedule(),
  overduePrincipal: 0n,
  overdueScheduledInterest: 0n,
  extraInterest: 0n,
  penalty: 0n,
  defaultPrincipal: 0n,
  defaultInterest: 0n,
  interestCarry: 0n,
  penaltyCarry: 0n,
  lastAccrualTs: DEADLINE,
  annualRateBps: 1_000,
  penaltyRateBps: 2_000,
  periodsPerYear: 12,
  prepaymentFeeBps: 100,
  fundingDeadline: DEADLINE,
  ...overrides,
});

/** Заём после шести оплаченных платежей — как `deal_after_six_payments` в контракте. */
function afterSixPayments(): PrepayInput {
  const periods = schedule().map((period, index) =>
    index < 6
      ? {
          ...period,
          principalPaid: period.principalAmount,
          interestPaid: period.interestAmount,
        }
      : period,
  );
  return deal({
    periods,
    nextPeriod: 6,
    lastAccrualTs: periods[5].dueTs,
  });
}

describe('кому доступно', () => {
  it('купону досрочное погашение запрещено', () => {
    expect(prepaymentAllowed({ scheduleType: 'coupon' })).toBe(false);
    expect(prepaymentAllowed({ scheduleType: 'annuity' })).toBe(true);
  });
});

describe('полное досрочное погашение', () => {
  it('в дату платежа берётся только остаток тела и комиссия', () => {
    const loan = afterSixPayments();
    const quote = quoteFull(loan, loan.periods[5].dueTs);

    expect(quote.overdue).toBe(0n);
    expect(quote.currentInterest).toBe(0n);
    // Эталон из тестов контракта: остаток тела ≈ 51 244,54.
    expect(Number(quote.remainingPrincipal) / 1e6).toBeCloseTo(51_244.54, 1);
    expect(quote.fee).toBe(quote.remainingPrincipal / 100n);
    expect(Number(quote.fee) / 1e6).toBeCloseTo(512.45, 1);
    expect(quote.total).toBe(quote.remainingPrincipal + quote.fee);
  });

  it('проценты считаются за фактические дни, а не за период', () => {
    const loan = afterSixPayments();
    const now = loan.periods[5].dueTs + 15 * DAY;
    const quote = quoteFull(loan, now);

    const expected =
      (quote.remainingPrincipal * 1_000n * BigInt(15 * DAY)) /
      (10_000n * 360n * 86_400n);
    expect(quote.currentInterest).toBe(expected);
    // Эталон из тестов контракта: ≈ 213,52 за 15 дней.
    expect(Number(quote.currentInterest) / 1e6).toBeCloseTo(213.52, 1);
  });

  it('внесённое вперёд вычитается из процентов текущего периода', () => {
    const loan = afterSixPayments();
    const now = loan.periods[5].dueTs + 15 * DAY;
    const plain = quoteFull(loan, now);

    const advance = plain.currentInterest / 3n;
    loan.periods[6] = { ...loan.periods[6], interestPaid: advance };
    expect(quoteFull(loan, now).currentInterest).toBe(
      plain.currentInterest - advance,
    );
  });

  it('просрочка входит в котировку целиком', () => {
    const loan = afterSixPayments();
    // Седьмой платёж наступил и не оплачен.
    const now = loan.periods[6].dueTs + DAY;
    const quote = quoteFull(loan, now);

    expect(quote.overdue).toBeGreaterThan(0n);
    expect(quote.total).toBe(
      quote.overdue +
        quote.currentInterest +
        quote.remainingPrincipal +
        quote.fee,
    );
  });
});

describe('окно частичного погашения', () => {
  const at = (loan: PrepayInput, now: number) => partialWindow(loan, now);

  it('открыто в сутки с даты платежа', () => {
    const loan = afterSixPayments();
    const due = loan.periods[5].dueTs;

    expect(at(loan, due).open).toBe(true);
    expect(at(loan, due + DAY - 1).open).toBe(true);
    expect(at(loan, due + DAY).block).toBe('NOT_PAYMENT_DATE');
  });

  it('до первого платежа закрыто', () => {
    expect(at(deal(), DEADLINE + DAY).block).toBe('NOT_PAYMENT_DATE');
  });

  it('на последнем платеже закрыто: там гасят целиком', () => {
    const periods = schedule().map((period) => ({
      ...period,
      principalPaid: period.principalAmount,
      interestPaid: period.interestAmount,
    }));
    const loan = deal({
      periods,
      nextPeriod: 12,
      lastAccrualTs: periods[11].dueTs,
    });
    expect(at(loan, periods[11].dueTs).block).toBe('LAST_PERIOD');
  });

  it('с просрочкой закрыто', () => {
    const loan = afterSixPayments();
    // Седьмой платёж наступил и не оплачен — сначала его.
    const now = loan.periods[6].dueTs;
    expect(at(loan, now).block).toBe('HAS_OVERDUE');
  });

  it('с авансом закрыто', () => {
    const loan = afterSixPayments();
    loan.periods[6] = { ...loan.periods[6], interestPaid: USDC };
    expect(at(loan, loan.periods[5].dueTs).block).toBe('HAS_ADVANCE');
  });

  it('купону закрыто всегда', () => {
    const loan = afterSixPayments();
    loan.scheduleType = 'coupon';
    expect(at(loan, loan.periods[5].dueTs).block).toBe('NOT_ALLOWED');
  });

  it('весь остаток погасить нельзя: это полное погашение', () => {
    const loan = afterSixPayments();
    const window = at(loan, loan.periods[5].dueTs);
    const balance = loan.periods
      .slice(6)
      .reduce((sum, period) => sum + period.principalAmount, 0n);
    expect(window.maxAmount).toBe(balance - 1n);
  });
});

describe('пересчёт графика', () => {
  it('уменьшает платежи, не трогая даты и их число', () => {
    const loan = afterSixPayments();
    const now = loan.periods[5].dueTs;
    const rest = loan.periods.slice(6);
    const before = rest.reduce((sum, p) => sum + p.principalAmount, 0n);

    const quote = quotePartial(loan, 20_000n * USDC, now);

    expect(quote.periods).toHaveLength(rest.length);
    expect(quote.periods.map((p) => p.dueTs)).toEqual(rest.map((p) => p.dueTs));
    const after = quote.periods.reduce((sum, p) => sum + p.principal, 0n);
    expect(after).toBe(before - 20_000n * USDC);
    // Эталон из тестов контракта: новый платёж ≈ 5 360,3.
    expect(Number(quote.periods[0].total) / 1e6).toBeCloseTo(5_360.3, 0);
  });

  it('комиссия берётся от суммы досрочного тела', () => {
    const loan = afterSixPayments();
    const quote = quotePartial(loan, 20_000n * USDC, loan.periods[5].dueTs);
    expect(quote.fee).toBe(200n * USDC);
    expect(quote.total).toBe(quote.due + quote.principal + quote.fee);
  });

  it('копейки от деления не теряются', () => {
    const loan = afterSixPayments();
    // Сумма, которая заведомо не делится нацело на шесть платежей.
    const quote = quotePartial(loan, usdc(10_000.01), loan.periods[5].dueTs);
    const before = loan.periods
      .slice(6)
      .reduce((sum, p) => sum + p.principalAmount, 0n);
    const after = quote.periods.reduce((sum, p) => sum + p.principal, 0n);
    expect(after).toBe(before - usdc(10_000.01));
  });

  it('показывает, сколько процентов заёмщик не заплатит', () => {
    const loan = afterSixPayments();
    const quote = quotePartial(loan, 20_000n * USDC, loan.periods[5].dueTs);
    const before = loan.periods
      .slice(6)
      .reduce((sum, p) => sum + p.interestAmount, 0n);
    const after = quote.periods.reduce((sum, p) => sum + p.interest, 0n);
    expect(quote.saved).toBe(before - after);
    expect(quote.saved).toBeGreaterThan(0n);
  });

  it('сегодняшний платёж проводится первым и входит в сумму перевода', () => {
    const loan = afterSixPayments();
    // Дата седьмого платежа: он причитается и должен войти в перевод.
    const today = loan.periods[6].dueTs;
    const payment =
      loan.periods[6].principalAmount + loan.periods[6].interestAmount;

    const quote = quotePartial(loan, 20_000n * USDC, today);
    expect(quote.due).toBe(payment);
    expect(quote.total).toBe(payment + 20_000n * USDC + 200n * USDC);
  });
});
