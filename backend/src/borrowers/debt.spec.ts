import { describe, expect, it } from 'vitest';
import {
  ACCRUAL_DENOMINATOR,
  accrue,
  amountDue,
  defaultDebt,
  recoveryOutstanding,
  daysPastDue,
  markedSchedule,
  nextPayment,
  outstandingPrincipal,
  totalOutstanding,
  type DebtInput,
  type DebtPeriod,
} from './debt.js';

const USDC = 1_000_000n;
const DAY = 86_400;
/** Дата закрытия сбора: с неё в контракте начинается отсчёт. */
const START = 1_800_000_000;

const period = (overrides: Partial<DebtPeriod> = {}): DebtPeriod => ({
  dueTs: START + 30 * DAY,
  principalAmount: 1_000n * USDC,
  interestAmount: 100n * USDC,
  principalPaid: 0n,
  interestPaid: 0n,
  ...overrides,
});

const deal = (overrides: Partial<DebtInput> = {}): DebtInput => ({
  state: 'active',
  nextPeriod: 0,
  periods: [period()],
  overduePrincipal: 0n,
  overdueScheduledInterest: 0n,
  extraInterest: 0n,
  penalty: 0n,
  defaultPrincipal: 0n,
  defaultInterest: 0n,
  interestCarry: 0n,
  penaltyCarry: 0n,
  lastAccrualTs: START,
  annualRateBps: 1_000,
  penaltyRateBps: 2_000,
  ...overrides,
});

/** Начисление за `days` дней по ACT/360 — так же, как в тестах контракта. */
const perDay = (base: bigint, bps: number, days: number) =>
  (base * BigInt(bps) * BigInt(days)) / (10_000n * 360n);

describe('перенос наступивших платежей в просрочку', () => {
  it('до даты платежа не начисляется ничего', () => {
    const state = accrue(deal(), START + 29 * DAY);
    expect(state.nextPeriod).toBe(0);
    expect(state.overduePrincipal).toBe(0n);
    expect(state.penalty).toBe(0n);
  });

  it('в дату платежа он переходит в просрочку целиком', () => {
    const state = accrue(deal(), START + 30 * DAY);
    expect(state.nextPeriod).toBe(1);
    expect(state.overduePrincipal).toBe(1_000n * USDC);
    expect(state.overdueScheduledInterest).toBe(100n * USDC);
    // Пеня начисляется на просрочку, а в момент её появления просрочки ещё нет.
    expect(state.penalty).toBe(0n);
    expect(state.extraInterest).toBe(0n);
  });

  it('уже оплаченная часть платежа в просрочку не попадает', () => {
    const state = accrue(
      deal({
        periods: [
          period({ principalPaid: 400n * USDC, interestPaid: 100n * USDC }),
        ],
      }),
      START + 30 * DAY,
    );
    expect(state.overduePrincipal).toBe(600n * USDC);
    expect(state.overdueScheduledInterest).toBe(0n);
  });

  it('несколько просроченных платежей складываются', () => {
    const state = accrue(
      deal({
        periods: [
          period({ dueTs: START + 30 * DAY }),
          period({ dueTs: START + 60 * DAY }),
          period({ dueTs: START + 90 * DAY }),
        ],
      }),
      START + 65 * DAY,
    );
    expect(state.nextPeriod).toBe(2);
    expect(state.overduePrincipal).toBe(2_000n * USDC);
  });
});

