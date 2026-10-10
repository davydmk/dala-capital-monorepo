import { describe, expect, it } from 'vitest';
import {
  investorSummary,
  pendingPayout,
  SCALE,
  shareBps,
  type DealAccumulators,
  type PositionState,
} from './payout.js';

const USDC = 1_000_000n;

/** Позиция без выведенного: все чекпоинты на нуле. */
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

const deal = (overrides: Partial<DealAccumulators> = {}): DealAccumulators => ({
  accPrincipal: 0n,
  accInterest: 0n,
  accPenalty: 0n,
  accPrepaymentFee: 0n,
  ...overrides,
});

describe('сколько причитается позиции', () => {
  it('без распределений не причитается ничего', () => {
    expect(pendingPayout(position(), deal()).total).toBe(0n);
  });

  it('вся кампания у одного инвестора — ему и достаётся всё', () => {
    const raised = 100n * USDC;
    const payout = pendingPayout(
      position({ principal: raised }),
      deal({
        accPrincipal: acc(40n * USDC, raised),
        accInterest: acc(5n * USDC, raised),
      }),
    );
    expect(payout.principal).toBe(40n * USDC);
    expect(payout.interest).toBe(5n * USDC);
    expect(payout.total).toBe(45n * USDC);
  });

  it('половина кампании — половина раздачи', () => {
    const raised = 200n * USDC;
    const payout = pendingPayout(
      position({ principal: 100n * USDC }),
      deal({ accPrincipal: acc(40n * USDC, raised) }),
    );
    expect(payout.principal).toBe(20n * USDC);
  });

  it('считает четыре статьи раздельно и складывает их', () => {
    const raised = 100n * USDC;
    const payout = pendingPayout(
      position({ principal: raised }),
      deal({
        accPrincipal: acc(10n * USDC, raised),
        accInterest: acc(2n * USDC, raised),
        accPenalty: acc(3n * USDC, raised),
        accPrepaymentFee: acc(1n * USDC, raised),
      }),
    );
    expect([
      payout.principal,
      payout.interest,
      payout.penalty,
      payout.prepaymentFee,
    ]).toEqual([10n * USDC, 2n * USDC, 3n * USDC, 1n * USDC]);
    expect(payout.total).toBe(16n * USDC);
  });

  it('уже снятое не выдаётся второй раз', () => {
    const raised = 100n * USDC;
    const accPrincipal = acc(40n * USDC, raised);
    const payout = pendingPayout(
      position({ principal: raised, checkpointPrincipal: accPrincipal }),
      deal({ accPrincipal }),
    );
    expect(payout.total).toBe(0n);
  });

  it('после частичного снятия остаётся только новое', () => {
    const raised = 100n * USDC;
    const payout = pendingPayout(
      position({
        principal: raised,
        checkpointPrincipal: acc(40n * USDC, raised),
      }),
      deal({ accPrincipal: acc(60n * USDC, raised) }),
    );
    expect(payout.principal).toBe(20n * USDC);
  });

  it('округляет вниз, как контракт: копейка остаётся в волте', () => {
    // Раздали 1 на троих: каждому по трети, в целых единицах — ноль.
    const raised = 3n;
    const payout = pendingPayout(
      position({ principal: 1n }),
      deal({ accPrincipal: acc(1n, raised) }),
    );
    expect(payout.principal).toBe(0n);
  });

  it('пустая позиция не даёт ничего даже при больших раздачах', () => {
    const payout = pendingPayout(
      position({ principal: 0n }),
      deal({ accPrincipal: acc(1000n * USDC, 10n * USDC) }),
    );
    expect(payout.total).toBe(0n);
  });
});

describe('состав инвесторов', () => {
  it('считает количество, средний вклад и крупнейшую долю', () => {
    const summary = investorSummary([50n * USDC, 30n * USDC, 20n * USDC]);
    expect(summary.count).toBe(3);
    expect(summary.total).toBe(100n * USDC);
    expect(summary.average).toBe((100n * USDC) / 3n);
    expect(summary.largestShareBps).toBe(5000);
  });

  it('пустой список не делит на ноль', () => {
    expect(investorSummary([])).toEqual({
      count: 0,
      total: 0n,
      average: 0n,
      largestShareBps: 0,
    });
  });

  it('позиции с нулём не считаются инвесторами', () => {
    expect(investorSummary([0n, 10n * USDC]).count).toBe(1);
  });

  it('доля позиции — в сотых долях процента', () => {
    expect(shareBps(25n * USDC, 100n * USDC)).toBe(2500);
    expect(shareBps(1n * USDC, 0n)).toBe(0);
  });
});
