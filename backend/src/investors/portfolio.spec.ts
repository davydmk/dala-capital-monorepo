import { describe, expect, it } from 'vitest';
import { pendingPayout, SCALE, type PositionState } from './payout.js';
import {
  nextPaymentShare,
  portfolioTotals,
  withdrawnSoFar,
  type SchedulePeriod,
} from './portfolio.js';

const USDC = 1_000_000n;
const DAY = 86_400;
const START = 1_800_000_000;

const position = (overrides: Partial<PositionState> = {}): PositionState => ({
  principal: 100n * USDC,
  checkpointPrincipal: 0n,
  checkpointInterest: 0n,
  checkpointPenalty: 0n,
  checkpointPrepaymentFee: 0n,
  ...overrides,
});

/** Аккумулятор после раздачи суммы `amount` на собранные `raised`. */
const acc = (amount: bigint, raised: bigint) => (amount * SCALE) / raised;

const period = (overrides: Partial<SchedulePeriod> = {}): SchedulePeriod => ({
  dueTs: START + 30 * DAY,
  principalAmount: 500n * USDC,
  interestAmount: 50n * USDC,
  ...overrides,
});

const deal = (
  overrides: Partial<Parameters<typeof nextPaymentShare>[0]> = {},
) => ({
  state: 'active',
  totalRaised: 1_000n * USDC,
  periods: [period()],
  ...overrides,
});

describe('сколько уже получено', () => {
  it('у нетронутой позиции — ноль', () => {
    expect(withdrawnSoFar(position()).total).toBe(0n);
  });

  it('после вывода равно тому, что было доступно', () => {
    const raised = 1_000n * USDC;
    const accumulators = {
      accPrincipal: acc(200n * USDC, raised),
      accInterest: acc(30n * USDC, raised),
      accPenalty: 0n,
      accPrepaymentFee: 0n,
    };
    const before = position();
    const payout = pendingPayout(before, accumulators);

    // Контракт сдвигает чекпоинты до аккумуляторов и переводит ровно `payout`.
    const after = position({
      checkpointPrincipal: accumulators.accPrincipal,
      checkpointInterest: accumulators.accInterest,
    });
    const withdrawn = withdrawnSoFar(after);

    expect(withdrawn.total).toBe(payout.total);
    expect(withdrawn.principal).toBe(payout.principal);
    expect(withdrawn.interest).toBe(payout.interest);
    expect(pendingPayout(after, accumulators).total).toBe(0n);
  });

  it('усекает вниз так же, как раздача контракта', () => {
    // Доля, которая не делится нацело: копейки должны теряться одинаково.
    const checkpoint = acc(1n, 3n);
    const withdrawn = withdrawnSoFar(
      position({ principal: 7n, checkpointPrincipal: checkpoint }),
    );
    expect(withdrawn.principal).toBe((7n * checkpoint) / SCALE);
    expect(withdrawn.principal).toBe(2n);
  });
});

describe('следующий платёж', () => {
  it('доля инвестора пропорциональна взносу', () => {
    const next = nextPaymentShare(deal(), 250n * USDC, START);
    expect(next?.index).toBe(1);
    expect(next?.total).toBe(550n * USDC);
    // Четверть кампании — четверть платежа.
    expect(next?.yours).toBe(137_500_000n);
  });

  it('пропускает платежи, дата которых уже прошла', () => {
    const loan = deal({
      periods: [
        period({ dueTs: START + 30 * DAY }),
        period({ dueTs: START + 60 * DAY, interestAmount: 20n * USDC }),
      ],
    });
    const next = nextPaymentShare(loan, 1_000n * USDC, START + 40 * DAY);
    expect(next?.index).toBe(2);
    expect(next?.total).toBe(520n * USDC);
  });

  it('когда график кончился, платежа нет', () => {
    expect(nextPaymentShare(deal(), 100n * USDC, START + 100 * DAY)).toBeNull();
  });

  it('пока заём не выдан, платежа нет', () => {
    for (const state of ['funding', 'failed', 'repaid']) {
      expect(nextPaymentShare(deal({ state }), 100n * USDC, START)).toBeNull();
    }
  });
});

describe('итоги портфеля', () => {
  it('складываются по строкам, завершённые не считаются действующими', () => {
    const totals = portfolioTotals([
      {
        invested: 100n * USDC,
        received: 20n * USDC,
        available: 5n * USDC,
        finished: false,
      },
      {
        invested: 50n * USDC,
        received: 50n * USDC,
        available: 0n,
        finished: true,
      },
    ]);
    expect(totals.invested).toBe(150n * USDC);
    expect(totals.received).toBe(70n * USDC);
    expect(totals.available).toBe(5n * USDC);
    expect(totals.activeCount).toBe(1);
  });

  it('пустой портфель даёт нули', () => {
    expect(portfolioTotals([])).toEqual({
      invested: 0n,
      received: 0n,
      available: 0n,
      activeCount: 0,
    });
  });
});
