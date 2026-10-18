/**
 * Сколько заёмщик должен прямо сейчас.
 *
 * Поля долга в сделке верны на `last_accrual_ts` — момент последней денежной
 * транзакции. Дальше проценты на просрочку и пеня растут, но контракт об этом
 * не знает: инструкции «посчитай и верни» у него нет, начисление происходит
 * внутри платежа. Поэтому здесь повторён `Deal::accrue` из
 * `programs/dala_capital/src/state/accounting.rs`, один в один, включая перенос
 * остатка от деления: по этой цифре человек переводит деньги, и она не должна
 * расходиться с тем, что посчитает контракт.
 */

/** `BPS_DENOMINATOR × DAY_COUNT_BASIS × SECONDS_PER_DAY` — знаменатель ACT/360. */
export const ACCRUAL_DENOMINATOR = 10_000n * 360n * 86_400n;

const SECONDS_PER_DAY = 86_400;

/** Платёж графика: суммы появляются при закрытии сбора. */
export interface DebtPeriod {
  dueTs: number;
  principalAmount: bigint;
  interestAmount: bigint;
  principalPaid: bigint;
  interestPaid: bigint;
}

/** Состояние долга — ровно те поля сделки, от которых зависит начисление. */
export interface DebtInput {
  state: string;
  nextPeriod: number;
  periods: DebtPeriod[];
  overduePrincipal: bigint;
  overdueScheduledInterest: bigint;
  extraInterest: bigint;
  penalty: bigint;
  /** Весь неоплаченный остаток тела после дефолта. */
  defaultPrincipal: bigint;
  /** Неоплаченные проценты после дефолта, включая начисляемые. */
  defaultInterest: bigint;
  interestCarry: bigint;
  penaltyCarry: bigint;
  lastAccrualTs: number;
  annualRateBps: number;
  penaltyRateBps: number;
}

/** Долг, доведённый до заданного момента. */
export interface AccruedDebt {
  nextPeriod: number;
  overduePrincipal: bigint;
  overdueScheduledInterest: bigint;
  extraInterest: bigint;
  penalty: bigint;
  defaultPrincipal: bigint;
  defaultInterest: bigint;
  interestCarry: bigint;
  penaltyCarry: bigint;
  lastAccrualTs: number;
}

/** Из чего складывается сумма к оплате. */
export interface AmountDue {
  /** Проценты наступивших платежей по графику. */
  scheduledInterest: bigint;
  /** Проценты, начисленные на просроченное тело. */
  extraInterest: bigint;
  /** Тело наступивших платежей. */
  principal: bigint;
  penalty: bigint;
  total: bigint;
}

/**
 * Доводит учёт до `now`: переносит наступившие платежи в просрочку и начисляет
 * проценты с пенёй за фактическое время. Чужие состояния не трогает — в сборе
 * и после погашения начислять нечего.
 */
export function accrue(deal: DebtInput, now: number): AccruedDebt {
  const state: AccruedDebt = {
    nextPeriod: deal.nextPeriod,
    overduePrincipal: deal.overduePrincipal,
    overdueScheduledInterest: deal.overdueScheduledInterest,
    extraInterest: deal.extraInterest,
    penalty: deal.penalty,
    defaultPrincipal: deal.defaultPrincipal,
    defaultInterest: deal.defaultInterest,
    interestCarry: deal.interestCarry,
    penaltyCarry: deal.penaltyCarry,
    lastAccrualTs: deal.lastAccrualTs,
  };
  // В дефолте платежи в просрочку больше не переносятся — весь остаток уже
  // там, — но проценты с пенёй продолжают идти на него.
  if (deal.state === 'default') {
    if (now > state.lastAccrualTs) {
      interval(state, deal, now - state.lastAccrualTs);
      state.lastAccrualTs = now;
    }
    return state;
  }
  if (deal.state !== 'active') return state;

  while (state.nextPeriod < deal.periods.length) {
    const period = deal.periods[state.nextPeriod];
    if (period.dueTs > now) break;

    interval(state, deal, period.dueTs - state.lastAccrualTs);
    state.lastAccrualTs = Math.max(state.lastAccrualTs, period.dueTs);

    state.overduePrincipal += period.principalAmount - period.principalPaid;
    state.overdueScheduledInterest +=
      period.interestAmount - period.interestPaid;
    state.nextPeriod += 1;
  }

  if (now > state.lastAccrualTs) {
    interval(state, deal, now - state.lastAccrualTs);
    state.lastAccrualTs = now;
  }
  return state;
}