describe('проценты на просрочку и пеня', () => {
  /** Та же кампания, что в тестах контракта: 10% годовых, пеня 20%. */
  const overdue = 3_791_590_000n;
  const late = (days: number) =>
    accrue(
      deal({
        nextPeriod: 1,
        periods: [
          period({
            dueTs: START,
            principalAmount: overdue,
            interestAmount: 0n,
          }),
        ],
        overduePrincipal: overdue,
        lastAccrualTs: START,
      }),
      START + days * DAY,
    );

  it('за десять дней пеня и проценты совпадают с расчётом по ACT/360', () => {
    const state = late(10);
    expect(state.penalty).toBe(perDay(overdue, 2_000, 10));
    expect(state.extraInterest).toBe(perDay(overdue, 1_000, 10));
    // Контракт на этих же числах ждёт пеню около 21,06 USDC.
    expect(Number(state.penalty) / 1e6).toBeCloseTo(21.06, 2);
    expect(Number(state.extraInterest) / 1e6).toBeCloseTo(10.53, 2);
  });

  it('пеня идёт и на просроченные проценты, а на саму пеню — нет', () => {
    const base = 1_000n * USDC;
    const withInterest = accrue(
      deal({
        nextPeriod: 1,
        periods: [],
        overduePrincipal: base,
        overdueScheduledInterest: 100n * USDC,
        penaltyRateBps: 2_000,
        annualRateBps: 0,
      }),
      START + 10 * DAY,
    );
    expect(withInterest.penalty).toBe(perDay(base + 100n * USDC, 2_000, 10));

    // Пеня, накопленная раньше, базу следующего начисления не увеличивает.
    const withPenalty = accrue(
      deal({
        nextPeriod: 1,
        periods: [],
        overduePrincipal: base,
        penalty: 500n * USDC,
        annualRateBps: 0,
      }),
      START + 10 * DAY,
    );
    expect(withPenalty.penalty - 500n * USDC).toBe(perDay(base, 2_000, 10));
  });

  it('остаток от деления не теряется между начислениями', () => {
    // Ставка и сумма подобраны так, что за секунду начисляется меньше единицы.
    const small = deal({
      nextPeriod: 1,
      periods: [],
      overduePrincipal: USDC,
      annualRateBps: 1_000,
      penaltyRateBps: 0,
    });
    const once = accrue(small, START + 2);

    const first = accrue(small, START + 1);
    const second = accrue(
      { ...small, ...first, state: 'active', periods: [] },
      START + 2,
    );

    expect(first.extraInterest).toBe(0n);
    expect(first.interestCarry).toBeGreaterThan(0n);
    expect(second.extraInterest).toBe(once.extraInterest);
    expect(second.interestCarry).toBe(once.interestCarry);
  });

  it('знаменатель начисления — тот же, что в контракте', () => {
    expect(ACCRUAL_DENOMINATOR).toBe(311_040_000_000n);
  });

  it('в сборе и после погашения не начисляется ничего', () => {
    for (const state of ['funding', 'failed', 'repaid']) {
      const result = accrue(
        deal({ state, overduePrincipal: 1_000n * USDC }),
        START + 100 * DAY,
      );
      expect(result.penalty).toBe(0n);
      expect(result.nextPeriod).toBe(0);
    }
  });
});

describe('сумма к оплате', () => {
  it('до первого платежа платить нечего', () => {
    expect(amountDue(deal(), START + 10 * DAY).total).toBe(0n);
  });

  it('складывается из процентов, тела и пени', () => {
    const due = amountDue(deal(), START + 40 * DAY);
    expect(due.scheduledInterest).toBe(100n * USDC);
    expect(due.principal).toBe(1_000n * USDC);
    expect(due.extraInterest).toBe(perDay(1_000n * USDC, 1_000, 10));
    expect(due.total).toBe(
      due.scheduledInterest + due.extraInterest + due.principal + due.penalty,
    );
  });

  it('ненаступившие платежи в неё не входят, а в полный долг входят', () => {
    const loan = deal({
      periods: [
        period({ dueTs: START + 30 * DAY }),
        period({ dueTs: START + 60 * DAY }),
      ],
    });
    const now = START + 30 * DAY;
    expect(amountDue(loan, now).total).toBe(1_100n * USDC);
    expect(totalOutstanding(loan, now)).toBe(2_200n * USDC);
  });
});

