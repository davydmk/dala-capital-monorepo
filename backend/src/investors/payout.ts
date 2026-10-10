/**
 * Сколько инвестору причитается из кампании. Контракт раздаёт деньги через
 * аккумуляторы: при распределении суммы `acc += a × SCALE / total_raised`,
 * а позиции доступно `floor(principal × (acc − checkpoint) / SCALE)` по каждой
 * из четырёх статей. Повторяем это один в один с `Position::pending_payout`
 * из `programs/dala_capital/src/state/position.rs`: деление bigint в JS
 * усекает вниз так же, как `floor` в Rust.
 */

export const SCALE = 1_000_000_000_000n;

export interface PayoutParts {
  principal: bigint;
  interest: bigint;
  penalty: bigint;
  prepaymentFee: bigint;
  total: bigint;
}

export interface PositionState {
  principal: bigint;
  checkpointPrincipal: bigint;
  checkpointInterest: bigint;
  checkpointPenalty: bigint;
  checkpointPrepaymentFee: bigint;
}

export interface DealAccumulators {
  accPrincipal: bigint;
  accInterest: bigint;
  accPenalty: bigint;
  accPrepaymentFee: bigint;
}

const part = (principal: bigint, acc: bigint, checkpoint: bigint): bigint =>
  acc > checkpoint ? (principal * (acc - checkpoint)) / SCALE : 0n;

export function pendingPayout(
  position: PositionState,
  deal: DealAccumulators,
): PayoutParts {
  const principal = part(
    position.principal,
    deal.accPrincipal,
    position.checkpointPrincipal,
  );
  const interest = part(
    position.principal,
    deal.accInterest,
    position.checkpointInterest,
  );
  const penalty = part(
    position.principal,
    deal.accPenalty,
    position.checkpointPenalty,
  );
  const prepaymentFee = part(
    position.principal,
    deal.accPrepaymentFee,
    position.checkpointPrepaymentFee,
  );
  return {
    principal,
    interest,
    penalty,
    prepaymentFee,
    total: principal + interest + penalty + prepaymentFee,
  };
}

export interface InvestorSummary {
  count: number;
  total: bigint;
  average: bigint;
  /** Крупнейшая доля в сотых долях процента: 2500 — это 25%. */
  largestShareBps: number;
}

/** Состав инвесторов кампании: сводка по позициям из блокчейна. */
export function investorSummary(principals: bigint[]): InvestorSummary {
  const positions = principals.filter((amount) => amount > 0n);
  if (positions.length === 0) {
    return { count: 0, total: 0n, average: 0n, largestShareBps: 0 };
  }

  const total = positions.reduce((sum, amount) => sum + amount, 0n);
  const largest = positions.reduce((max, amount) =>
    amount > max ? amount : max,
  );
  return {
    count: positions.length,
    total,
    average: total / BigInt(positions.length),
    largestShareBps: Number((largest * 10_000n) / total),
  };
}

/** Доля позиции в кампании, в сотых долях процента. */
export const shareBps = (principal: bigint, total: bigint): number =>
  total > 0n ? Number((principal * 10_000n) / total) : 0;
