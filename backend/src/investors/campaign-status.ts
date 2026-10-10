/**
 * Состояние сделки в контракте — это ещё не ответ на вопрос «что тут
 * происходит». `Funding` с прошедшим дедлайном значит «сбор кончился, ждём
 * закрытия», а `Active` с просроченным телом — «платят с опозданием».
 * Инвестору на витрине нужно именно это, поэтому статус считаем здесь.
 */
import { accrue, type DebtInput } from '../borrowers/debt.js';

export type CampaignStatus =
  | 'FUNDING'
  | 'FUNDING_ENDED'
  | 'ACTIVE'
  | 'OVERDUE'
  | 'DEFAULT'
  | 'REPAID'
  | 'FAILED'
  | 'UNKNOWN';

export function campaignStatus(input: {
  /** Состояние из контракта: funding, failed, active, default, repaid. */
  dealState: string;
  fundingDeadline: number;
  overduePrincipal: bigint;
  now?: number;
}): CampaignStatus {
  const now = input.now ?? Math.floor(Date.now() / 1000);

  switch (input.dealState.toLowerCase()) {
    case 'funding':
      return now < input.fundingDeadline ? 'FUNDING' : 'FUNDING_ENDED';
    case 'active':
      return input.overduePrincipal > 0n ? 'OVERDUE' : 'ACTIVE';
    case 'default':
      return 'DEFAULT';
    case 'repaid':
      return 'REPAID';
    case 'failed':
      return 'FAILED';
    default:
      // Незнакомое состояние не выдаём за понятное: пусть будет видно, что
      // платформа его не разобрала.
      return 'UNKNOWN';
  }
}

/** Куда статус попадает на витрине: вкладки «в сборе», «действующие», «завершённые». */
export function statusGroup(
  status: CampaignStatus,
): 'funding' | 'active' | 'finished' {
  if (status === 'FUNDING' || status === 'FUNDING_ENDED') return 'funding';
  if (status === 'ACTIVE' || status === 'OVERDUE') return 'active';
  return 'finished';
}

/**
 * Просроченное тело на текущий момент. Поле `overdue_principal` в сделке верно
 * только на `last_accrual_ts`: контракт переносит наступивший платёж в
 * просрочку внутри денежной транзакции, а до неё в поле остаётся ноль. Без
 * этого заём с пропущенным платежом показывался бы как «Действует», пока
 * заёмщик не заплатит.
 */
export function overdueNow(deal: DebtInput, now?: number): bigint {
  return accrue(deal, now ?? Math.floor(Date.now() / 1000)).overduePrincipal;
}
