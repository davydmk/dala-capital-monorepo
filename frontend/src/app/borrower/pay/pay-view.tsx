'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, ExternalLink, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Copyable } from '@/components/copyable';
import { DueBreakdown, LoanPicker } from '@/components/loan-bits';
import { formatDateTime, formatMoney } from '@/components/money';
import {
  Button,
  Card,
  CardTitle,
  EmptyState,
  Notice,
  StatTile,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { LoanPage } from '@/lib/types';
import { PrepayBlock } from './prepay-block';

/** Пока экран открыт, остаток на адресе погашения перечитывается. */
const POLL_MS = 10_000;

/** Оплата займа: адрес погашения, сумма к оплате, «Я перевёл». */
export function PayView() {
  const client = useQueryClient();
  const loans = useQuery({ queryKey: ['loans'], queryFn: api.loans.list });
  const [selected, setSelected] = useState('');

  // Платить есть по чему только у выданных займов.
  const payable = (loans.data ?? []).filter(
    (loan) => loan.status !== 'FUNDING' && loan.status !== 'FAILED',
  );
  const id = selected || payable[0]?.id || '';

  const loan = useQuery({
    queryKey: ['loan', id],
    queryFn: () => api.loans.get(id),
    enabled: Boolean(id),
    refetchInterval: POLL_MS,
  });

  const save = (data: LoanPage) => client.setQueryData(['loan', id], data);
  const repay = useMutation<LoanPage, ApiError, void>({
    mutationFn: () => api.loans.repay(id),
    onSuccess: save,
  });
  const advance = useMutation<LoanPage, ApiError, void>({
    mutationFn: () => api.loans.advance(id),
    onSuccess: save,
  });

  if (loans.isPending) {
    return <p className="text-sm text-muted">Загружаем займы…</p>;
  }
  if (loans.isError) {
    return <Notice tone="danger" title={(loans.error as ApiError).message} />;
  }
  if (payable.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Banknote size={28} aria-hidden />}
          title="Платить пока нечего"
        >
          Платежи начинаются после того, как платформа закроет сбор и деньги
          придут на ваш кошелёк. Тогда здесь появится адрес погашения и сумма.
        </EmptyState>
      </Card>
    );
  }

  const data = loan.data;
  const decimals = data?.campaign.mintDecimals ?? 6;
  const result = repay.data?.result ?? advance.data?.result;

  return (
    <div className="space-y-4">
      <LoanPicker loans={payable} value={id} onChange={setSelected} />

      {loan.isPending ? (
        <p className="text-sm text-muted">Читаем состояние из сети…</p>
      ) : loan.isError ? (
        <Notice tone="danger" title={(loan.error as ApiError).message} />
      ) : data ? (
        <>
          <Card>
            <CardTitle>Сколько платить</CardTitle>
            {data.due.total === '0' ? (
              <p className="text-sm text-muted">
                {data.next
                  ? `Сейчас платить нечего. Следующий платёж — ${formatMoney(data.next.total, decimals)} до ${formatDateTime(data.next.dueTs)}. Перевести можно заранее: деньги дождутся даты на адресе погашения.`
                  : 'Все платежи по графику закрыты.'}
              </p>
            ) : (
              <DueBreakdown
                due={data.due}
                decimals={decimals}
                accruedTo={data.accruedTo}
                now={data.now}
              />
            )}
          </Card>

          <Card>
            <CardTitle>Адрес погашения</CardTitle>
            <p className="mb-3 text-sm text-muted">
              Адрес принадлежит этому займу и не меняется. Переводите на него
              ровно тот токен, который принимает кампания, и только в сети
              Solana.
            </p>
            <div className="mb-3 rounded-lg border border-border p-3">
              <Copyable value={data.repay.address} />
            </div>
            <Notice tone="warning" title="Не со всякой биржи он примет перевод">
              Binance, Coinbase, OKX, Kraken выводят на такой адрес. Bybit и
              Bitget — нет: с них сначала выведите на свой кошелёк, а уже с него
              переводите сюда.
            </Notice>
            <a
              href={data.repay.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-sm text-muted hover:text-accent"
            >
              Посмотреть в обозревателе <ExternalLink size={14} aria-hidden />
            </a>

            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
              <StatTile
                label="Ждёт на адресе"
                value={formatMoney(data.repay.balance, decimals)}
              />
              <StatTile
                label="К оплате сейчас"
                value={formatMoney(data.due.total, decimals)}
              />
            </div>

            {result ? (
              <div className="mt-3">
                <Notice tone="info" title={result.message}>
                  {result.received !== '0'
                    ? `Зачтено ${formatMoney(result.received, decimals)}`
                    : undefined}
                </Notice>
              </div>
            ) : null}
            {repay.isError ? (
              <div className="mt-3">
                <Notice tone="danger" title={repay.error.message} />
              </div>
            ) : null}
            {advance.isError ? (
              <div className="mt-3">
                <Notice tone="danger" title={advance.error.message} />
              </div>
            ) : null}

            <p className="mt-3 text-sm text-muted">
              Пока эта страница открыта, платформа проверяет адрес каждые
              несколько секунд. Если вы её закроете, деньги никуда не денутся —
              вернитесь сюда после перевода и нажмите «Я перевёл».
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button loading={repay.isPending} onClick={() => repay.mutate()}>
                <RefreshCw size={16} aria-hidden /> Я перевёл
              </Button>
            </div>
          </Card>

          <PrepayBlock id={id} data={data} onDone={save} />

          {data.repay.advance !== '0' ? (
            <Card>
              <CardTitle>Излишек на адресе</CardTitle>
              <p className="text-sm text-muted">
                На адресе лежит {formatMoney(data.repay.advance, decimals)}{' '}
                сверх того, что причитается сейчас. Эти деньги просто ждут
                следующего платежа — ничего делать не нужно.
              </p>
              <p className="mt-2 text-sm text-muted">
                Излишек можно зачесть авансом — тогда он закроет ближайшие
                платежи графика досрочно. Общую сумму процентов это не
                уменьшает: проценты считаются от остатка тела, а зачёт тело не
                трогает — он лишь оплачивает платежи раньше срока. Уменьшает
                долг только досрочное погашение.
              </p>
              <Button
                className="mt-3"
                variant="ghost"
                loading={advance.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Зачесть ${formatMoney(data.repay.advance, decimals)} в счёт будущих платежей?`,
                    )
                  ) {
                    advance.mutate();
                  }
                }}
              >
                Зачесть авансом
              </Button>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
