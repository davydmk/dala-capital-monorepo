import clsx from 'clsx';
import { KYC_STATUS_TITLE, type KycStatus } from '@/lib/types';

const STATUS_STYLE: Record<KycStatus, string> = {
  NOT_STARTED: 'border-border text-muted',
  DRAFT: 'border-border text-muted',
  PENDING: 'border-transparent bg-warning-soft text-warning',
  ON_HOLD: 'border-transparent bg-warning-soft text-warning',
  APPROVED: 'border-transparent bg-accent-soft text-accent',
  RETRY: 'border-transparent bg-warning-soft text-warning',
  REJECTED: 'border-transparent bg-danger-soft text-danger',
};

export function KycBadge({ status }: { status: KycStatus }) {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        STATUS_STYLE[status],
      )}
    >
      {KYC_STATUS_TITLE[status]}
    </span>
  );
}
