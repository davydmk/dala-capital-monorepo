/**
 * Состояние сделки в контракте — это ещё не ответ на вопрос «что тут
 * происходит». `Funding` с прошедшим дедлайном значит «сбор кончился, ждём
 * закрытия», а `Active` с неоплаченным наступившим платежом — «платят с
 * опозданием». Инвестору на витрине нужно именно это, поэтому статус считаем
 * здесь.
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
  /** Неоплаченное из наступивших платежей: тело и плановые проценты вместе. */
  overdue: bigint;
  now?: number;
}): CampaignStatus {
  const now = input.now ?? Math.floor(Date.now() / 1000);

  switch (input.dealState.toLowerCase()) {
    case 'funding':
      return now < input.fundingDeadline ? 'FUNDING' : 'FUNDING_ENDED';
    case 'active':
      return input.overdue > 0n ? 'OVERDUE' : 'ACTIVE';
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
 * Просроченное на текущий момент: тело **и** плановые проценты наступивших
 * платежей. Смотреть на одно тело нельзя — у облигации в купонных периодах
 * его нет вовсе, и пропущенный купон не считался бы просрочкой до самого
 * погашения.
 *
 * Поля `overdue_*` в сделке верны только на `last_accrual_ts`: контракт
 * переносит наступивший платёж в просрочку внутри денежной транзакции, а до
 * неё там остаётся ноль. Без пересчёта заём с пропущенным платежом
 * показывался бы как «Действует», пока заёмщик не заплатит.
 */
export function overdueNow(deal: DebtInput, now?: number): bigint {
  const state = accrue(deal, now ?? Math.floor(Date.now() / 1000));
  return state.overduePrincipal + state.overdueScheduledInterest;
}
