'use client';

import { useQuery } from '@tanstack/react-query';
import { Briefcase } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { FundingBar, TermBar } from '@/components/campaign-bits';
import { CampaignStatusBadge } from '@/components/campaign-bits';
import { DueBreakdown, LoanPicker, LoanSchedule } from '@/components/loan-bits';
import { bpsToPercent, formatDateTime, formatMoney } from '@/components/money';
import {
  buttonStyles,
  Card,
  CardTitle,
  EmptyState,
  Notice,
  StatTile,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { SCHEDULE_KIND_TITLE } from '@/lib/types';

/** Свой заём: условия, состояние долга и график с отметками. */
export function LoanView() {
  const loans = useQuery({ queryKey: ['loans'], queryFn: api.loans.list });
  const [selected, setSelected] = useState('');
  const id = selected || loans.data?.[0]?.id || '';

  const loan = useQuery({
    queryKey: ['loan', id],
    queryFn: () => api.loans.get(id),
    enabled: Boolean(id),
  });

  if (loans.isPending) {
    return <p className="text-sm text-muted">Загружаем займы…</p>;
  }
  if (loans.isError) {
    return <Notice tone="danger" title={(loans.error as ApiError).message} />;
  }
  if (loans.data.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Briefcase size={28} aria-hidden />}
          title="Займов пока нет"
        >
          Кампанию по вашему займу создаёт платформа: она согласует сумму,
          ставку и график, а потом открывает сбор. Как только это случится, заём
          появится здесь.
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <LoanPicker loans={loans.data} value={id} onChange={setSelected} />

      {loan.isPending ? (
        <p className="text-sm text-muted">Читаем состояние из сети…</p>
      ) : loan.isError ? (
        <Notice tone="danger" title={(loan.error as ApiError).message} />
      ) : loan.data ? (
        <LoanDetails data={loan.data} />
      ) : null}
    </div>
  );
}

