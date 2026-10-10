'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Landmark } from 'lucide-react';
import { useState } from 'react';
import { Copyable } from '@/components/copyable';
import { formatDateTime, formatMoney } from '@/components/money';
import {
  Button,
  Card,
  CardTitle,
  Checkbox,
  Notice,
  Select,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { OnchainDeal, ScheduleKind } from '@/lib/types';
import { words } from '@/lib/wording';

/**
 * Закрытие сбора. Одна инструкция контракта решает обе судьбы кампании:
 * при собранном минимуме деньги уходят заёмщику, иначе кампания становится
 * несостоявшейся и инвесторы забирают взносы обратно.
 *
 * Перевод необратим, поэтому здесь видно, сколько и куда уйдёт, а кнопка
 * открывается только после того, как админ подтвердил адрес получения.
 */
export function ClosingBlock({
  id,
  deal,
  decimals,
  scheduleKind,
}: {
  id: string;
  deal: OnchainDeal;
  decimals: number;
  scheduleKind: ScheduleKind;
}) {
  // У кредита это закрытие сбора, у облигации — подведение итогов размещения.
  const w = words(scheduleKind);
  const bond = scheduleKind === 'COUPON';
  const client = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const [walletId, setWalletId] = useState('');

  const save = (data: OnchainDeal) => {
    client.setQueryData(['campaign-onchain', id], data);
    setConfirmed(false);
  };
  const close = useMutation<OnchainDeal, ApiError, void>({
    mutationFn: () => api.campaigns.close(id),
    onSuccess: save,
  });
  const cancel = useMutation<OnchainDeal, ApiError, void>({
    mutationFn: () => api.campaigns.cancel(id),
    onSuccess: save,
  });
  const changeWallet = useMutation<OnchainDeal, ApiError, string>({
    mutationFn: (wallet) => api.campaigns.setBorrowerWallet(id, wallet),
    onSuccess: save,
  });

  const { closing } = deal;
  const current = closing.wallets.find((wallet) => wallet.current);
  const others = closing.wallets.filter((wallet) => !wallet.current);
  const failing = closing.willFail;

  return (
    <Card>
      <CardTitle>{bond ? 'Итоги размещения' : 'Закрытие сбора'}</CardTitle>

      {closing.block ? (
        <Notice tone="info" title={closing.block}>
          {bond ? 'Итоги подводятся' : 'Сбор закрывается'} после{' '}
          {formatDateTime(deal.fundingDeadline)}. Начало графика платежей —
          дедлайн, а не момент закрытия: задержка не сдвигает даты.
        </Notice>
      ) : failing ? (
        <Notice tone="warning" title={`${w.softCap} не набран`}>
          {bond
            ? 'Размещение будет признано несостоявшимся. Деньги останутся в волте, и каждый держатель заберёт свою заявку сам — платформа их не распределяет.'
            : 'Закрытие отправит кампанию в несостоявшийся сбор. Деньги останутся в волте, и каждый инвестор заберёт свой взнос сам — платформа их не распределяет.'}
        </Notice>
      ) : (
        <Notice tone="warning" title="Перевод необратим">
          Собранные деньги уйдут одной транзакцией и вернуть их платформа не
          сможет. Убедитесь, что адрес получения у заёмщика рабочий.
        </Notice>
      )}

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <Row label={w.raised} value={formatMoney(deal.totalRaised, decimals)} />
        <Row
          label="Комиссия платформы"
          value={formatMoney(closing.platformFee, decimals)}
        />
        <Row
          label="Уйдёт заёмщику"
          value={formatMoney(closing.payoutAmount, decimals)}
        />
        <Row
          label="Кошелёк получения"
          value={current ? `${current.label}` : 'не из списка заёмщика'}
        />
      </dl>

      <div className="mt-3 rounded-lg border border-border p-3">
        <Copyable value={deal.borrowerWallet} />
      </div>

      {!failing ? (
        <Checkbox
          className="mt-3"
          label="Кошелёк заёмщика подтверждён"
          hint="Заёмщик подтвердил, что этот адрес принимает переводы и доступ к нему есть."
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
      ) : null}

      {close.isError ? (
        <div className="mt-3">
          <Notice tone="danger" title={close.error.message} />
        </div>
      ) : null}

      <Button
        className="mt-3"
        variant={failing ? 'secondary' : 'primary'}
        disabled={Boolean(closing.block) || (!failing && !confirmed)}
        loading={close.isPending}
        onClick={() => {
          if (
            window.confirm(
              failing
                ? bond
                  ? 'Признать размещение несостоявшимся? Держатели получат заявки обратно.'
                  : 'Закрыть сбор как несостоявшийся? Инвесторы получат взносы обратно.'
                : `Перевести ${formatMoney(closing.payoutAmount, decimals)} на кошелёк заёмщика? Отменить это нельзя.`,
            )
          ) {
            close.mutate();
          }
        }}
      >
        <Landmark size={16} aria-hidden />
        {failing
          ? bond
            ? 'Признать размещение несостоявшимся'
            : 'Закрыть сбор как несостоявшийся'
          : w.close}
      </Button>

      <div className="mt-6 border-t border-border pt-4">
        <p className="mb-2 text-sm font-medium">
          {bond ? 'Отменить размещение' : 'Отменить сбор'}
        </p>
        <p className="mb-3 text-sm text-muted">
          Нужна, когда перевести деньги заёмщику невозможно — например, счёт
          заморожен эмитентом стейблкоина. Кампания станет несостоявшейся, и
          каждый инвестор заберёт свой взнос сам.
        </p>
        {deal.cancelBlock ? (
          <Notice tone="info" title={deal.cancelBlock} />
        ) : (
          <Button
            variant="danger"
            loading={cancel.isPending}
            onClick={() => {
              if (
                window.confirm(
                  'Отменить сбор? Кампания станет несостоявшейся, вернуть её будет нельзя.',
                )
              ) {
                cancel.mutate();
              }
            }}
          >
            <Ban size={16} aria-hidden /> Отменить сбор
          </Button>
        )}
        {cancel.isError ? (
          <div className="mt-3">
            <Notice tone="danger" title={cancel.error.message} />
          </div>
        ) : null}
      </div>

      {others.length > 0 ? (
        <div className="mt-6 border-t border-border pt-4">
          <p className="mb-2 text-sm font-medium">Сменить кошелёк получения</p>
          <p className="mb-3 text-sm text-muted">
            Пока сбор не закрыт, адрес ещё можно поменять — на случай, когда
            заёмщик потерял доступ к кошельку или биржа сменила депозитный
            адрес. Выбрать можно только из списка кошельков заёмщика.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Кошелёк"
              className="min-w-52"
              value={walletId}
              onChange={(event) => setWalletId(event.target.value)}
            >
              <option value="">Выберите адрес</option>
              {others.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>
                  {wallet.label} — {wallet.address.slice(0, 8)}…
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              disabled={!walletId}
              loading={changeWallet.isPending}
              onClick={() => changeWallet.mutate(walletId)}
            >
              Сменить
            </Button>
          </div>
          {changeWallet.isError ? (
            <div className="mt-3">
              <Notice tone="danger" title={changeWallet.error.message} />
            </div>
          ) : null}
        </div>
      ) : null}
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