/**
 * Начисление за отрезок. Проценты идут по ставке займа на просроченное тело,
 * пеня — на просроченное тело и просроченные проценты, но не на саму пеню.
 * База пени берётся до начисления процентов: так считает контракт.
 *
 * В дефолте базы другие: весь остаток тела лежит в `default_principal`, а
 * начисленные проценты — в `default_interest`.
 */
function interval(state: AccruedDebt, deal: DebtInput, seconds: number): void {
  if (seconds <= 0) return;
  const time = BigInt(seconds);

  const defaulted = deal.state === 'default';
  const principalBase = defaulted
    ? state.defaultPrincipal
    : state.overduePrincipal;
  const interestBase = defaulted
    ? state.defaultInterest
    : state.overdueScheduledInterest + state.extraInterest;

  if (principalBase > 0n && deal.annualRateBps > 0) {
    const numerator =
      principalBase * BigInt(deal.annualRateBps) * time + state.interestCarry;
    const accrued = numerator / ACCRUAL_DENOMINATOR;
    if (defaulted) {
      state.defaultInterest += accrued;
    } else {
      state.extraInterest += accrued;
    }
    state.interestCarry = numerator % ACCRUAL_DENOMINATOR;
  }

  const penaltyBase = principalBase + interestBase;
  if (penaltyBase > 0n && deal.penaltyRateBps > 0) {
    const numerator =
      penaltyBase * BigInt(deal.penaltyRateBps) * time + state.penaltyCarry;
    state.penalty += numerator / ACCRUAL_DENOMINATOR;
    state.penaltyCarry = numerator % ACCRUAL_DENOMINATOR;
  }
}

/**
 * Сколько причитается прямо сейчас — то же, что считает `due_obligations`
 * после начисления. Ненаступившие платежи сюда не входят.
 *
 * В дефолте график отменён: ненаступившие проценты списаны, остаток тела
 * перенесён в `default_principal`, а поля просрочки обнулены. Складывать их
 * значило бы показать заёмщику одну пеню, поэтому здесь берутся дефолтные
 * статьи. Форма ответа та же: вызывающему знать про развилку незачем.
 */
export function amountDue(deal: DebtInput, now: number): AmountDue {
  const state = accrue(deal, now);
  if (deal.state === 'default') {
    return {
      scheduledInterest: state.defaultInterest,
      extraInterest: 0n,
      principal: state.defaultPrincipal,
      penalty: state.penalty,
      total: state.defaultInterest + state.defaultPrincipal + state.penalty,
    };
  }
  return {
    scheduledInterest: state.overdueScheduledInterest,
    extraInterest: state.extraInterest,
    principal: state.overduePrincipal,
    penalty: state.penalty,
    total:
      state.overdueScheduledInterest +
      state.extraInterest +
      state.overduePrincipal +
      state.penalty,
  };
}

/**
 * Долг в дефолте под именами взыскания: те же статьи, что отдаёт `amountDue`,
 * только названы так, как их показывает блок взыскания. Расходы на взыскание
 * сюда не входят — они идут в казну, а не держателям.
 */
export function defaultDebt(deal: DebtInput, now: number) {
  const due = amountDue(deal, now);
  return {
    interest: due.scheduledInterest,
    principal: due.principal,
    penalty: due.penalty,
    total: due.total,
  };
}

/**
 * Невозмещённые расходы на взыскание. Поступление в дефолте закрывает их
 * первыми и уводит прямо в казну, минуя волт: это деньги платформы,
 * а не инвесторов.
 */