describe('состояние займа', () => {
  it('остаток тела не учитывает проценты', () => {
    const loan = deal({
      periods: [
        period({ principalPaid: 1_000n * USDC, interestPaid: 100n * USDC }),
        period({ dueTs: START + 60 * DAY }),
      ],
    });
    expect(outstandingPrincipal(loan)).toBe(1_000n * USDC);
  });

  it('следующий платёж — первый, дата которого не наступила', () => {
    const loan = deal({
      periods: [
        period({ dueTs: START + 30 * DAY }),
        period({ dueTs: START + 60 * DAY, principalAmount: 2_000n * USDC }),
      ],
    });
    const next = nextPayment(loan, START + 40 * DAY);
    expect(next?.index).toBe(2);
    expect(next?.total).toBe(2_100n * USDC);
    expect(nextPayment(loan, START + 100 * DAY)).toBeNull();
  });

  it('пока заём не выдан, следующего платежа нет', () => {
    for (const state of ['funding', 'failed', 'repaid']) {
      expect(nextPayment(deal({ state }), START)).toBeNull();
    }
  });

  it('дни просрочки считаются от самого старого неоплаченного платежа', () => {
    const loan = deal({
      periods: [
        period({ dueTs: START + 30 * DAY }),
        period({ dueTs: START + 60 * DAY }),
      ],
    });
    expect(daysPastDue(loan, START + 30 * DAY)).toBe(0);
    expect(daysPastDue(loan, START + 45 * DAY)).toBe(15);
    // Оплаченные платежи просрочку не создают.
    const paid = deal({
      periods: [
        period({
          dueTs: START + 30 * DAY,
          principalPaid: 1_000n * USDC,
          interestPaid: 100n * USDC,
        }),
      ],
    });
    expect(daysPastDue(paid, START + 45 * DAY)).toBe(0);
  });

  it('график размечается по состоянию платежей', () => {
    const loan = deal({
      periods: [
        period({
          dueTs: START + 30 * DAY,
          principalPaid: 1_000n * USDC,
          interestPaid: 100n * USDC,
        }),
        period({ dueTs: START + 60 * DAY }),
        period({ dueTs: START + 90 * DAY }),
      ],
    });
    const marks = markedSchedule(loan, START + 61 * DAY, 3).map(
      (item) => item.status,
    );
    expect(marks).toEqual(['paid', 'due', 'upcoming']);

    const later = markedSchedule(loan, START + 70 * DAY, 3).map(
      (item) => item.status,
    );
    expect(later).toEqual(['paid', 'overdue', 'upcoming']);
  });

  it('пока сбор идёт, нулевые платежи не выдаются за оплаченные', () => {
    const collecting = deal({
      state: 'funding',
      periods: [
        {
          dueTs: START + 30 * DAY,
          principalAmount: 0n,
          interestAmount: 0n,
          principalPaid: 0n,
          interestPaid: 0n,
        },
      ],
    });
    expect(markedSchedule(collecting, START + 60 * DAY)[0].status).toBe(
      'upcoming',
    );
  });
});

describe('дефолт', () => {
  /** После `enter_default` весь остаток тела лежит в одном поле. */
  const defaulted = (overrides: Partial<DebtInput> = {}) =>
    deal({
      state: 'default',
      nextPeriod: 1,
      periods: [
        period({
          dueTs: START,
          principalPaid: 1_000n * USDC,
          interestPaid: 100n * USDC,
        }),
      ],
      overduePrincipal: 0n,
      overdueScheduledInterest: 0n,
      extraInterest: 0n,
      defaultPrincipal: 5_000n * USDC,
      defaultInterest: 200n * USDC,
      lastAccrualTs: START,
      ...overrides,
    });

  it('проценты идут на тело дефолта, а не на просрочку', () => {
    const state = accrue(defaulted(), START + 10 * DAY);
    expect(state.defaultInterest - 200n * USDC).toBe(
      perDay(5_000n * USDC, 1_000, 10),
    );
    // Поля обычной просрочки в дефолте не используются.
    expect(state.extraInterest).toBe(0n);
    expect(state.overduePrincipal).toBe(0n);
  });

  it('пеня идёт на тело вместе с процентами дефолта', () => {
    const state = accrue(defaulted(), START + 10 * DAY);
    expect(state.penalty).toBe(perDay(5_200n * USDC, 2_000, 10));
  });

  it('наступившие платежи в просрочку больше не переносятся', () => {
    const loan = defaulted({
      periods: [
        period({ dueTs: START - DAY }),
        period({ dueTs: START + 5 * DAY }),
      ],
    });
    const state = accrue(loan, START + 10 * DAY);
    expect(state.nextPeriod).toBe(1);
    expect(state.overduePrincipal).toBe(0n);
  });

  it('долг складывается из процентов, тела и пени', () => {
    const debt = defaultDebt(defaulted(), START);
    expect(debt.principal).toBe(5_000n * USDC);
    expect(debt.interest).toBe(200n * USDC);
    expect(debt.total).toBe(debt.principal + debt.interest + debt.penalty);
  });

  it('остаток тела берётся из поля дефолта, а не из графика', () => {
    expect(outstandingPrincipal(defaulted())).toBe(5_000n * USDC);
  });

  it('расходы на взыскание считаются отдельно от долга', () => {
    expect(
      recoveryOutstanding({
        recoveryCosts: 300n * USDC,
        recoveryReimbursed: 100n * USDC,
      }),
    ).toBe(200n * USDC);
    // Возместили больше записанного — в минус не уходим.
    expect(
      recoveryOutstanding({
        recoveryCosts: 100n * USDC,
        recoveryReimbursed: 100n * USDC,
      }),
    ).toBe(0n);
  });
});
