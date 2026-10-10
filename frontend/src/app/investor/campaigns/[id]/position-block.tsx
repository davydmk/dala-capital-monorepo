'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { formatDateTime, formatMoney } from '@/components/money';
import { Button, Card, CardTitle, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { CampaignPage, CampaignPosition } from '@/lib/types';

/** Ваша позиция: сколько вложено, что причитается и когда следующий платёж. */
export function PositionBlock({
  id,
  position,
  decimals,
  canClaim,
}: {
  id: string;
  position: CampaignPosition;
  decimals: number;
  canClaim: boolean;
}) {
  const client = useQueryClient();
  const claim = useMutation<CampaignPage, ApiError, void>({
    mutationFn: () => api.invest.claim(id),
    onSuccess: async (data) => {
      client.setQueryData(['campaign', id], data);
      await client.invalidateQueries({ queryKey: ['campaign-history', id] });
    },
  });

  const payout = position.payout;
  const nothing = payout.total === '0';

  return (
    <Card>
      <CardTitle>Ваша позиция</CardTitle>
      <dl className="space-y-3">
        <Line
          label="Вложено"
          value={formatMoney(position.principal, decimals)}
          hint={`доля в кампании ${position.shareBps / 100}%`}
        />
        <Line
          label="Получите при полном погашении"
          value={formatMoney(position.expected, decimals)}
          hint="тело и проценты, если заём погасят по графику"
        />
        {position.next ? (
          <Line
            label={`Следующий платёж — ${formatDateTime(position.next.dueTs)}`}
            value={formatMoney(position.next.yours, decimals)}
            hint={`ваша доля из ${formatMoney(position.next.total, decimals)}`}
          />
        ) : null}
      </dl>

      <div className="mt-4 border-t border-border pt-4">
        <p className="text-sm text-muted">Доступно к выводу</p>
        <p className="text-2xl font-semibold tabular-nums">
          {formatMoney(payout.total, decimals)}
        </p>
        {!nothing ? (
          <dl className="mt-2 space-y-1 text-sm text-muted">
            {(
              [
                ['тело', payout.principal],
                ['проценты', payout.interest],
                ['пеня', payout.penalty],
                ['комиссия за досрочное', payout.prepaymentFee],
              ] as const
            )
              .filter(([, amount]) => amount !== '0')
              .map(([label, amount]) => (
                <div key={label} className="flex justify-between gap-2">
                  <dt>{label}</dt>
                  <dd className="tabular-nums">
                    {formatMoney(amount, decimals)}
                  </dd>
                </div>
              ))}
          </dl>
        ) : null}

        {claim.isError ? (
          <div className="mt-3">
            <Notice tone="danger" title={claim.error.message} />
          </div>
        ) : null}

        <Button
          className="mt-3"
          disabled={nothing || !canClaim}
          loading={claim.isPending}
          onClick={() => claim.mutate()}
        >
          <Wallet size={16} aria-hidden /> Забрать
        </Button>
        {nothing ? (
          <p className="mt-2 text-xs text-muted">
            Забирать пока нечего: деньги появятся здесь, когда заёмщик начнёт
            платить по графику, или вернутся, если сбор не состоится.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function Line({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
      {hint ? <dd className="text-xs text-muted">{hint}</dd> : null}
    </div>
  );
}