export function recoveryOutstanding(deal: {
  recoveryCosts: bigint;
  recoveryReimbursed: bigint;
}): bigint {
  const left = deal.recoveryCosts - deal.recoveryReimbursed;
  return left > 0n ? left : 0n;
}

/** Неоплаченное тело займа: то, что заёмщик ещё должен вернуть. */
export function outstandingPrincipal(deal: DebtInput): bigint {
  if (deal.state === 'default') return deal.defaultPrincipal;
  return deal.periods.reduce(
    (sum, period) => sum + (period.principalAmount - period.principalPaid),
    0n,
  );
}

/**
 * Все оставшиеся обязательства, включая ненаступившие платежи, — столько
 * нужно перевести, чтобы закрыть заём целиком по графику.
 */
export function totalOutstanding(deal: DebtInput, now: number): bigint {
  const state = accrue(deal, now);
  let total = amountDue(deal, now).total;
  // В дефолте ненаступивших платежей больше нет: весь остаток уже в долге.
  if (deal.state === 'default') return total;
  for (const period of deal.periods.slice(state.nextPeriod)) {
    total += period.interestAmount - period.interestPaid;
    total += period.principalAmount - period.principalPaid;
  }
  return total;
}

/**
 * Ближайший платёж, дата которого ещё не наступила. Пока заём не выдан,
 * платежа нет: суммы графика контракт считает при закрытии сбора, а до тех
 * пор в нём нули — показывать «следующий платёж 0,00» было бы обманом.
 */
export function nextPayment(deal: DebtInput, now: number) {
  if (deal.state !== 'active') return null;
  const { nextPeriod } = accrue(deal, now);
  const period = deal.periods[nextPeriod];
  if (!period) return null;
  return {
    /** Номер с единицы: так его видит человек в графике. */
    index: nextPeriod + 1,
    dueTs: period.dueTs,
    principal: period.principalAmount - period.principalPaid,
    interest: period.interestAmount - period.interestPaid,
    total:
      period.principalAmount -
      period.principalPaid +
      (period.interestAmount - period.interestPaid),
  };
}

/** Дни с даты самого старого не полностью оплаченного наступившего платежа. */
export function daysPastDue(deal: DebtInput, now: number): number {
  const { nextPeriod } = accrue(deal, now);
  const overdue = deal.periods
    .slice(0, nextPeriod)
    .find(
      (period) =>
        period.interestPaid < period.interestAmount ||
        period.principalPaid < period.principalAmount,
    );
  if (!overdue) return 0;
  return Math.floor(Math.max(now - overdue.dueTs, 0) / SECONDS_PER_DAY);
}

/** Состояние платежа в графике, как его видит заёмщик. */
export type PeriodStatus = 'paid' | 'overdue' | 'due' | 'upcoming';

/**
 * График с отметками. «Наступил» отличается от «просрочен» порогом дефолта:
 * пока он не прошёл, заём считается обслуживаемым с опозданием, а не сорванным.
 */
export function markedSchedule(
  deal: DebtInput,
  now: number,
  gracePeriodDays = 0,
) {
  const { nextPeriod } = accrue(deal, now);
  // Пока заём не выдан, суммы платежей нулевые: контракт считает их при
  // закрытии сбора. Такой платёж не «оплачен», он ещё не наступил.
  const issued = deal.state !== 'funding' && deal.state !== 'failed';
  return deal.periods.map((period, index) => {
    const paid =
      issued &&
      period.principalPaid >= period.principalAmount &&
      period.interestPaid >= period.interestAmount;
    const matured = issued && index < nextPeriod;
    const late =
      matured && now - period.dueTs > gracePeriodDays * SECONDS_PER_DAY;
    const status: PeriodStatus = paid
      ? 'paid'
      : late
        ? 'overdue'
        : matured
          ? 'due'
          : 'upcoming';
    return {
      index: index + 1,
      dueTs: period.dueTs,
      principal: period.principalAmount,
      interest: period.interestAmount,
      total: period.principalAmount + period.interestAmount,
      paid: period.principalPaid + period.interestPaid,
      status,
    };
  });
}
