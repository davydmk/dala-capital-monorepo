'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/components/borrower-bits';
import { CampaignStatusBadge, FundingBar } from '@/components/campaign-bits';
import { CompanyAvatar } from '@/components/company-avatar';
import { bpsToPercent, formatDateTime, formatMoney } from '@/components/money';
import { Card, CardTitle, Notice, StatTile } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import {
  PUBLIC_RISK_TITLE,
  RISK_DISCLAIMER,
  SCHEDULE_KIND_TITLE,
} from '@/lib/types';

/**
 * Публичная карточка заёмщика: чем занимается, как выглядит производство,
 * какая оценка риска и все его займы. Реквизитов и БИН здесь нет — инвестору
 * важно, кому он даёт деньги, а не как оформлена компания.
 */
export function BorrowerView({ id }: { id: string }) {
  const showcase = useQuery({
    queryKey: ['borrower-showcase', id],
    queryFn: () => api.invest.borrower(id),
  });

  if (showcase.isPending) {
    return <p className="text-sm text-muted">Загружаем заёмщика…</p>;
  }
  if (showcase.isError) {
    return (
      <Notice tone="danger" title={(showcase.error as ApiError).message} />
    );
  }

  const { borrower, campaigns, repaid } = showcase.data;
  const decimals = campaigns[0]?.mintDecimals ?? 6;
  const raised = campaigns.reduce(
    (sum, campaign) => sum + BigInt(campaign.totalRaised),
    0n,
  );

  return (
    <div className="space-y-4">
      <Link
        href="/investor/campaigns"
        className="inline-flex items-center gap-2 text-sm text-muted"
      >
        <ArrowLeft size={16} aria-hidden /> К кампаниям
      </Link>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <CompanyAvatar
            id={borrower.id}
            name={borrower.name}
            hasLogo={Boolean(borrower.logoKey)}
          />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{borrower.name}</h2>
            <p className="text-sm text-muted">
              {borrower.industry ?? 'отрасль не указана'}
            </p>
          </div>
        </div>

        {borrower.description ? (
          <p className="text-sm">{borrower.description}</p>
        ) : null}

        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {borrower.foundedAt ? (
            <Row label="На рынке с" value={formatDate(borrower.foundedAt)} />
          ) : null}
          {borrower.employees ? (
            <Row label="Сотрудников" value={String(borrower.employees)} />
          ) : null}
          {borrower.website ? (
            <div className="flex justify-between gap-3 border-b border-border py-1.5">
              <dt className="text-muted">Сайт</dt>
              <dd>
                <a
                  href={borrower.website}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-accent"
                >
                  {borrower.website.replace(/^https?:\/\//, '')}
                  <ExternalLink size={14} aria-hidden />
                </a>
              </dd>
            </div>
          ) : null}
        </dl>

        {borrower.rating ? (
          <p className="mt-3 text-sm">
            Оценка риска:{' '}
            <span className="font-medium">
              {PUBLIC_RISK_TITLE[borrower.rating].toLowerCase()}
            </span>
            <span className="mt-1 block text-xs text-muted">
              {RISK_DISCLAIMER}
            </span>
          </p>
        ) : null}

        {borrower.photos.length > 0 ? (
          <ul className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            {borrower.photos.map((photo) => (
              <li key={photo.id} className="shrink-0">
                {/* Фото с нашего же домена: оптимизатор Next здесь лишний. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={api.borrowers.photoUrl(borrower.id, photo.id)}
                  alt={photo.caption ?? ''}
                  className="h-28 w-40 rounded-lg object-cover"
                />
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile
          label="Займов на платформе"
          value={String(campaigns.length)}
          hint="Всего кампаний"
        />
        <StatTile
          label="Погашено"
          value={String(repaid)}
          hint="Закрытых займов"
        />
        <StatTile
          label="Привлечено"
          value={formatMoney(raised.toString(), decimals)}
          hint="По всем кампаниям"
        />
      </div>

      <Card>
        <CardTitle>Займы</CardTitle>
        <ul className="space-y-3">
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <Link
                href={`/investor/campaigns/${campaign.id}`}
                className="block rounded-xl border border-border p-3 transition hover:border-accent"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{campaign.title}</span>
                  <CampaignStatusBadge status={campaign.status} />
                </div>
                <p className="mt-1 text-sm text-muted">
                  {bpsToPercent(campaign.annualRateBps)}% годовых ·{' '}
                  {SCHEDULE_KIND_TITLE[campaign.scheduleKind].toLowerCase()}
                  {campaign.status === 'FUNDING'
                    ? ` · сбор до ${formatDateTime(campaign.fundingDeadline)}`
                    : ''}
                </p>
                <div className="mt-2">
                  <FundingBar
                    raised={campaign.totalRaised}
                    softCap={campaign.softCap}
                    hardCap={campaign.hardCap}
                    decimals={campaign.mintDecimals}
                    scheduleKind={campaign.scheduleKind}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
