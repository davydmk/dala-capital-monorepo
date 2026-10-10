'use client';

import { useQuery } from '@tanstack/react-query';
import { Briefcase } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import {
  CampaignStatusBadge,
  FundingBar,
  timeLeft,
} from '@/components/campaign-bits';
import { CompanyAvatar } from '@/components/company-avatar';
import { formatMoney } from '@/components/money';
import { Chip, EmptyState, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import {
  PUBLIC_RISK_TITLE,
  SCHEDULE_KIND_SHORT,
  type CampaignCard,
  type CampaignStatus,
  type ScheduleKind,
} from '@/lib/types';

type Tab = 'funding' | 'active' | 'finished' | 'mine';

/** Вид вложения: у кредита аннуитет, у облигации купоны и бумага на руках. */
type Kind = 'all' | ScheduleKind;

const KINDS: { value: Kind; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'ANNUITY', label: 'Кредиты' },
  { value: 'COUPON', label: 'Облигации' },
];

const TABS: { value: Tab; label: string }[] = [
  { value: 'funding', label: 'В сборе' },
  { value: 'active', label: 'Действующие' },
  { value: 'finished', label: 'Завершённые' },
  { value: 'mine', label: 'Мои' },
];

const EMPTY: Record<Tab, string> = {
  funding: 'Сейчас платформа ничего не собирает. Загляните позже.',
  active: 'Действующих займов пока нет.',
  finished: 'Завершённых кампаний пока нет.',
  mine: 'Вы ещё никуда не вложились. Начните с вкладки «В сборе».',
};

/** Та же раскладка, что и на бэкенде: вкладки повторяют смысл статусов. */
function group(status: CampaignStatus): Exclude<Tab, 'mine'> {
  if (status === 'FUNDING' || status === 'FUNDING_ENDED') return 'funding';
  if (status === 'ACTIVE' || status === 'OVERDUE') return 'active';
  return 'finished';
}

export function CampaignsList() {
  const [tab, setTab] = useState<Tab>('funding');
  const [kind, setKind] = useState<Kind>('all');
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: api.invest.campaigns,
  });

  if (campaigns.isPending) {
    return <p className="text-sm text-muted">Загружаем кампании…</p>;
  }
  if (campaigns.isError) {
    return (
      <Notice tone="danger" title={(campaigns.error as ApiError).message} />
    );
  }

  // Вид сужает выборку и для вкладок: иначе счётчики обещали бы не то,
  // что открывается по нажатию.
  const byKind = campaigns.data.filter(
    (campaign) => kind === 'all' || campaign.scheduleKind === kind,
  );
  const shown = byKind.filter((campaign) =>
    tab === 'mine' ? campaign.invested !== '0' : group(campaign.status) === tab,
  );

  return (
    <div className="space-y-4">
      {/* Вкладки прокручиваются вбок на узком экране, чтобы не переносить строку */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {TABS.map((item) => {
          const count = byKind.filter((campaign) =>
            item.value === 'mine'
              ? campaign.invested !== '0'
              : group(campaign.status) === item.value,
          ).length;
          return (
            <Chip
              key={item.value}
              active={tab === item.value}
              onClick={() => setTab(item.value)}
            >
              {item.label}
              {count > 0 ? ` · ${count}` : ''}
            </Chip>
          );
        })}
      </div>

      <div className="flex gap-2">
        {KINDS.map((item) => (
          <Chip
            key={item.value}
            active={kind === item.value}
            onClick={() => setKind(item.value)}
          >
            {item.label}
          </Chip>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<Briefcase size={28} aria-hidden />} title="Пусто">
          {EMPTY[tab]}
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((campaign) => (
            <li key={campaign.id}>
              <Tile campaign={campaign} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Tile({ campaign }: { campaign: CampaignCard }) {
  const decimals = campaign.mintDecimals;
  const funding = campaign.status === 'FUNDING';
  const left = funding ? timeLeft(campaign.fundingDeadline) : null;
  const bond = campaign.scheduleKind === 'COUPON';
  const untilEnd = timeLeft(campaign.lastDueTs);

  return (
    <Link
      href={`/investor/campaigns/${campaign.id}`}
      className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface transition hover:bg-background"
    >
      <div className="relative aspect-[16/9] bg-background">
        {campaign.photoUrl ? (
          // Обычный img: это фото с нашего же домена, оптимизатор Next тут лишний.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={campaign.photoUrl}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <CompanyAvatar
              id={campaign.borrower.id}
              name={campaign.borrower.name}
              hasLogo={Boolean(campaign.borrower.logoKey)}
            />
          </div>
        )}
        <span className="absolute top-2 right-2">
          <CampaignStatusBadge status={campaign.status} />
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <p className="font-medium">{campaign.title}</p>
          <p className="truncate text-sm text-muted">
            {campaign.borrower.name}
            {campaign.borrower.rating
              ? ` · ${PUBLIC_RISK_TITLE[campaign.borrower.rating].toLowerCase()}`
              : ''}
          </p>
        </div>

        <FundingBar
          raised={campaign.totalRaised}
          softCap={campaign.softCap}
          hardCap={campaign.hardCap}
          decimals={decimals}
          scheduleKind={campaign.scheduleKind}
        />

        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-muted">Ставка</dt>
            <dd className="font-semibold tabular-nums">
              {campaign.annualRateBps
                ? `${campaign.annualRateBps / 100}% годовых`
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Схема</dt>
            <dd className="font-medium">
              {SCHEDULE_KIND_SHORT[campaign.scheduleKind]}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">
              {funding
                ? bond
                  ? 'До конца размещения'
                  : 'До конца сбора'
                : bond
                  ? 'Размещение'
                  : 'Сбор'}
            </dt>
            <dd className="font-medium">
              {funding
                ? (left ?? 'заканчивается')
                : bond
                  ? 'закрыто'
                  : 'закрыт'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">До конца погашения</dt>
            <dd className="font-medium">{untilEnd ?? 'срок вышел'}</dd>
          </div>
        </dl>

        {campaign.invested !== '0' ? (
          <p className="mt-auto rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
            Вы вложили {formatMoney(campaign.invested, decimals)}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
