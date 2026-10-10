/** Мелкие части, общие для списка и карточки заёмщика. */
import clsx from 'clsx';
import {
  BORROWER_STATUS_TITLE,
  RATING_TITLE,
  type BorrowerStatus,
  type CreditRating,
} from '@/lib/types';

const STATUS_STYLE: Record<BorrowerStatus, string> = {
  DRAFT: 'border-border text-muted',
  APPROVED: 'border-transparent bg-accent-soft text-accent',
  SUSPENDED: 'border-transparent bg-warning-soft text-warning',
  ARCHIVED: 'border-border text-muted opacity-70',
};

export function StatusBadge({ status }: { status: BorrowerStatus }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        STATUS_STYLE[status],
      )}
    >
      {BORROWER_STATUS_TITLE[status]}
    </span>
  );
}

export function RatingBadge({ rating }: { rating?: CreditRating | null }) {
  if (!rating)
    return <span className="text-sm text-muted">рейтинг не присвоен</span>;
  return (
    <span
      className="inline-flex size-6 items-center justify-center rounded-md border border-border text-sm font-semibold"
      title={RATING_TITLE[rating]}
    >
      {rating}
    </span>
  );
}

/** Сумма в долларах без центов: на карточке точность не нужна. */
export const formatUsd = (value?: number | null) =>
  value === null || value === undefined
    ? '—'
    : `$${new Intl.NumberFormat('ru-RU').format(value)}`;

export const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString('ru-RU') : '—';

export const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

/** Короткий вид адреса: начало и конец, середина скрыта. */
export const shortAddress = (address?: string | null) =>
  address ? `${address.slice(0, 4)}…${address.slice(-4)}` : '—';
