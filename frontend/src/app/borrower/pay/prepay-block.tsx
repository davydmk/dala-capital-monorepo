'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarClock, Scissors } from 'lucide-react';
import { useState } from 'react';
import {
  bpsToPercent,
  formatDateTime,
  formatMoney,
  toMicro,
} from '@/components/money';
import { Button, Card, CardTitle, Field, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { LoanPage, PartialPrepayBlock } from '@/lib/types';

/** Почему окно частичного погашения закрыто — словами, а не кодом. */
const BLOCK_TITLE: Record<PartialPrepayBlock, string> = {
  NOT_ALLOWED: 'Условия займа не предусматривают досрочного погашения',
  NOT_ACTIVE: 'Заём ещё не выдан или уже закрыт',
  NOT_PAYMENT_DATE: 'Частично погасить тело можно только в дату платежа',
  HAS_OVERDUE: 'Сначала нужно закрыть просрочку обычным платежом',
  HAS_ADVANCE: 'По займу есть аванс: пока он не зачтён графиком, нельзя',
  LAST_PERIOD: 'Остался последний платёж — его гасят целиком',
};

/**
 * Досрочное погашение. Контракт забирает с адреса ровно посчитанную сумму и
 * отказывает, если её там нет, поэтому порядок тот же, что при обычном
 * платеже: сначала перевод с запасом, потом кнопка.
 */
export function PrepayBlock({
  id,
  data,
  onDone,
}: {
  id: string;
  data: LoanPage;
  onDone: (page: LoanPage) => void;
}) {
  const decimals = data.campaign.mintDecimals;
  const { prepayment } = data;

  if (!prepayment.allowed) {
    return (
      <Card>
        <CardTitle>Досрочное погашение</CardTitle>
        <p className="text-sm text-muted">
          Условия этого займа досрочного погашения не предусматривают: тело
          возвращается последним платежом, и пересчитывать нечего.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>Досрочное погашение</CardTitle>
      <p className="mb-4 text-sm text-muted">
        {prepayment.feeBps > 0
          ? `Комиссия за досрочное погашение — ${bpsToPercent(prepayment.feeBps)}% от погашаемого тела; её получают инвесторы в возмещение недополученных процентов.`
          : 'Комиссии за досрочное погашение по этому займу нет.'}{' '}
        Деньги сначала переводятся на адрес погашения, и только потом нажимается
        кнопка: платформа забирает ровно посчитанную сумму.
      </p>

      <Full id={id} data={data} decimals={decimals} onDone={onDone} />

      <div className="mt-6 border-t border-border pt-4">
        <Partial id={id} data={data} decimals={decimals} onDone={onDone} />
      </div>
    </Card>
  );
}

// ── Полное ─────────────────────────────────────────────────────────────────

function Full({
  id,
  data,
  decimals,
  onDone,
}: {
  id: string;
  data: LoanPage;
  decimals: number;
  onDone: (page: LoanPage) => void;
}) {
  const quote = data.prepayment.full;
  const pay = useMutation<LoanPage, ApiError, void>({
    mutationFn: () => api.loans.prepayFull(id),
    onSuccess: onDone,
  });

  if (!quote) return null;
  const enough = BigInt(data.repay.balance) >= BigInt(quote.total);

  return (
    <div>
      <p className="mb-2 text-sm font-medium">Закрыть заём целиком</p>
      <dl className="space-y-1 text-sm">
        {(
          [
            ['Просрочка и пеня', quote.overdue],
            ['Проценты за текущий период', quote.currentInterest],
            ['Остаток тела', quote.remainingPrincipal],
            ['Комиссия за досрочное', quote.fee],
          ] as [string, string][]
        )
          .filter(([, value]) => value !== '0')
          .map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted">{label}</dt>
              <dd className="tabular-nums">{formatMoney(value, decimals)}</dd>
            </div>
          ))}
        <div className="flex justify-between gap-3 border-t border-border pt-2 font-medium">
          <dt>Нужно перевести</dt>
          <dd className="tabular-nums">{formatMoney(quote.total, decimals)}</dd>
        </div>
      </dl>

      <p className="mt-2 text-xs text-muted">
        Проценты идут за фактическое время, поэтому сумма растёт с каждым днём.
        Переводите с небольшим запасом — излишек останется на адресе погашения.
      </p>

      {pay.isError ? (
        <div className="mt-3">
          <Notice tone="danger" title={pay.error.message} />
        </div>
      ) : null}

      <Button
        className="mt-3"
        disabled={!enough}
        loading={pay.isPending}
        onClick={() => {
          if (
            window.confirm(
              `Закрыть заём досрочно за ${formatMoney(quote.total, decimals)}?`,
            )
          ) {
            pay.mutate();
          }
        }}
      >
        <CalendarClock size={16} aria-hidden /> Погасить целиком
      </Button>
      {!enough ? (
        <p className="mt-2 text-xs text-muted">
          На адресе погашения {formatMoney(data.repay.balance, decimals)} —
          переведите недостающее, и кнопка станет активной.
        </p>
      ) : null}
    </div>
  );
}

