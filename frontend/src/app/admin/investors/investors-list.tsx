'use client';

import { useQuery } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { formatDate } from '@/components/borrower-bits';
import { EmptyState, Notice } from '@/components/ui';
import { api } from '@/lib/api';
import {
  INVESTOR_TYPE_TITLE,
  KYC_STATUS_TITLE,
  type InvestorListItem,
  type KycStatus,
} from '@/lib/types';
import { KycBadge } from './kyc-badge';

const FILTERS: { value: KycStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Все' },
  { value: 'PENDING', label: KYC_STATUS_TITLE.PENDING },
  { value: 'RETRY', label: KYC_STATUS_TITLE.RETRY },
  { value: 'APPROVED', label: KYC_STATUS_TITLE.APPROVED },
  { value: 'DRAFT', label: KYC_STATUS_TITLE.DRAFT },
  { value: 'REJECTED', label: KYC_STATUS_TITLE.REJECTED },
];

/** Как назвать инвестора в списке: компанию — по названию, человека — по имени. */
export function investorTitle(investor: {
  type: string;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
}): string {
  if (investor.type === 'COMPANY') return investor.companyName ?? 'Компания';
  const name = `${investor.firstName ?? ''} ${investor.lastName ?? ''}`.trim();
  return name || 'Без имени';
}

export function InvestorsList() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<KycStatus | 'ALL'>('ALL');

  const investors = useQuery({
    queryKey: ['investors', query, status],
    queryFn: () =>
      api.investors.list({
        query: query.trim() || undefined,
        status: status === 'ALL' ? undefined : status,
      }),
  });

  return (
    <div className="space-y-4">
      <label className="relative block">
        <Search
          size={18}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Почта, фамилия или название компании"
          aria-label="Поиск инвестора"
          className="min-h-11 w-full rounded-lg border border-border bg-surface pr-3 pl-10 placeholder:text-muted"
        />
      </label>

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

      {investors.data && investors.data.pending > 0 ? (
        <Notice
          tone="warning"
          title={`Ждут решения: ${investors.data.pending}`}
        >
          Писем платформа не отправляет — инвестор увидит решение, когда зайдёт
          в кабинет.
        </Notice>
      ) : null}

      {investors.isError ? (
        <Notice tone="danger" title="Не удалось загрузить список" />
      ) : null}

      {investors.data?.investors.length === 0 ? (
        <EmptyState icon={<Users size={28} aria-hidden />} title="Пусто">
          Инвесторы появятся здесь, когда зарегистрируются и начнут проверку.
        </EmptyState>
      ) : null}

      <ul className="space-y-2">
        {investors.data?.investors.map((investor) => (
          <li key={investor.id}>
            <Row investor={investor} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ investor }: { investor: InvestorListItem }) {
  return (
    <Link
      href={`/admin/investors/${investor.id}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 transition hover:bg-background"
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{investorTitle(investor)}</p>
        <p className="truncate text-sm text-muted">{investor.user.email}</p>
        <p className="mt-1 text-xs text-muted">
          {INVESTOR_TYPE_TITLE[investor.type]}
          {investor.submittedAt
            ? ` · подана ${formatDate(investor.submittedAt)}`
            : ' · анкета не отправлена'}
        </p>
      </div>
      <KycBadge status={investor.status} />
    </Link>
  );
}
