'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { RatingBadge, StatusBadge } from '@/components/borrower-bits';
import { CompanyAvatar } from '@/components/company-avatar';
import { buttonStyles, EmptyState, Notice } from '@/components/ui';
import { api } from '@/lib/api';
import { BORROWER_STATUS_TITLE, type BorrowerStatus } from '@/lib/types';

const FILTERS: { value: BorrowerStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Все' },
  { value: 'DRAFT', label: BORROWER_STATUS_TITLE.DRAFT },
  { value: 'APPROVED', label: BORROWER_STATUS_TITLE.APPROVED },
  { value: 'SUSPENDED', label: BORROWER_STATUS_TITLE.SUSPENDED },
  { value: 'ARCHIVED', label: BORROWER_STATUS_TITLE.ARCHIVED },
];

export function BorrowersList() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<BorrowerStatus | 'ALL'>('ALL');

  const borrowers = useQuery({
    queryKey: ['borrowers', query, status],
    queryFn: () =>
      api.borrowers.list({
        query: query.trim() || undefined,
        status: status === 'ALL' ? undefined : status,
        // Архивные показываем, только когда их специально попросили.
        includeArchived: status === 'ARCHIVED',
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <Search
            size={18}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Название или БИН"
            aria-label="Поиск заёмщика"
            className="min-h-11 w-full rounded-lg border border-border bg-surface pr-3 pl-10 placeholder:text-muted"
          />
        </label>
        <Link href="/admin/borrowers/new" className={buttonStyles()}>
          <Plus size={18} aria-hidden /> Добавить заёмщика
        </Link>
      </div>

      {/* Фильтр прокручивается вбок на узком экране, чтобы не переносить строку */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            onClick={() => setStatus(filter.value)}
            aria-pressed={status === filter.value}
            className={
              status === filter.value
                ? 'min-h-9 shrink-0 rounded-full bg-accent px-3 text-sm font-medium text-white'
                : 'min-h-9 shrink-0 rounded-full border border-border px-3 text-sm text-muted'
            }
          >
            {filter.label}
          </button>
        ))}
      </div>

      {borrowers.isError ? (
        <Notice tone="danger" title="Не удалось загрузить список" />
      ) : null}
      {borrowers.isPending ? (
        <p className="text-sm text-muted">Загружаем…</p>
      ) : null}

      {borrowers.data?.length === 0 ? (
        <EmptyState
          icon={<Building2 size={28} aria-hidden />}
          title="Заёмщиков пока нет"
        >
          Карточка компании нужна, чтобы создать кампанию: из неё берутся
          реквизиты и кошелёк для получения займа.
        </EmptyState>
      ) : null}

      <ul className="space-y-2">
        {borrowers.data?.map((borrower) => (
          <li key={borrower.id}>
            <Link
              href={`/admin/borrowers/${borrower.id}`}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 transition hover:border-accent"
            >
              <CompanyAvatar
                id={borrower.id}
                name={borrower.name}
                hasLogo={Boolean(borrower.logoKey)}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{borrower.name}</p>
                <p className="mt-0.5 text-sm text-muted">
                  БИН {borrower.bin}
                  {borrower.industry ? ` · ${borrower.industry}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={borrower.status} />
                  <RatingBadge rating={borrower.rating} />
                  {borrower._count.documents > 0 ? (
                    <span className="text-xs text-muted">
                      документов: {borrower._count.documents}
                    </span>
                  ) : null}
                  {borrower.wallets.length === 0 ? (
                    <span className="text-xs text-warning">нет кошелька</span>
                  ) : null}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
