'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import {
  CampaignStatusBadge,
  FundingBar,
  TermBar,
  timeLeft,
} from '@/components/campaign-bits';
import { CompanyAvatar } from '@/components/company-avatar';
import { Copyable } from '@/components/copyable';
import { formatDate } from '@/components/borrower-bits';
import { formatDateTime, formatMoney } from '@/components/money';
import { ScheduleTable } from '@/components/schedule-table';
import { Card, CardTitle, Notice, StatTile } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import {
  PUBLIC_RISK_TITLE,
  RISK_DISCLAIMER,
  SCHEDULE_KIND_TITLE,
  SCHEDULE_STEP_TITLE,
  type CampaignPage,
} from '@/lib/types';
import { DepositView } from './deposit-view';
import { HistoryBlock } from './history-block';
import { InvestorsBlock } from './investors-block';
import { PositionBlock } from './position-block';

export function CampaignView({ id }: { id: string }) {
  const page = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => api.invest.page(id),
  });

  if (page.isPending) {
    return <p className="text-sm text-muted">Загружаем кампанию…</p>;
  }
  if (page.isError) {
    return <Notice tone="danger" title={(page.error as ApiError).message} />;
  }

  const data = page.data;
  const { campaign, borrower, deal, schedules, position, status } = data;
  const decimals = campaign.mintDecimals;
  const collecting = status === 'FUNDING';
  // У облигации не сбор, а размещение, и вкладывают не взнос, а заявку.
  const bond = campaign.scheduleKind === 'COUPON';
  const photo = borrower.photos[0];

  return (
    <div className="space-y-4">
      <Link
        href="/investor/campaigns"
        className="inline-flex items-center gap-2 text-sm text-muted"
      >
        <ArrowLeft size={16} aria-hidden /> Ко всем кампаниям
      </Link>

      <Header data={data} photo={photo} />

      {status === 'DEFAULT' || status === 'OVERDUE' ? (
        <Notice
          tone={status === 'DEFAULT' ? 'danger' : 'warning'}
          title={
            status === 'DEFAULT'
              ? 'По займу объявлен дефолт'
              : 'Заёмщик платит с опозданием'
          }
        >
          {status === 'DEFAULT'
            ? 'Весь остаток долга взыскивается: на него идут проценты и пеня, а расходы платформы на взыскание возмещаются из первых поступлений. Деньги возвращаются инвесторам по мере того, как их удаётся получить, — забрать причитающееся можно в любой момент.'
            : 'На просроченное тело начисляются проценты по ставке займа и пеня — они тоже достанутся инвесторам. Если просрочка дойдёт до порога, платформа объявит дефолт.'}
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardTitle>{bond ? 'Размещение' : 'Сбор'}</CardTitle>
            <FundingBar
              raised={deal.totalRaised}
              softCap={deal.softCap}
              hardCap={deal.hardCap}
              decimals={decimals}
              scheduleKind={campaign.scheduleKind}
            />
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Row
                label={bond ? 'Заявка от' : 'Взнос от'}
                value={formatMoney(deal.minTicket, decimals)}
                hint={
                  deal.maxTicket !== '0'
                    ? `до ${formatMoney(deal.maxTicket, decimals)}`
                    : 'верхней границы нет'
                }
              />
              <Row
                label={
                  collecting
                    ? bond
                      ? 'До конца размещения'
                      : 'До конца сбора'
                    : bond
                      ? 'Размещение'
                      : 'Сбор'
                }
                value={
                  collecting
                    ? (timeLeft(deal.fundingDeadline) ?? 'заканчивается')
                    : bond
                      ? 'закрыто'
                      : 'закрыт'
                }
              />
              <Row
                label={bond ? 'Конец размещения' : 'Конец сбора'}
                value={formatDateTime(deal.fundingDeadline)}
              />
              <Row
                label="Срок возврата"
                value={formatDateTime(deal.lastDueTs)}
              />
            </dl>
          </Card>

          <Card>
            <CardTitle>Условия займа</CardTitle>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <StatTile
                label="Годовая ставка"
                value={
                  campaign.annualRateBps
                    ? `${campaign.annualRateBps / 100}%`
                    : '—'
                }
                hint="на остаток долга"
              />
              <StatTile
                label="Платежей"
                value={String(campaign.periodCount ?? deal.periodCount)}
                hint={SCHEDULE_STEP_TITLE[campaign.scheduleStep].toLowerCase()}
              />
              <StatTile
                label="Схема"
                value={
                  SCHEDULE_KIND_TITLE[campaign.scheduleKind].split(' — ')[0]
                }
                hint={
                  SCHEDULE_KIND_TITLE[campaign.scheduleKind].split(' — ')[1]
                }
              />
              {/* Расчёт и сделка — одна транзакция: доли инвесторов растут
                  там же, где заёмщик платит. Разрыва, ради которого на бирже
                  существует расчётный день, здесь просто нет. */}
              <StatTile label="Расчёты" value="T+0" hint="в день платежа" />
            </div>

            <p className="mt-3 text-sm text-muted">
              Доля в платеже становится вашей в тот же момент, когда заёмщик
              платит — одной транзакцией. Расчётного дня, как на бирже с T+2,
              здесь нет: забрать деньги можно сразу после платежа.
            </p>

            <div className="mt-4">
              <p className="mb-1.5 text-sm text-muted">
                Срок займа: {formatDate(campaign.firstDueAt)} —{' '}
                {formatDateTime(deal.lastDueTs)}
              </p>
              <TermBar
                from={
                  campaign.firstDueAt
                    ? Math.floor(new Date(campaign.firstDueAt).getTime() / 1000)
                    : deal.fundingDeadline
                }
                to={deal.lastDueTs}
                now={data.now}
              />
            </div>
          </Card>

          <ScheduleTable
            schedule={schedules.max}
            title={
              schedules.collecting
                ? 'График, если соберут максимум'
                : 'График платежей'
            }
          />
          {schedules.collecting ? (
            <ScheduleTable
              schedule={schedules.min}
              title="График, если соберут минимум"
            />
          ) : null}

          <InvestorsBlock investors={data.investors} decimals={decimals} />
          <HistoryBlock id={id} decimals={decimals} />
        </div>

        <div className="min-w-0 space-y-4">
          {position ? (
            <PositionBlock
              id={id}
              position={position}
              decimals={decimals}
              canClaim={!data.participationBlock}
            />
          ) : null}

          <DepositView id={id} />

          <Card>
            <CardTitle>Что будет при просрочке</CardTitle>
            <dl className="space-y-3 text-sm">
              <Row
                label="Пеня"
                value={`${campaign.penaltyRateBps / 100}% годовых`}
                hint="на просроченное тело, сверх обычных процентов"
              />
              <Row
                label="Дефолт"
                value={`через ${campaign.defaultThresholdDays} дн`}
                hint="после этого долг переходит во взыскание"
              />
              {/* У облигации досрочного погашения нет: тело возвращается
                  последним платежом, и раньше срока заём не закрыть. */}
              {campaign.scheduleKind === 'ANNUITY' ? (
                <Row
                  label="Досрочное погашение"
                  value={
                    campaign.prepaymentFeeBps
                      ? `комиссия ${campaign.prepaymentFeeBps / 100}%`
                      : 'без комиссии'
                  }
                  hint="её получают инвесторы"
                />
              ) : null}
            </dl>
          </Card>

          <Card>
            <CardTitle>Заёмщик</CardTitle>
            <div className="mb-3 flex items-center gap-3">
              <CompanyAvatar
                id={borrower.id}
                name={borrower.name}
                hasLogo={Boolean(borrower.logoKey)}
              />
              <div className="min-w-0">
                <Link
                  href={`/investor/borrowers/${borrower.id}`}
                  className="font-medium hover:text-accent"
                >
                  {borrower.name}
                </Link>
                <p className="text-sm text-muted">
                  {borrower.industry ?? 'отрасль не указана'}
                </p>
              </div>
            </div>
            {borrower.description ? (
              <p className="text-sm">{borrower.description}</p>
            ) : null}
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
            <Link
              href={`/investor/borrowers/${borrower.id}`}
              className="mt-3 inline-block text-sm text-accent hover:underline"
            >
              Все займы этого заёмщика →
            </Link>
            {borrower.photos.length > 0 ? (
              <ul className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                {borrower.photos.map((item) => (
                  <li key={item.id} className="shrink-0">
                    {/* Фото с нашего же домена: оптимизатор Next здесь лишний. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={api.borrowers.photoUrl(borrower.id, item.id)}
                      alt={item.caption ?? ''}
                      className="h-24 w-36 rounded-lg object-cover"
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          <Card>
            <CardTitle>В контракте</CardTitle>
            <p className="mb-3 text-sm text-muted">
              Все цифры выше берутся отсюда — их можно сверить самому.
              {data.bond
                ? ' Бумага открывается на вкладке расширений: там видно её условия и заморозку счетов держателей.'
                : ''}
            </p>
            <dl className="space-y-3">
              {(data.bond
                ? [
                    ...data.addresses,
                    {
                      label: 'Бумага',
                      address: data.bond.mint,
                      url: data.bond.url,
                    },
                  ]
                : data.addresses
              ).map((item) => (
                <div key={item.label}>
                  <dt className="text-sm text-muted">{item.label}</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    <Copyable value={item.address} short />
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted hover:text-accent"
                    >
                      Обозреватель
                    </a>
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Header({
  data,
  photo,
}: {
  data: CampaignPage;
  photo?: { id: string; caption: string | null };
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={api.borrowers.photoUrl(data.borrower.id, photo.id)}
          alt=""
          className="h-40 w-full object-cover sm:h-56"
        />
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">{data.campaign.title}</h2>
          <p className="text-sm text-muted">{data.borrower.name}</p>
          {data.campaign.purpose ? (
            <p className="mt-2 text-sm">{data.campaign.purpose}</p>
          ) : null}
          {data.campaign.collateral ? (
            <p className="mt-1 text-sm text-muted">
              Обеспечение: {data.campaign.collateral}
            </p>
          ) : null}
        </div>
        <CampaignStatusBadge status={data.status} />
      </div>
    </div>
  );
}

function Row({
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
      <dd className="font-medium">{value}</dd>
      {hint ? <dd className="text-xs text-muted">{hint}</dd> : null}
    </div>
  );
}
