/**
 * Контракт отказывает кодами вроде `BelowMinTicket` — человеку они ничего не
 * говорят. Здесь они превращаются в объяснение и в подсказку, что делать:
 * ждать доплаты, забрать остаток или просто ничего не делать.
 */

export type DepositAction = 'wait' | 'withdraw' | 'none';

export interface DepositBlock {
  /** Код контракта; для разбора в поддержке. */
  code: string;
  reason: string;
  action: DepositAction;
}

const BLOCKS: Record<string, Omit<DepositBlock, 'code'>> = {
  BelowMinTicket: {
    reason:
      'На адресе меньше минимального взноса. Доплатите до минимума или заберите деньги обратно',
    action: 'wait',
  },
  NoCapacity: {
    reason: 'Сбор уже заполнен: зачислить больше нечего. Заберите остаток',
    action: 'withdraw',
  },
  FundingNotStarted: {
    reason: 'Сбор ещё не начался. Деньги дождутся старта на вашем адресе',
    action: 'wait',
  },
  FundingClosed: {
    reason:
      'Сбор закрыт, взносы больше не принимаются. Заберите деньги обратно',
    action: 'withdraw',
  },
  InvalidDealState: {
    reason: 'Кампания больше не принимает взносы. Заберите деньги обратно',
    action: 'withdraw',
  },
  ScheduleNotFinalized: {
    reason: 'Кампания опубликована не до конца — обратитесь в платформу',
    action: 'none',
  },
  NothingToProcess: {
    reason: 'Зачислять нечего: перевод уже учтён',
    action: 'none',
  },
  NothingReceived: {
    reason: 'Перевод не изменил остаток счёта. Обновите страницу',
    action: 'none',
  },
  NothingToWithdraw: {
    reason: 'На адресе пусто: забирать нечего',
    action: 'none',
  },
  WhitelistDisabled: {
    reason:
      'Вывод закрыт: идёт проверка данных или не прошли 48 часов после смены адреса',
    action: 'none',
  },
  WrongMint: {
    reason:
      'На адрес пришёл не тот токен, который принимает кампания. Напишите в платформу',
    action: 'none',
  },
  Unauthorized: {
    reason: 'Платформа не смогла подписать операцию. Мы уже разбираемся',
    action: 'none',
  },
  FundingStillOpen: {
    reason: 'Сбор ещё идёт: закрыть его можно после дедлайна',
    action: 'wait',
  },
  CancelGracePeriodActive: {
    reason: 'Отменить кампанию можно только после льготного срока',
    action: 'wait',
  },
  PrepaymentNotAllowed: {
    reason: 'Условия этого займа не предусматривают досрочного погашения',
    action: 'none',
  },
  NotPaymentDate: {
    reason:
      'Частично погасить тело можно только в сутки с даты платежа. Дождитесь ближайшей даты',
    action: 'wait',
  },
  HasOverdue: {
    reason:
      'Сначала нужно закрыть просрочку и пеню обычным платежом, а потом гасить тело досрочно',
    action: 'none',
  },
  HasAdvance: {
    reason:
      'По займу есть аванс в счёт будущих платежей: пока он не зачтён графиком, частичное погашение недоступно',
    action: 'none',
  },
  InvalidPrepaymentAmount: {
    reason:
      'Такую сумму досрочно погасить нельзя: она должна быть больше нуля и меньше остатка тела',
    action: 'none',
  },
  NotMultipleOfFace: {
    reason:
      'Облигация продаётся лотами по номиналу: сумма на адресе должна делиться на номинал бумаги нацело. Доплатите до следующего лота или заберите остаток',
    action: 'wait',
  },
  InsufficientRepayBalance: {
    reason:
      'На адресе погашения меньше, чем нужно: досрочное погашение проводится целиком. Доплатите и повторите',
    action: 'wait',
  },
};

/**
 * Микроединицы в сумму для человека: при шести знаках «25500000» → «25,50».
 * В объяснениях инвестору суммы должны читаться так же, как на экране, —
 * сырые микроединицы в тексте он прочесть не может.
 */
export function formatAmount(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const unit = 10n ** BigInt(decimals);
  const fraction = (value % unit).toString().padStart(decimals, '0');
  return `${value / unit},${fraction.slice(0, 2)}`;
}

/** Достаёт код ошибки из того, что бросил Anchor. */
export function errorCode(error: unknown): string | null {
  const anchor = error as {
    error?: { errorCode?: { code?: string } };
    errorCode?: { code?: string };
  };
  return anchor?.error?.errorCode?.code ?? anchor?.errorCode?.code ?? null;
}

/**
 * Почему зачислить не вышло. Незнакомый код не выдаём за понятную причину:
 * честнее сказать, что операция не прошла, чем показать не то.
 */
export function explainFailure(error: unknown): DepositBlock {
  const code = errorCode(error);
  const known = code ? BLOCKS[code] : undefined;
  if (known) return { code: code as string, ...known };
  return {
    code: code ?? 'Unknown',
    reason: 'Операция не прошла. Попробуйте позже или напишите в платформу',
    action: 'none',
  };
}

/** Сколько контракт зачислит прямо сейчас: столько же считает и сам invest. */
export function creditable(input: {
  pending: bigint;
  principal: bigint;
  hardCap: bigint;
  totalRaised: bigint;
  maxTicket: bigint;
}): bigint {
  const room = input.hardCap - input.totalRaised;
  // maxTicket = 0 означает «ограничения на размер взноса нет».
  const ticketRoom =
    input.maxTicket === 0n ? input.pending : input.maxTicket - input.principal;
  const fill = [input.pending, room, ticketRoom].reduce((a, b) =>
    a < b ? a : b,
  );
  return fill > 0n ? fill : 0n;
}

/**
 * Что мешает зачислить деньги, лежащие на адресе. Считаем теми же правилами,
 * что и контракт, — чтобы объяснить причину до отправки транзакции, а не
 * тратить её впустую. Возвращает null, когда зачислять можно или нечего.
 */
export function whyBlocked(input: {
  dealState: string;
  fundingStart: number;
  fundingDeadline: number;
  hardCap: bigint;
  totalRaised: bigint;
  minTicket: bigint;
  maxTicket: bigint;
  pending: bigint;
  principal: bigint;
  /** Номинал бумаги у облигации: взнос обязан быть кратен ему. */
  faceValue?: bigint;
  now?: number;
}): DepositBlock | null {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const block = (code: string): DepositBlock => ({ code, ...BLOCKS[code] });

  if (input.dealState !== 'funding') return block('InvalidDealState');
  if (input.pending === 0n) return null;
  if (now < input.fundingStart) return block('FundingNotStarted');
  if (now >= input.fundingDeadline) return block('FundingClosed');
  if (input.principal === 0n && input.pending < input.minTicket) {
    return block('BelowMinTicket');
  }
  // У облигации взнос — целое число бумаг. Иначе доля инвестора и число
  // бумаг на руках разойдутся, и бумага перестанет отражать его право.
  if (input.faceValue && input.faceValue > 0n) {
    const fits = creditable(input);
    if (fits % input.faceValue !== 0n) return block('NotMultipleOfFace');
  }
  return creditable(input) === 0n ? block('NoCapacity') : null;
}