function LoanDetails({ data }: { data: NonNullable<LoanData> }) {
  const { campaign, deal, due, schedule, now } = data;
  const decimals = campaign.mintDecimals;
  const funding = deal.state === 'funding';

  return (
    <>
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{campaign.title}</h2>
          <CampaignStatusBadge status={data.status} />
        </div>

        {funding ? (
          <>
            <p className="mb-3 text-sm text-muted">
              Сбор ещё идёт: деньги придут на ваш кошелёк, когда платформа его
              закроет. До этого платить нечего.
            </p>
            <FundingBar
              raised={deal.totalRaised}
              softCap={deal.softCap}
              hardCap={deal.hardCap}
              decimals={decimals}
            />
            <p className="mt-2 text-sm text-muted">
              Сбор до {formatDateTime(deal.fundingDeadline)}
            </p>
          </>
        ) : (
          <TermBar
            from={schedule[0]?.dueTs ?? now}
            to={deal.lastDueTs}
            now={now}
          />
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={funding ? 'Собрано' : 'Сумма займа'}
            value={formatMoney(deal.totalRaised, decimals)}
          />
          <StatTile
            label="Ставка"
            value={`${bpsToPercent(campaign.annualRateBps)}%`}
            hint="годовых"
          />
          {funding ? (
            <>
              <StatTile
                label="Минимум сбора"
                value={formatMoney(deal.softCap, decimals)}
                hint="ниже него заём не выдадут"
              />
              <StatTile
                label="Первый платёж"
                value={formatDateTime(schedule[0]?.dueTs)}
                hint="суммы посчитают при закрытии сбора"
              />
            </>
          ) : (
            <>
              <StatTile
                label="Остаток долга"
                value={formatMoney(data.outstanding, decimals)}
                hint="непогашенное тело"
              />
              <StatTile
                label="Отдать всего"
                value={formatMoney(data.totalOutstanding, decimals)}
                hint="с процентами по графику"
              />
            </>
          )}
        </div>

        <dl className="mt-4 grid gap-2 border-t border-border pt-3 text-sm sm:grid-cols-2">
          <Row
            label="Схема"
            value={SCHEDULE_KIND_TITLE[campaign.scheduleKind]}
          />
          <Row label="Платежей в графике" value={String(schedule.length)} />
          <Row
            label="Пеня за просрочку"
            value={`${bpsToPercent(campaign.penaltyRateBps)}% годовых`}
          />
          <Row
            label="Порог дефолта"
            value={`${campaign.defaultThresholdDays} дней просрочки`}
          />
          {campaign.purpose ? (
            <Row label="На что взят" value={campaign.purpose} />
          ) : null}
          {campaign.collateral ? (
            <Row label="Обеспечение" value={campaign.collateral} />
          ) : null}
        </dl>
      </Card>

      {data.recovery ? (
        <Card>
          <CardTitle>Взыскание</CardTitle>
          <Notice tone="danger" title="По займу объявлен дефолт">
            Плановые проценты по ненаступившим платежам отменены, но весь
            остаток тела теперь просрочен: на него идут проценты по ставке займа
            и пеня. Поступления сначала возмещают расходы платформы на
            взыскание, остальное распределяется инвесторам.
          </Notice>
          <dl className="mt-3 space-y-1 text-sm">
            <Line
              label="Тело"
              value={data.recovery.principal}
              decimals={decimals}
            />
            <Line
              label="Проценты"
              value={data.recovery.interest}
              decimals={decimals}
            />
            <Line
              label="Пеня"
              value={data.recovery.penalty}
              decimals={decimals}
            />
            <Line
              label="Расходы на взыскание"
              value={data.recovery.outstanding}
              decimals={decimals}
            />
            <div className="flex justify-between gap-3 border-t border-border pt-2 font-medium">
              <dt>Итого к погашению</dt>
              <dd className="tabular-nums">
                {formatMoney(
                  (
                    BigInt(data.recovery.total) +
                    BigInt(data.recovery.outstanding)
                  ).toString(),
                  decimals,
                )}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-muted">
            Переводите на тот же адрес погашения. Досрочное погашение в дефолте
            недоступно — весь долг и так причитается сразу.
          </p>
        </Card>
      ) : null}

      {!funding && !data.recovery ? (
        <Card>
          <CardTitle>Состояние долга</CardTitle>
          {data.daysPastDue > 0 ? (
            <div className="mb-3">
              <Notice
                tone={
                  data.daysPastDue >= campaign.defaultThresholdDays
                    ? 'danger'
                    : 'warning'
                }
                title={`Просрочка ${data.daysPastDue} дней`}
              >
                На просроченное тело идут проценты по ставке займа и пеня{' '}
                {bpsToPercent(campaign.penaltyRateBps)}% годовых. После{' '}
                {campaign.defaultThresholdDays} дней платформа может объявить
                дефолт.
              </Notice>
            </div>
          ) : null}

          {due.total === '0' ? (
            <p className="text-sm text-muted">
              {data.next
                ? `Сейчас платить нечего. Следующий платёж — ${formatMoney(data.next.total, decimals)} до ${formatDateTime(data.next.dueTs)}.`
                : 'Все платежи по графику закрыты.'}
            </p>
          ) : (
            <>
              <DueBreakdown
                due={due}
                decimals={decimals}
                accruedTo={data.accruedTo}
                now={now}
              />
              <Link
                href="/borrower/pay"
                className={buttonStyles('primary', 'mt-4')}
              >
                Оплатить
              </Link>
            </>
          )}
        </Card>
      ) : null}

      {schedule.length > 0 ? (
        <LoanSchedule periods={schedule} decimals={decimals} />
      ) : null}
    </>
  );
}

type LoanData = Awaited<ReturnType<typeof api.loans.get>> | undefined;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function Line({
  label,
  value,
  decimals,
}: {
  label: string;
  value: string;
  decimals: number;
}) {
  if (value === '0') return null;
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{formatMoney(value, decimals)}</dd>
    </div>
  );
}
