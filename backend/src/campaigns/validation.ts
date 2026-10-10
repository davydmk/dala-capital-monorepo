import {
  BorrowerStatus,
  ScheduleKind,
  type Borrower,
  type Campaign,
} from '@prisma/client';

/** Контракт принимает только эти значения: см. `create_campaign`. */
export const ALLOWED_PERIODS_PER_YEAR = [1, 2, 4, 12];
export const MAX_PERIODS = 60;

export interface CampaignCheck {
  /** Короткий код для интерфейса. */
  key: string;
  title: string;
  ok: boolean;
  /** Что не так и как исправить. */
  hint?: string;
}

type CampaignWithBorrower = Campaign & {
  borrower: Borrower & { wallets: { id: string; address: string }[] };
};

/**
 * Проверки перед публикацией. Те же условия проверяет контракт, но узнать о них
 * до отправки дешевле: транзакция стоит SOL, а сообщение контракта не объясняет,
 * что именно поправить.
 */
export function checkCampaign(
  campaign: CampaignWithBorrower,
  context: { mintAllowed: boolean; now?: Date },
): CampaignCheck[] {
  const now = context.now ?? new Date();
  const checks: CampaignCheck[] = [];
  const add = (key: string, title: string, ok: boolean, hint?: string) =>
    checks.push({ key, title, ok, hint: ok ? undefined : hint });

  add(
    'borrower',
    'Заёмщик допущен к кампаниям',
    campaign.borrower.status === BorrowerStatus.APPROVED,
    'Переведите карточку заёмщика в статус «Допущен»',
  );

  const wallet = campaign.borrower.wallets.find(
    (item) => item.id === campaign.walletId,
  );
  add(
    'wallet',
    'Выбран кошелёк для получения займа',
    Boolean(wallet),
    'Выберите один из кошельков заёмщика; если их нет — добавьте в карточке',
  );

  add(
    'mint',
    'Расчётный токен выбран и разрешён',
    Boolean(campaign.mint) && context.mintAllowed,
    'Разрешите токен в настройках платформы: контракт принимает только их',
  );

  const soft = campaign.softCap ?? 0n;
  const hard = campaign.hardCap ?? 0n;
  const minTicket = campaign.minTicket ?? 0n;
  add(
    'caps',
    'Минимум сбора не больше максимума',
    soft > 0n && hard > 0n && soft <= hard,
    'Укажите минимальную и максимальную сумму сбора: минимум не может быть больше максимума',
  );
  add(
    'ticket',
    'Минимальный взнос не больше минимума сбора',
    minTicket > 0n && minTicket <= soft,
    'Минимальный взнос должен быть меньше минимальной суммы сбора',
  );
  add(
    'maxTicket',
    'Максимальный взнос задан верно',
    campaign.maxTicket === 0n || campaign.maxTicket >= minTicket,
    'Максимальный взнос должен быть не меньше минимального; 0 — без ограничения',
  );

  add(
    'rate',
    'Ставка указана',
    Boolean(campaign.annualRateBps && campaign.annualRateBps > 0),
    'Годовая ставка должна быть больше нуля',
  );
  add(
    'periodsPerYear',
    'Периодичность начисления допустима',
    ALLOWED_PERIODS_PER_YEAR.includes(campaign.periodsPerYear),
    'Контракт принимает 1, 2, 4 или 12 периодов в году',
  );
  add(
    'periodCount',
    'Число платежей от 1 до 60',
    Boolean(
      campaign.periodCount &&
      campaign.periodCount >= 1 &&
      campaign.periodCount <= MAX_PERIODS,
    ),
    `В графике не больше ${MAX_PERIODS} платежей — таков размер аккаунта в контракте`,
  );

  // Метаданные уходят в минт при публикации и после неё не меняются.
  if (campaign.scheduleKind === ScheduleKind.COUPON) {
    add(
      'bondMetadata',
      'У бумаги есть название и тикер',
      Boolean(campaign.bondName?.trim() && campaign.bondSymbol?.trim()),
      'Заполните название и тикер бумаги: они уходят в метаданные минта при публикации и после неё не меняются',
    );
  }

  const start = campaign.fundingStart;
  const deadline = campaign.fundingDeadline;
  const firstDue = campaign.firstDueAt;
  add(
    'window',
    'Сбор начинается раньше дедлайна',
    Boolean(start && deadline && start < deadline),
    'Дедлайн сбора должен быть позже его начала',
  );
  add(
    'deadline',
    'Дедлайн сбора ещё не прошёл',
    Boolean(deadline && deadline > now),
    'Дедлайн в прошлом: кампания закроется сразу после публикации',
  );
  add(
    'firstDue',
    'Первый платёж позже дедлайна сбора',
    Boolean(firstDue && deadline && firstDue > deadline),
    'Контракт требует, чтобы график начинался после окончания сбора',
  );

  return checks;
}

export const allChecksPassed = (checks: CampaignCheck[]) =>
  checks.every((check) => check.ok);

/** Первая непройденная проверка — её и показываем в ошибке публикации. */
export const firstFailure = (checks: CampaignCheck[]) =>
  checks.find((check) => !check.ok);
