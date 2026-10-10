'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  ExternalLink,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Copyable } from '@/components/copyable';
import { formatDateTime, formatMoney } from '@/components/money';
import {
  Button,
  buttonStyles,
  Card,
  CardTitle,
  Notice,
  StatTile,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { words } from '@/lib/wording';
import type { DepositState } from '@/lib/types';

/** Пока экран открыт, состояние адреса перечитывается — но только этого одного. */
const POLL_MS = 10_000;

export function DepositView({ id }: { id: string }) {
  const client = useQueryClient();
  const state = useQuery({
    queryKey: ['deposit', id],
    queryFn: () => api.invest.deposit(id),
    refetchInterval: POLL_MS,
  });

  const open = useMutation<DepositState, ApiError, void>({
    mutationFn: () => api.invest.open(id),
    onSuccess: (data) => client.setQueryData(['deposit', id], data),
  });
  const credit = useMutation<DepositState, ApiError, boolean>({
    mutationFn: (claimed) => api.invest.credit(id, claimed),
    onSuccess: (data) => client.setQueryData(['deposit', id], data),
  });
  const withdraw = useMutation<DepositState, ApiError, void>({
    mutationFn: () => api.invest.withdraw(id),
    onSuccess: (data) => client.setQueryData(['deposit', id], data),
  });
  // Возврат взноса у несостоявшегося сбора — тот же вывод, что и в портфеле.
  const refund = useMutation<unknown, ApiError, void>({
    mutationFn: () => api.invest.claim(id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['deposit', id] });
      await client.invalidateQueries({ queryKey: ['campaign', id] });
    },
  });

  // Деньги пришли и зачислить их можно — делаем это сами, один раз на поступление.
  const creditedFor = useRef('');
  const data = state.data;
  useEffect(() => {
    if (!data?.deposit || data.participationBlock) return;
    const ready = data.creditable !== '0' && !data.block;
    if (!ready || credit.isPending || creditedFor.current === data.pending) {
      return;
    }
    creditedFor.current = data.pending;
    credit.mutate(false);
  }, [data, credit]);

  if (state.isPending) {
    return <p className="text-sm text-muted">Загружаем кампанию…</p>;
  }
  if (state.isError) {
    return <Notice tone="danger" title={(state.error as ApiError).message} />;
  }

  const {
    campaign,
    deal,
    deposit,
    block,
    result,
    participationBlock,
    fundingOver,
  } = state.data;
  // Сбор перестаёт принимать деньги на дедлайне, а закрывает его оператор
  // позже: в этом промежутке перевод уже не зачтётся и просто зависнет.
  const closed = fundingOver;
  const failed = deal.state === 'failed';
  const decimals = campaign.mintDecimals;
  // У облигации это не пополнение, а заявка на участие в размещении.
  const bond = campaign.scheduleKind === 'COUPON';
  const w = words(campaign.scheduleKind);
  // У облигации взнос — целое число бумаг: предупреждаем до перевода, а не после.
  const lot =
    campaign.scheduleKind === 'COUPON' && campaign.faceValue
      ? campaign.faceValue
      : null;

  return (
    <div className="space-y-4">
      {failed ? (
        <Notice
          tone="warning"
          title={bond ? 'Размещение не состоялось' : 'Сбор не состоялся'}
        >
          Нужную сумму собрать не удалось, заём не выдан.{' '}
          {bond ? 'Ваша заявка возвращается' : 'Ваш взнос возвращается'} целиком
          — заберите {bond ? 'её' : 'его'} кнопкой ниже или на странице
          портфеля. Если на адресе что-то осталось, забирайте и это.
        </Notice>
      ) : closed ? (
        <Notice
          tone="warning"
          title={bond ? 'Размещение закончилось' : 'Сбор завершён'}
        >
          {bond
            ? 'Заявки больше не принимаются'
            : 'Взносы больше не принимаются'}
          : срок вышел. Если на вашем адресе остались деньги, заберите их — они
          уже не попадут {bond ? 'в выпуск' : 'в кампанию'}.
        </Notice>
      ) : null}

      {failed && state.data.invested !== '0' ? (
        <Card>
          <CardTitle>{bond ? 'Возврат заявки' : 'Возврат взноса'}</CardTitle>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <StatTile
              label="К возврату"
              value={formatMoney(state.data.invested, decimals)}
            />
            <StatTile label="Куда" value="на ваш адрес вывода" />
          </div>
          {refund.isError ? (
            <Notice tone="danger" title={refund.error.message} />
          ) : null}
          <Button loading={refund.isPending} onClick={() => refund.mutate()}>
            {bond ? 'Забрать заявку' : 'Забрать взнос'}
          </Button>
        </Card>
      ) : null}

      {participationBlock ? (
        <Card>
          <CardTitle>Как вложиться</CardTitle>
          <Notice tone="warning" title={participationBlock}>
            Смотреть кампании можно свободно, а вкладывать — после проверки
            личности: этого требует допуск инвестора в контракте.
          </Notice>
          <Link
            href="/investor/verification"
            className={buttonStyles('primary', 'mt-3')}
          >
            Пройти проверку <ArrowRight size={16} aria-hidden />
          </Link>
        </Card>
      ) : !deposit ? (
        <Card>
          <CardTitle>Как вложиться</CardTitle>
          <p className="mb-3 text-sm text-muted">
            {closed
              ? bond
                ? 'Размещение закончилось, адрес для заявки больше не открывается: переведённые деньги в выпуск уже не попадут.'
                : 'Сбор по этой кампании закончился, адрес пополнения больше не открывается: переведённые деньги в неё уже не попадут.'
              : bond
                ? 'Платформа откроет вам персональный адрес для заявки на этот выпуск. Подключать кошелёк не нужно: вы переводите на него токены, а дальше всё делает платформа.'
                : 'Платформа откроет вам персональный адрес в этой кампании. Подключать кошелёк не нужно: вы просто переводите на него токены, а зачисление платформа делает сама.'}
          </p>
          {open.isError ? (
            <Notice tone="danger" title={open.error.message} />
          ) : null}
          <Button
            className="mt-3"
            disabled={closed}
            loading={open.isPending}
            onClick={() => open.mutate()}
          >
            <Wallet size={16} aria-hidden /> {w.openDeposit}
          </Button>
        </Card>
      ) : (
        <>
          {/* Адрес и результат перевода — про одно и то же, поэтому в одной карточке. */}
          <Card>
            <CardTitle>{bond ? 'Заявка' : 'Пополнение'}</CardTitle>
            <p className="mb-3 text-sm text-muted">
              Этот адрес только ваш и только для{' '}
              {bond ? 'этого выпуска' : 'этой кампании'}. Переводите на него
              ровно тот токен, который здесь принимают, и только в сети Solana.
            </p>
            <div className="mb-3 rounded-lg border border-border p-3">
              <Copyable value={deposit.owner} />
            </div>
            {lot ? (
              <div className="mb-3">
                <Notice
                  title={`Облигация продаётся лотами по ${formatMoney(lot, decimals)}`}
                >
                  Это номинал одной бумаги. Переводите сумму, кратную ему:
                  остаток бумагой не оформится и будет ждать на адресе, пока вы
                  не доплатите до следующего лота или не заберёте его.
                </Notice>
              </div>
            ) : null}
            <Notice tone="warning" title="Не со всякой биржи он примет перевод">
              Binance, Coinbase, OKX, Kraken выводят на такой адрес. Bybit и
              Bitget — нет: с них сначала выведите на свой кошелёк, а уже с него
              переводите сюда.
            </Notice>
            <a
              href={deposit.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-sm text-muted hover:text-accent"
            >
              Посмотреть в обозревателе <ExternalLink size={14} aria-hidden />
            </a>

            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
              <StatTile
                label={bond ? 'Принято в выпуск' : 'Зачислено в кампанию'}
                value={formatMoney(state.data.invested, decimals)}
              />
              <StatTile
                label="Ждёт на адресе"
                value={formatMoney(state.data.pending, decimals)}
              />
            </div>

            {block ? (
              <div className="mt-3">
                <Notice tone="warning" title={block.reason} />
              </div>
            ) : null}

            {result ? (
              <div className="mt-3">
                <Notice
                  tone={result.credited === '0' ? 'info' : 'info'}
                  title={result.message}
                >
                  {result.credited !== '0'
                    ? `Зачислено ${formatMoney(result.credited, decimals)}`
                    : undefined}
                </Notice>
              </div>
            ) : null}

            <p className="mt-3 text-sm text-muted">
              Пока эта страница открыта, платформа проверяет адрес каждые
              несколько секунд. Если вы закроете её, деньги никуда не денутся —
              вернитесь сюда после перевода и нажмите «Я перевёл».
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                loading={credit.isPending}
                onClick={() => credit.mutate(true)}
              >
                <RefreshCw size={16} aria-hidden /> Я перевёл
              </Button>
              {state.data.pending !== '0' ? (
                <Button
                  variant="secondary"
                  loading={withdraw.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Вернуть остаток с адреса пополнения на ваш адрес вывода?',
                      )
                    ) {
                      withdraw.mutate();
                    }
                  }}
                >
                  Забрать остаток
                </Button>
              ) : null}
            </div>

            {credit.isError ? (
              <div className="mt-3">
                <Notice tone="danger" title={credit.error.message} />
              </div>
            ) : null}
            {withdraw.isError ? (
              <div className="mt-3">
                <Notice tone="danger" title={withdraw.error.message} />
              </div>
            ) : null}

            {state.data.credits.length > 0 ? (
              <ul className="mt-4 divide-y divide-border border-t border-border pt-2 text-sm">
                {state.data.credits.map((item) => (
                  <li
                    key={item.url}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Check size={16} aria-hidden className="text-accent" />
                      {formatMoney(item.amount, decimals)}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-muted">
                      {formatDateTime(item.createdAt)}
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-accent"
                      >
                        Обозреватель
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}
