/**
 * Досрочное погашение: сколько нужно перевести и что станет с графиком.
 *
 * Котировку заёмщик должен увидеть **до** перевода, а read-only инструкции у
 * контракта нет — расчёты повторены отсюда один в один с `quote_full_prepayment`
 * и `apply_partial_prepayment` из
 * `programs/dala_capital/src/state/accounting.rs`, поверх того же начисления,
 * что и в [debt.ts](./debt.ts).
 *
 * Контракт тянет с адреса погашения **ровно** посчитанную сумму и отказывает,
 * если её там нет. Поэтому цифра отсюда — не справка, а то, что заёмщик обязан
 * перевести, и расходиться с контрактом ей нельзя.
 */

import {
  ACCRUAL_DENOMINATOR,
  accrue,
  amountDue,
  type DebtInput,
} from './debt.js';

const BPS = 10_000n;
const SECONDS_PER_DAY = 86_400;

/** Всё, что нужно знать о займе для досрочного погашения. */
export interface PrepayInput extends DebtInput {
  /** Аннуитет или купон: купону контракт досрочное погашение запрещает. */
  scheduleType: string;
  fundingDeadline: number;
  prepaymentFeeBps: number;
  periodsPerYear: number;
}

/** Котировка полного досрочного погашения. */
export interface FullQuote {
  /** Просроченные проценты, тело и пеня. */
  overdue: bigint;
  /** Проценты текущего периода за фактическое время, за вычетом аванса. */
  currentInterest: bigint;
  /** Тело ещё не наступивших платежей. */
  remainingPrincipal: bigint;
  fee: bigint;
  total: bigint;
}

/**
 * Купон досрочно не гасится: у него всё тело в последнем платеже, и пересчёт
 * процентов теряет смысл. Так решено в контракте, интерфейс это повторяет.
 */
export function prepaymentAllowed(deal: { scheduleType: string }): boolean {
  return deal.scheduleType.toLowerCase() === 'annuity';
}

/**
 * Сколько нужно перевести, чтобы закрыть заём целиком прямо сейчас.
 *
 * Проценты текущего периода считаются за **фактическое** время с прошлого
 * платежа, а не за весь период: в этом и смысл досрочного погашения. Уже
 * внесённое вперёд вычитается.
 */
export function quoteFull(deal: PrepayInput, now: number): FullQuote {
  const state = accrue(deal, now);
  const next = state.nextPeriod;

  const overdue =
    state.overdueScheduledInterest +
    state.extraInterest +
    state.overduePrincipal +
    state.penalty;

  let remainingPrincipal = 0n;
  let prepaidInterest = 0n;
  for (const period of deal.periods.slice(next)) {
    remainingPrincipal += period.principalAmount - period.principalPaid;
    prepaidInterest += period.interestPaid;
  }

  const periodStart =
    next === 0 ? deal.fundingDeadline : deal.periods[next - 1].dueTs;
  const elapsed = BigInt(Math.max(now - periodStart, 0));
  const accrued =
    (remainingPrincipal * BigInt(deal.annualRateBps) * elapsed) /
    ACCRUAL_DENOMINATOR;
  const currentInterest =
    accrued > prepaidInterest ? accrued - prepaidInterest : 0n;

  const fee = (remainingPrincipal * BigInt(deal.prepaymentFeeBps)) / BPS;

  return {
    overdue,
    currentInterest,
    remainingPrincipal,
    fee,
    total: overdue + currentInterest + remainingPrincipal + fee,
  };
}

/** Почему частичное досрочное погашение сейчас недоступно. */
export type PartialBlock =
  | 'NOT_ALLOWED'
  | 'NOT_ACTIVE'
  | 'NOT_PAYMENT_DATE'
  | 'HAS_OVERDUE'
  | 'HAS_ADVANCE'
  | 'LAST_PERIOD';

export interface PartialWindow {
  open: boolean;
  block: PartialBlock | null;
  /** Когда окно откроется снова: дата ближайшего платежа. */
  opensAt: number | null;
  /** Докуда открыто сейчас: сутки с даты платежа. */
  closesAt: number | null;
  /** Наибольшая сумма тела, которую можно погасить: весь остаток минус копейка. */
  maxAmount: bigint;
}

/**
 * Открыто ли окно частичного погашения. Контракт пускает только в сутки с даты
 * платежа и только между первым и последним: до первого платежа график ещё не
 * начался, а на последнем уменьшать нечего — там гасят целиком.
 */
