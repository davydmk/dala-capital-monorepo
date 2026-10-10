'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { CompanyAvatar } from '@/components/company-avatar';
import { bpsToPercent, formatDateTime, formatMoney } from '@/components/money';
import { ScheduleTable } from '@/components/schedule-table';
import { Card, CardTitle, Notice } from '@/components/ui';
import { api } from '@/lib/api';
import {
  CAMPAIGN_STATE_TITLE,
  SCHEDULE_KIND_TITLE,
  SCHEDULE_STEP_TITLE,
} from '@/lib/types';
import { CampaignWizard } from './campaign-wizard';
import { words } from '@/lib/wording';
import { ClosingBlock } from './closing-block';
import { RecoveryBlock } from './recovery-block';

/** Ончейн-состояния сделки из контракта. */
const DEAL_STATE_TITLE: Record<string, string> = {
  funding: 'Идёт сбор',
  failed: 'Сбор не состоялся',
  active: 'Заём выдан',
  default: 'Дефолт',
  repaid: 'Погашен',
};

export function CampaignPage({ id }: { id: string }) {
  const campaign = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => api.campaigns.get(id),
  });

  const published = campaign.data?.state === 'PUBLISHED';
  const onchain = useQuery({
    queryKey: ['campaign-onchain', id],
    queryFn: () => api.campaigns.onchain(id),
    enabled: published,
    // Пока идёт сбор, цифры меняются: обновляем раз в полминуты.
    refetchInterval: 30_000,
  });
  const schedule = useQuery({
    queryKey: ['campaign-schedule', id],
    queryFn: () => api.campaigns.preview(id),
    enabled: published,
  });

  if (campaign.isPending)
    return <p className="text-sm text-muted">Загружаем кампанию…</p>;
  if (campaign.isError)
    return <Notice tone="danger" title="Кампания не найдена" />;

  // Черновик и неудачная публикация открываются в мастере.
  if (!published) return <CampaignWizard campaign={campaign.data} />;

  const data = campaign.data;

  return (
    <div className="space-y-4">
      <Link
        href="/admin/campaigns"
        className="inline-flex items-center gap-2 text-sm text-muted"
      >
        <ArrowLeft size={16} aria-hidden /> К списку кампаний
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <CompanyAvatar
          id={data.borrower.id}
          name={data.borrower.name}
          hasLogo={Boolean(data.borrower.logoKey)}
        />
        <div>
          <h2 className="text-xl font-semibold">{data.title}</h2>
          <p className="text-sm text-muted">
            {data.borrower.name} ·{' '}
            {data.scheduleKind === 'COUPON' ? 'выпуск' : 'кампания'} №
            {data.onchainId} · {CAMPAIGN_STATE_TITLE[data.state].toLowerCase()}
          </p>
        </div>
      </div>

      <Card>
        <CardTitle>Состояние в контракте</CardTitle>
        {onchain.isPending ? (
          <p className="text-sm text-muted">Читаем из сети…</p>
        ) : null}
        {onchain.data ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Row
              label="Статус"
              value={DEAL_STATE_TITLE[onchain.data.state] ?? onchain.data.state}
            />
            <Row
              label={words(data.scheduleKind).raised}
              value={formatMoney(onchain.data.totalRaised)}
            />
            <Row
              label={words(data.scheduleKind).deadline}
              value={formatDateTime(onchain.data.fundingDeadline)}
            />
            <Row
              label="Платежей в графике"
              value={String(onchain.data.periodCount)}
            />
            <Row label="Кошелёк заёмщика" value={onchain.data.borrowerWallet} />
            <Row label="Адрес сделки" value={onchain.data.address} />
            {onchain.data.repayAddress ? (
              <Row label="Адрес погашения" value={onchain.data.repayAddress} />
            ) : null}
          </dl>
        ) : null}

        {onchain.data?.txs.length ? (
          <ul className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
            {onchain.data.txs.map((tx) => (
              <li key={tx.signature}>
                <a
                  href={tx.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-accent"
                >
                  {tx.stage === 'CREATE'
                    ? 'Создание кампании'
                    : tx.stage === 'PERIODS'
                      ? 'Загрузка графика'
                      : 'Фиксация графика'}
                  <ExternalLink size={14} aria-hidden />
                </a>
                <span className="ml-2 text-muted">
                  {formatDateTime(tx.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {onchain.data && onchain.data.state === 'funding' ? (
        <ClosingBlock
          id={id}
          deal={onchain.data}
          decimals={data.mintDecimals}
          scheduleKind={data.scheduleKind}
        />
      ) : null}

      {onchain.data &&
      (onchain.data.state === 'active' || onchain.data.state === 'default') ? (
        <RecoveryBlock
          id={id}
          deal={onchain.data}
          decimals={data.mintDecimals}
          threshold={data.defaultThresholdDays}
        />
      ) : null}

      <Card>
        <CardTitle>Условия</CardTitle>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Row
            label="Сбор"
            value={`${formatMoney(data.softCap)} — ${formatMoney(data.hardCap)}`}
          />
          <Row label="Взнос" value={`от ${formatMoney(data.minTicket)}`} />
          <Row
            label="Ставка"
            value={`${bpsToPercent(data.annualRateBps)}% годовых`}
          />
          <Row label="Схема" value={SCHEDULE_KIND_TITLE[data.scheduleKind]} />
          <Row
            label="График"
            value={`${data.periodCount} платежей, шаг — ${SCHEDULE_STEP_TITLE[data.scheduleStep].toLowerCase()}`}
          />
          <Row
            label="Пеня"
            value={`${bpsToPercent(data.penaltyRateBps)}% годовых`}
          />
          <Row
            label="Порог дефолта"
            value={`${data.defaultThresholdDays} дней`}
          />
          <Row
            label="Комиссия платформы"
            value={`${bpsToPercent(data.platformFeeBps)}%`}
          />
          {data.purpose ? (
            <Row label="На что берутся деньги" value={data.purpose} />
          ) : null}
          {data.collateral ? (
            <Row label="Обеспечение" value={data.collateral} />
          ) : null}
        </dl>
      </Card>

      {schedule.data ? (
        <ScheduleTable
          schedule={schedule.data.max}
          title="График при полном сборе"
          internal
        />
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium break-all">{value}</dd>
    </div>
  );
}