// ── Частичное ──────────────────────────────────────────────────────────────

function Partial({
  id,
  data,
  decimals,
  onDone,
}: {
  id: string;
  data: LoanPage;
  decimals: number;
  onDone: (page: LoanPage) => void;
}) {
  const [amount, setAmount] = useState('');
  const { partial } = data.prepayment;
  const micro = amount ? toMicro(amount) : '0';
  const valid =
    partial.open &&
    micro !== '0' &&
    BigInt(micro) > 0n &&
    BigInt(micro) <= BigInt(partial.maxAmount);

  const quote = useQuery({
    queryKey: ['prepay-quote', id, micro],
    queryFn: () => api.loans.prepayQuote(id, micro),
    enabled: valid,
  });

  const pay = useMutation<LoanPage, ApiError, void>({
    mutationFn: () => api.loans.prepayPartial(id, micro),
    onSuccess: (page) => {
      setAmount('');
      onDone(page);
    },
  });

  return (
    <div>
      <p className="mb-2 text-sm font-medium">Погасить часть тела</p>
      <p className="mb-3 text-sm text-muted">
        Даты и число платежей не меняются — уменьшается их размер: тело
        оставшихся платежей пересчитывается пропорционально, а проценты идут уже
        от нового остатка.
      </p>

      {!partial.open ? (
        <Notice
          tone="info"
          title={BLOCK_TITLE[partial.block ?? 'NOT_PAYMENT_DATE']}
        >
          {partial.opensAt
            ? `Окно откроется ${formatDateTime(partial.opensAt)} и будет открыто сутки.`
            : undefined}
        </Notice>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            Окно открыто до {formatDateTime(partial.closesAt)}. Больше{' '}
            {formatMoney(partial.maxAmount, decimals)} гасить нельзя — это уже
            полное погашение.
          </p>
          <Field
            label="Сумма тела"
            inputMode="decimal"
            placeholder="0,00"
            hint={`не больше ${formatMoney(partial.maxAmount, decimals)}`}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />

          {quote.data ? (
            <div className="mt-3 rounded-lg border border-border p-3">
              <dl className="space-y-1 text-sm">
                <Line
                  label="Сегодняшний платёж"
                  value={quote.data.due}
                  decimals={decimals}
                />
                <Line
                  label="Досрочно тела"
                  value={quote.data.principal}
                  decimals={decimals}
                />
                <Line
                  label="Комиссия"
                  value={quote.data.fee}
                  decimals={decimals}
                />
                <div className="flex justify-between gap-3 border-t border-border pt-2 font-medium">
                  <dt>Нужно перевести</dt>
                  <dd className="tabular-nums">
                    {formatMoney(quote.data.total, decimals)}
                  </dd>
                </div>
              </dl>

              <p className="mt-3 mb-2 text-sm font-medium">
                Платежи станут такими
              </p>
              <ul className="space-y-1 text-sm">
                {quote.data.periods.map((period) => (
                  <li
                    key={period.index}
                    className="flex justify-between gap-3 tabular-nums"
                  >
                    <span className="text-muted">
                      {period.index}. {formatDateTime(period.dueTs)}
                    </span>
                    <span>
                      <span className="text-muted line-through">
                        {formatMoney(period.was, decimals)}
                      </span>{' '}
                      {formatMoney(period.total, decimals)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-accent">
                Процентов не придётся платить на{' '}
                {formatMoney(quote.data.saved, decimals)}
              </p>
            </div>
          ) : null}

          {quote.isError ? (
            <div className="mt-3">
              <Notice
                tone="warning"
                title={(quote.error as ApiError).message}
              />
            </div>
          ) : null}
          {pay.isError ? (
            <div className="mt-3">
              <Notice tone="danger" title={pay.error.message} />
            </div>
          ) : null}

          <Button
            className="mt-3"
            variant="secondary"
            disabled={!quote.data}
            loading={pay.isPending}
            onClick={() => {
              if (
                quote.data &&
                window.confirm(
                  `Погасить ${formatMoney(quote.data.principal, decimals)} тела досрочно? С адреса уйдёт ${formatMoney(quote.data.total, decimals)}.`,
                )
              ) {
                pay.mutate();
              }
            }}
          >
            <Scissors size={16} aria-hidden /> Погасить часть
          </Button>
        </>
      )}
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