export function partialWindow(deal: PrepayInput, now: number): PartialWindow {
  const closed = (
    block: PartialBlock,
    extra: Partial<PartialWindow> = {},
  ): PartialWindow => ({
    open: false,
    block,
    opensAt: null,
    closesAt: null,
    maxAmount: 0n,
    ...extra,
  });

  if (!prepaymentAllowed(deal)) return closed('NOT_ALLOWED');
  if (deal.state !== 'active') return closed('NOT_ACTIVE');

  const state = accrue(deal, now);
  const next = state.nextPeriod;
  const upcoming = deal.periods[next]?.dueTs ?? null;

  if (next < 1 || next >= deal.periods.length) {
    return closed(next < 1 ? 'NOT_PAYMENT_DATE' : 'LAST_PERIOD', {
      opensAt: upcoming,
    });
  }

  const paymentDate = deal.periods[next - 1].dueTs;
  const closesAt = paymentDate + SECONDS_PER_DAY;
  if (now < paymentDate || now >= closesAt) {
    return closed('NOT_PAYMENT_DATE', { opensAt: upcoming });
  }

  // Просрочку нужно закрыть обычным платежом, аванс — помеха пересчёту.
  const due = amountDue(deal, now);
  if (due.total > 0n) {
    return closed('HAS_OVERDUE', { opensAt: upcoming, closesAt });
  }

  let balance = 0n;
  for (const period of deal.periods.slice(next)) {
    if (period.principalPaid > 0n || period.interestPaid > 0n) {
      return closed('HAS_ADVANCE', { opensAt: upcoming, closesAt });
    }
    balance += period.principalAmount;
  }

  return {
    open: balance > 1n,
    block: balance > 1n ? null : 'LAST_PERIOD',
    opensAt: upcoming,
    closesAt,
    // Контракт требует amount < balance: весь остаток гасится полным погашением.
    maxAmount: balance > 0n ? balance - 1n : 0n,
  };
}

/** Платёж в предпросмотре нового графика. */
export interface PreviewPeriod {
  index: number;
  dueTs: number;
  principal: bigint;
  interest: bigint;
  total: bigint;
  /** Каким платёж был до досрочного погашения. */
  was: bigint;
}

export interface PartialQuote {
  /** Причитающееся на сегодня: контракт проводит его первым. */
  due: bigint;
  /** Тело, которое гасится досрочно. */
  principal: bigint;
  fee: bigint;
  /** Сколько всего нужно иметь на адресе погашения. */
  total: bigint;
  /** Каким станет график после пересчёта. */
  periods: PreviewPeriod[];
  /** Сколько процентов заёмщик не заплатит благодаря этому погашению. */
  saved: bigint;
}

/**
 * Что будет, если погасить `amount` тела прямо сейчас. Тело оставшихся
 * платежей уменьшается пропорционально, проценты пересчитываются от нового
 * остатка — даты и число платежей не меняются.
 */
export function quotePartial(
  deal: PrepayInput,
  amount: bigint,
  now: number,
): PartialQuote {
  const state = accrue(deal, now);
  const next = state.nextPeriod;
  const rest = deal.periods.slice(next);

  const balance = rest.reduce(
    (sum, period) => sum + period.principalAmount,
    0n,
  );
  const fee = (amount * BigInt(deal.prepaymentFeeBps)) / BPS;
  const due = amountDue(deal, now).total;

  const newBalance = balance > amount ? balance - amount : 0n;
  const denominator = BigInt(10_000 * deal.periodsPerYear);

  // Пропорция тела — как в контракте; последний платёж добирает остаток,
  // чтобы копейки от деления не потерялись.
  const principals: bigint[] = [];
  let assigned = 0n;
  rest.forEach((period, index) => {
    const value =
      index + 1 === rest.length || balance === 0n
        ? newBalance - assigned
        : (period.principalAmount * newBalance) / balance;
    assigned += value;
    principals.push(value);
  });

  let left = newBalance;
  const periods: PreviewPeriod[] = rest.map((period, index) => {
    const interest = (left * BigInt(deal.annualRateBps)) / denominator;
    const principal = principals[index];
    left -= principal;
    return {
      index: next + index + 1,
      dueTs: period.dueTs,
      principal,
      interest,
      total: principal + interest,
      was: period.principalAmount + period.interestAmount,
    };
  });

  const before = rest.reduce((sum, period) => sum + period.interestAmount, 0n);
  const after = periods.reduce((sum, period) => sum + period.interest, 0n);

  return {
    due,
    principal: amount,
    fee,
    total: due + amount + fee,
    periods,
    saved: before > after ? before - after : 0n,
  };
}
