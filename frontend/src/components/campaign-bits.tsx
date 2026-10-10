/** Части витрины кампаний: плашка статуса и полоса сбора. */
import clsx from 'clsx';
import {
  CAMPAIGN_STATUS_TITLE,
  type CampaignStatus,
  type ScheduleKind,
} from '@/lib/types';
import { words } from '@/lib/wording';
import { formatMoney } from './money';

const STATUS_STYLE: Record<CampaignStatus, string> = {
  FUNDING: 'border-transparent bg-accent-soft text-accent',
  FUNDING_ENDED: 'border-transparent bg-warning-soft text-warning',
  ACTIVE: 'border-transparent bg-accent-soft text-accent',
  OVERDUE: 'border-transparent bg-warning-soft text-warning',
  DEFAULT: 'border-transparent bg-danger-soft text-danger',
  REPAID: 'border-border text-muted',
  FAILED: 'border-border text-muted',
  UNKNOWN: 'border-border text-muted',
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        STATUS_STYLE[status],
      )}
    >
      {CAMPAIGN_STATUS_TITLE[status]}
    </span>
  );
}

/**
 * Полоса сбора у кредита, размещения — у облигации. Засечка отмечает минимум:
 * до неё дело не состоится, и инвестору это важнее, чем расстояние до
 * максимума.
 */
export function FundingBar({
  raised,
  softCap,
  hardCap,
  decimals,
  scheduleKind,
}: {
  raised: string;
  softCap: string;
  hardCap: string;
  decimals: number;
  scheduleKind?: ScheduleKind;
}) {
  const w = words(scheduleKind);
  const target = Number(hardCap);
  const percent =
    target > 0 ? Math.min(100, (Number(raised) / target) * 100) : 0;
  const soft = target > 0 ? Math.min(100, (Number(softCap) / target) * 100) : 0;

  return (
    <div>
      <div className="relative h-2 overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${percent}%` }}
        />
        {soft > 0 && soft < 100 ? (
          <span
            aria-hidden
            title={w.softCapHint}
            className="absolute top-0 h-full w-0.5 bg-surface"
            style={{ left: `${soft}%` }}
          />
        ) : null}
      </div>
      <p className="mt-1.5 text-xs text-muted tabular-nums">
        {w.raisedLower} {formatMoney(raised, decimals)} из{' '}
        {formatMoney(hardCap, decimals)}
        <span className="block">минимум {formatMoney(softCap, decimals)}</span>
      </p>
    </div>
  );
}

/** «2 дн», «5 ч», «12 мин» — сколько осталось до момента в будущем. */
export function timeLeft(unixSeconds: number, now = Date.now()): string | null {
  const seconds = unixSeconds - Math.floor(now / 1000);
  if (seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  if (hours < 1) return `${Math.max(1, Math.floor(seconds / 60))} мин`;
  if (hours < 48) return `${hours} ч`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days} дн`;
  return `${Math.round(days / 30)} мес`;
}

/**
 * Полоса срока займа: сколько прошло от первого платежа до последнего.
 * До начала выплат показывает, что срок ещё не пошёл.
 */
export function TermBar({
  from,
  to,
  now,
}: {
  from: number;
  to: number;
  /** Текущий момент в unix-секундах: считает вызывающий, чтобы отрисовка была чистой. */
  now: number;
}) {
  const length = to - from;
  const passed = Math.min(Math.max(now - from, 0), Math.max(length, 0));
  const percent = length > 0 ? (passed / length) * 100 : 0;
  const left = timeLeft(to, now * 1000);

  return (
    <div>
      <div className="h-2 overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-xs text-muted">
        <span>
          {now < from
            ? 'выплаты ещё не начались'
            : `прошло ${Math.round(percent)}%`}
        </span>
        <span>{left ? `осталось ${left}` : 'срок вышел'}</span>
      </p>
    </div>
  );
}
