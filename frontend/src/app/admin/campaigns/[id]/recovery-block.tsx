'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Gavel, Receipt } from 'lucide-react';
import { useState } from 'react';
import { formatMoney, toMicro } from '@/components/money';
import { Button, Card, CardTitle, Field, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { OnchainDeal } from '@/lib/types';

/**
 * Взыскание. Дефолт объявляется, когда просрочка достигла порога — контракт
 * пускает сюда кого угодно и проверяет порог сам, так что платформа тут не
 * привратник, а исполнитель.
 *
 * В дефолте порядок учёта важнее интерфейса: поступление сначала возмещает
 * расходы на взыскание и лишь потом идёт в долг, поэтому расходы вносятся
 * **до** проведения возврата.
 */
export function RecoveryBlock({
  id,
  deal,
  decimals,
  threshold,
}: {
  id: string;
  deal: OnchainDeal;
  decimals: number;
  /** Порог дефолта в днях из условий кампании. */
  threshold: number;
}) {
  const client = useQueryClient();
  const [cost, setCost] = useState('');

  const save = (data: OnchainDeal) => {
    client.setQueryData(['campaign-onchain', id], data);
    setCost('');
  };
  const markDefault = useMutation<OnchainDeal, ApiError, void>({
    mutationFn: () => api.campaigns.markDefault(id),
    onSuccess: save,
  });
  const recordCost = useMutation<OnchainDeal, ApiError, string>({
    mutationFn: (amount) => api.campaigns.recoveryCost(id, amount),
    onSuccess: save,
  });
  const payment = useMutation<OnchainDeal, ApiError, void>({
    mutationFn: () => api.campaigns.recoveryPayment(id),
    onSuccess: save,
  });

  const defaulted = deal.state === 'default';
  const reached = deal.daysPastDue >= threshold;
  const outstanding =
    BigInt(deal.recoveryCosts) - BigInt(deal.recoveryReimbursed);

  return (
    <Card>
      <CardTitle>Взыскание</CardTitle>

      {defaulted ? (
        <Notice tone="danger" title="Объявлен дефолт">
          Плановые проценты ненаступивших платежей отменены, весь остаток тела
          переведён в просрочку. Поступления сначала возмещают расходы на
          взыскание, остальное распределяется инвесторам.
        </Notice>
      ) : (
        <Notice
          tone={reached ? 'warning' : 'info'}
          title={
            deal.daysPastDue > 0
              ? `Просрочка ${deal.daysPastDue} дней из ${threshold} до дефолта`
              : 'Просрочки нет'
          }
        >
          {reached
            ? 'Порог достигнут: дефолт можно объявлять. Контракт проверит порог ещё раз.'
            : 'Дефолт объявляется только после порога — так устроен контракт.'}
        </Notice>
      )}

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        {defaulted ? (
          <>
            <Row
              label="Тело в дефолте"
              value={formatMoney(deal.defaultPrincipal, decimals)}
            />
            <Row
              label="Проценты"
              value={formatMoney(deal.defaultInterest, decimals)}
            />
          </>
        ) : (
          <Row
            label="Просроченное тело"
            value={formatMoney(deal.overduePrincipal, decimals)}
          />
        )}
        <Row label="Пеня" value={formatMoney(deal.penalty, decimals)} />
        <Row
          label="Расходы на взыскание"
          value={`${formatMoney(deal.recoveryCosts, decimals)} · не возмещено ${formatMoney(outstanding.toString(), decimals)}`}
        />
      </dl>

      {markDefault.isError ? (
        <div className="mt-3">
          <Notice tone="danger" title={markDefault.error.message} />
        </div>
      ) : null}

      {!defaulted ? (
        <Button
          className="mt-3"
          variant="danger"
          disabled={!reached}
          loading={markDefault.isPending}
          onClick={() => {
            if (
              window.confirm(
                'Объявить дефолт? Плановые проценты ненаступивших платежей будут отменены, а весь остаток тела перейдёт во взыскание.',
              )
            ) {
              markDefault.mutate();
            }
          }}
        >
          <Gavel size={16} aria-hidden /> Объявить дефолт
        </Button>
      ) : (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          <div>
            <p className="mb-2 text-sm font-medium">Расходы на взыскание</p>
            <p className="mb-3 text-sm text-muted">
              Вносятся после того, как платформа их фактически оплатила: юрист,
              госпошлина, оценка. Суммы складываются, и ближайшие поступления
              возместят их раньше, чем пойдут инвесторам.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <Field
                label="Сумма"
                inputMode="decimal"
                placeholder="0,00"
                className="min-w-40"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
              />
              <Button
                variant="secondary"
                disabled={!cost || toMicro(cost) === '0'}
                loading={recordCost.isPending}
                onClick={() => recordCost.mutate(toMicro(cost))}
              >
                <Receipt size={16} aria-hidden /> Записать
              </Button>
            </div>
            {recordCost.isError ? (
              <div className="mt-3">
                <Notice tone="danger" title={recordCost.error.message} />
              </div>
            ) : null}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Поступление по взысканию</p>
            <p className="mb-3 text-sm text-muted">
              Заберёт всё, что лежит на адресе погашения: сначала возмещение
              расходов в казну, остальное — инвесторам.
            </p>
            <Button
              variant="secondary"
              loading={payment.isPending}
              onClick={() => payment.mutate()}
            >
              Провести поступление
            </Button>
            {payment.isError ? (
              <div className="mt-3">
                <Notice tone="danger" title={payment.error.message} />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Card>
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
