'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { formatDateTime, formatMoney } from '@/components/money';
import { Card, CardTitle } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { EVENT_TITLE, type CampaignEvent } from '@/lib/types';

/** Суммы в событиях лежат в микроединицах под разными именами. */
const AMOUNT_FIELDS = [
  'amount',
  'total',
  'received',
  'totalRaised',
  'payoutAmount',
  'principal',
];

/** Сколько строк видно, пока список не развернули. */
const SHORT = 5;

/** История операций кампании: события контракта, как они записаны в сети. */
export function HistoryBlock({
  id,
  decimals,
}: {
  id: string;
  decimals: number;
}) {
  const client = useQueryClient();
  const [all, setAll] = useState(false);
  const history = useQuery({
    queryKey: ['campaign-history', id],
    queryFn: () => api.invest.history(id),
  });

  const refresh = useMutation<CampaignEvent[], ApiError, void>({
    mutationFn: () => api.invest.history(id, true),
    onSuccess: (data) => client.setQueryData(['campaign-history', id], data),
  });

  const events = history.data ?? [];
  const shown = all ? events : events.slice(0, SHORT);

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <CardTitle>История операций</CardTitle>
        <button
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-accent"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          <RefreshCw size={14} aria-hidden />
          {refresh.isPending ? 'Читаем…' : 'Обновить'}
        </button>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-muted">
          {history.isPending
            ? 'Загружаем…'
            : 'Событий по кампании ещё не было.'}
        </p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {shown.map((event) => (
            <li
              key={`${event.signature}-${event.name}-${String(event.at)}`}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate">
                  {EVENT_TITLE[event.name] ?? event.name}
                </span>
                <span className="text-xs text-muted">
                  {formatDateTime(event.at)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 tabular-nums">
                {amount(event, decimals)}
                <a
                  href={event.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted hover:text-accent"
                  aria-label="Транзакция в обозревателе"
                >
                  <ExternalLink size={14} aria-hidden />
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}

      {events.length > SHORT ? (
        <button
          className="mt-2 text-sm text-muted hover:text-accent"
          onClick={() => setAll(!all)}
        >
          {all ? 'Свернуть' : `Показать ещё ${events.length - SHORT}`}
        </button>
      ) : null}
    </Card>
  );
}

/** Главная сумма события, если она в нём есть. */
function amount(event: CampaignEvent, decimals: number): string {
  const field = AMOUNT_FIELDS.find((name) => event.payload?.[name]);
  return field ? formatMoney(event.payload[field], decimals) : '';
}
