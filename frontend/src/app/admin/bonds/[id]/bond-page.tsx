'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Flame } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import clsx from 'clsx';
import {
  ActionCodes,
  ActionKindTitle,
  nextStep,
  ActionSteps,
  ActionStatusBadge,
  BondStatusBadge,
  shortHash,
} from '@/components/bond-bits';
import { Copyable } from '@/components/copyable';
import {
  bpsToPercent,
  formatDateTime,
  formatMoney,
  fromLocalInput,
  toLocalInput,
  toMicro,
} from '@/components/money';
import {
  Button,
  Card,
  CardTitle,
  Field,
  Notice,
  Select,
  StatTile,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { ACTION_KIND_TITLE, type ActionKind, type BondPage } from '@/lib/types';

/** Какие действия админ объявляет руками. Дефолт и взыскание пишутся сами. */
const DECLARABLE: ActionKind[] = ['coupon', 'redemption', 'record', 'vote'];

/**
 * Поля объявления зависят от вида. Сумма у купона и погашения — на бумагу и
 * считается из условий; у голосования это общий бюджет взыскания, и считать
 * его платформе неоткуда; у реестра без выплаты суммы нет вовсе. Вторая дата
 * у выплат — день платежа, у голосования — когда его закрывают, у реестра без
 * выплаты её нет: контракт требует дату, и мы приравниваем её к дате фиксации.
 */
const DECLARE_FIELDS: Record<
  ActionKind,
  {
    amount?: { label: string; placeholder: string; hint: string };
    settlement?: { label: string; hint: string };
    fromSchedule: boolean;
  }
> = {
  coupon: {
    amount: {
      label: 'Купон на бумагу',
      placeholder: 'из условий выпуска',
      hint: 'Пусто — посчитаем по ставке и периодичности выпуска',
    },
    settlement: {
      label: 'Дата выплаты',
      hint: 'Когда деньги дойдут до держателей',
    },
    fromSchedule: true,
  },
  redemption: {
    amount: {
      label: 'Выплата на бумагу',
      placeholder: 'из условий выпуска',
      hint: 'Пусто — номинал плюс последний купон',
    },
    settlement: {
      label: 'Дата выплаты',
      hint: 'Когда деньги дойдут до держателей',
    },
    fromSchedule: true,
  },
  vote: {
    amount: {
      label: 'Бюджет взыскания, всего',
      placeholder: 'например, 1500',
      hint: 'Общая сумма на юриста, пошлины и оценку — не на бумагу. Её и одобряют держатели',
    },
    settlement: {
      label: 'Голосование закрывается',
      hint: 'После этой даты итог записывается в сеть',
    },
    fromSchedule: false,
  },
  record: { fromSchedule: false },
  default: { fromSchedule: false },
  recovery: { fromSchedule: false },
};

/**
 * Выпуск целиком: условия бумаги, держатели и журнал корпоративных действий.
 *
 * Денег здесь не ходит — купон и тело платит `dala_capital`. На этом экране
 * действие проводится по стадиям: объявлено → реестр снят → исполнено.
 */
export function BondPageView({ id }: { id: string }) {
  const client = useQueryClient();
  const bond = useQuery({
    queryKey: ['bond', id],
    queryFn: () => api.bonds.get(id),
  });

  const save = (data: BondPage) => client.setQueryData(['bond', id], data);
  const snapshot = useMutation<BondPage, ApiError, number>({
    mutationFn: (index) => api.bonds.snapshot(id, index),
    onSuccess: save,
  });
  const settle = useMutation<BondPage, ApiError, number>({
    mutationFn: (index) => api.bonds.settle(id, index),
    onSuccess: save,
  });
  const close = useMutation<BondPage, ApiError, number>({
    mutationFn: (index) => api.bonds.close(id, index),
    onSuccess: save,
  });
  const redeem = useMutation<BondPage, ApiError, void>({
    mutationFn: () => api.bonds.redeem(id),
    onSuccess: save,
  });

  if (bond.isPending) {
    return <p className="text-sm text-muted">Читаем выпуск из сети…</p>;
  }
  if (bond.isError) {
    return <Notice tone="danger" title={(bond.error as ApiError).message} />;
  }

  const { registry, campaign, holders, actions, now } = bond.data;
  const decimals = campaign.mintDecimals;
  const error =
    snapshot.error ?? settle.error ?? close.error ?? redeem.error ?? null;

  return (
    <div className="space-y-4">
      <Link
        href="/admin/bonds"
        className="inline-flex items-center gap-2 text-sm text-muted"
      >
        <ArrowLeft size={16} aria-hidden /> К выпускам
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{campaign.title}</h2>
        <BondStatusBadge
          status={registry.status}
          dealState={bond.data.dealState}
        />
      </div>

      {error ? <Notice tone="danger" title={error.message} /> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Номинал"
          value={formatMoney(registry.faceValue, decimals)}
          hint="одной бумаги"
        />
        <StatTile
          label="Купон"
          value={`${bpsToPercent(registry.couponRateBps)}%`}
          hint={`${registry.couponsPerYear} раза в год`}
        />
        <StatTile
          label="В обращении"
          value={registry.outstanding}
          hint={`выпущено ${registry.issued} из ${registry.maxSupply}`}
        />
        <StatTile
          label="Срок погашения"
          value={formatDateTime(registry.maturityTs)}
          hint="последний платёж, возврат тела"
        />
      </div>

      <Card>
        <CardTitle>Бумага</CardTitle>
        <p className="mb-3 text-sm text-muted">
          Условия выпуска записаны в метаданные самого минта: держатель проверит
          их в кошельке, не доверяя платформе. Бумага именная — счета держателей
          заморожены, и передать её может только регистратор.
        </p>
        <div className="mb-3 rounded-lg border border-border p-3">
          <Copyable value={registry.mint} />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <a
            href={bond.data.mintUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-muted hover:text-accent"
          >
            Бумага в обозревателе <ExternalLink size={14} aria-hidden />
          </a>
          <span className="text-muted">
            купон {formatMoney(bond.data.couponPerUnit, decimals)} на бумагу ·
            погашение {formatMoney(bond.data.redemptionPerUnit, decimals)}
          </span>
        </div>

        {bond.data.dealState === 'failed' ? (
          <p className="mt-3 text-sm text-muted">
            Сбор не состоялся: бумаги сожжены вместе с возвратом взносов. В
            контракте у выпуска для этого нет отдельного статуса, поэтому он
            числится действующим — но в обращении ничего нет и не будет.
          </p>
        ) : null}

        {/* Прожиг необратим: пока заём не закрыт, кнопка видна, но не нажимается. */}
        {registry.status !== 'redeemed' && registry.outstanding !== '0' ? (
          <div className="mt-4">
            <Button
              variant="danger"
              disabled={Boolean(bond.data.redeemBlock)}
              loading={redeem.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    'Бумаги всех держателей будут прожжены безвозвратно. Делается только когда заём закрыт и деньги держателям выплачены.',
                  )
                ) {
                  redeem.mutate();
                }
              }}
            >
              <Flame size={16} aria-hidden /> Погасить бумаги
            </Button>
            <p className="mt-1.5 text-sm text-muted">
              {bond.data.redeemBlock ??
                'Заём погашен — бумага больше ничего не подтверждает, её можно гасить'}
            </p>
          </div>
        ) : null}
      </Card>

      <DeclareBlock id={id} schedule={bond.data.schedule} onDone={save} />

      <Card>
        <CardTitle>Журнал корпоративных действий</CardTitle>
        {actions.length === 0 ? (
          <p className="text-sm text-muted">
            Действий ещё не было. Объявите купон или снимок реестра — всё
            попадёт в сеть вместе с датой фиксации.
          </p>
        ) : (
          <ul className="space-y-3">
            {actions.map((action) => {
              const step = nextStep(action, now);
              return (
                <li
                  key={action.index}
                  className={clsx(
                    'rounded-xl border p-3',
                    // Тот же жёлтый, что привёл сюда из меню и из списка:
                    // глаз доходит по нему до самой кнопки.
                    step?.due ? 'border-warning' : 'border-border',
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {action.index + 1}. <ActionKindTitle kind={action.kind} />
                      <ActionCodes kind={action.kind} />
                    </span>
                    <ActionStatusBadge
                      status={action.status}
                      kind={action.kind}
                    />
                  </div>
                  <div className="mt-2">
                    <ActionSteps status={action.status} kind={action.kind} />
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
                    <Cell
                      label="Дата фиксации"
                      value={formatDateTime(action.recordTs)}
                    />
                    {action.kind === 'record' ? null : (
                      <Cell
                        label={
                          action.kind === 'vote'
                            ? 'Голосование до'
                            : 'Дата выплаты'
                        }
                        value={formatDateTime(action.paymentTs)}
                      />
                    )}
                    {action.kind === 'record' ? null : (
                      <Cell
                        label={
                          action.kind === 'vote'
                            ? 'Бюджет взыскания, всего'
                            : 'На бумагу'
                        }
                        value={formatMoney(action.amountPerUnit, decimals)}
                      />
                    )}
                    <Cell
                      label="Держателей"
                      value={
                        action.status === 'declared'
                          ? 'не снят'
                          : `${action.holders} держателей · ${action.units} бумаг`
                      }
                    />
                  </dl>

                  {action.status !== 'declared' ? (
                    <p className="mt-2 text-xs text-muted">
                      Хеш списка {shortHash(action.registerHash)} ·{' '}
                      <a
                        href={api.bonds.registerUrl(id, action.index)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                      >
                        опубликованный список
                      </a>
                      {/* До исполнения в сети нули: показываем подсчёт платформы
                        и говорим, что он предварительный. */}
                      {action.kind === 'vote'
                        ? action.status === 'settled' ||
                          action.status === 'closed'
                          ? ` · в сети за ${action.votesFor}, против ${action.votesAgainst}`
                          : ` · предварительно за ${action.liveFor}, против ${action.liveAgainst}` +
                            ` (${(action.liveTurnoutBps / 100).toFixed(1)}% выпуска,` +
                            `${action.liveQuorumReached ? ' кворум набран' : ' кворума пока нет'})`
                        : ''}
                    </p>
                  ) : null}

                  {action.settlementUrl ? (
                    <a
                      href={action.settlementUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-sm text-muted hover:text-accent"
                    >
                      Расчёт в обозревателе{' '}
                      <ExternalLink size={14} aria-hidden />
                    </a>
                  ) : null}

                  {step ? (
                    <p
                      className={clsx(
                        'mt-2 text-sm',
                        step.due ? 'font-medium text-warning' : 'text-muted',
                      )}
                    >
                      {step.text}
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    {action.status === 'declared' ? (
                      <Button
                        variant={step?.due ? 'due' : 'secondary'}
                        disabled={now < action.recordTs}
                        loading={snapshot.isPending}
                        onClick={() => snapshot.mutate(action.index)}
                      >
                        Составить список держателей
                      </Button>
                    ) : null}
                    {/* У реестра без выплаты исполнения нет — закрывается сразу. */}
                    {action.status === 'snapshot' &&
                    action.kind !== 'record' ? (
                      <Button
                        variant="due"
                        loading={settle.isPending}
                        onClick={() => settle.mutate(action.index)}
                      >
                        Записать исполнение
                      </Button>
                    ) : null}
                    {action.status === 'settled' ||
                    (action.kind === 'record' &&
                      action.status === 'snapshot') ? (
                      <Button
                        variant="due"
                        loading={close.isPending}
                        onClick={() => close.mutate(action.index)}
                      >
                        Закрыть
                      </Button>
                    ) : null}
                  </div>

                  {action.status === 'declared' && now < action.recordTs ? (
                    <p className="mt-2 text-xs text-muted">
                      Список составляется на дату фиксации, не раньше.
                    </p>
                  ) : null}
                  {action.status === 'snapshot' && action.kind !== 'record' ? (
                    <p className="mt-2 text-xs text-muted">
                      Подпись расчётной транзакции подставится сама: деньги
                      держателям платит заёмщик через dala_capital, и платформа
                      сама проводила этот платёж.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>Держатели</CardTitle>
        {holders.length === 0 ? (
          <p className="text-sm text-muted">
            Бумаг пока ни у кого: они выпускаются в момент взноса.
          </p>
        ) : (
          <ul className="space-y-2">
            {holders.map((row) => (
              <li
                key={row.tokenAccount}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
              >
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-muted hover:text-accent"
                >
                  {row.holder}
                </a>
                <span className="tabular-nums">
                  {row.units} бумаг ·{' '}
                  {formatMoney(
                    (BigInt(row.units) * BigInt(registry.faceValue)).toString(),
                    decimals,
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const DAY = 24 * 60 * 60;

/** Местное время в поле `datetime-local` из unix-секунд. */
const toInput = (ts: number) => toLocalInput(new Date(ts * 1000).toISOString());

/**
 * Объявление действия: вид, дата фиксации и дата исполнения.
 *
 * Даты не вводятся с нуля: купон платится в дату платежа по графику, а дата
 * фиксации назначается незадолго до неё. Поля остаются правимыми — на
 * ускоренном графике и в нестандартных случаях без этого не обойтись.
 */
function DeclareBlock({
  id,
  schedule,
  onDone,
}: {
  id: string;
  schedule: BondPage['schedule'];
  onDone: (data: BondPage) => void;
}) {
  const [kind, setKind] = useState<ActionKind>('coupon');
  const [amount, setAmount] = useState('');
  /** Платёж, выбранный руками; пусто — подставляем по виду действия. */
  const [dueTs, setDueTs] = useState<number | null>(null);
  /** Даты, введённые руками; пусто — считаем из выбранного платежа. */
  const [recordEdit, setRecordEdit] = useState('');
  const [paymentEdit, setPaymentEdit] = useState('');

  /**
   * Насколько раньше платежа снимается реестр: сутки, но не больше четверти
   * периода — на ускоренном графике сутки увели бы дату фиксации в прошлое.
   */
  const lead =
    schedule.length > 1
      ? Math.min(DAY, Math.floor((schedule[1].dueTs - schedule[0].dueTs) / 4))
      : DAY;

  // Тело возвращается последним платежом, купон — ближайшим неоплаченным.
  // У снимка реестра и голосования к графику привязки нет: даты вводятся руками.
  const suggested =
    kind === 'redemption'
      ? schedule[schedule.length - 1]
      : kind === 'coupon'
        ? (schedule.find((period) => !period.paid) ?? schedule[0])
        : undefined;
  const due = dueTs ?? suggested?.dueTs ?? null;

  const recordAt = recordEdit || (due === null ? '' : toInput(due - lead));
  const paymentAt = paymentEdit || (due === null ? '' : toInput(due));

  const reset = () => {
    setAmount('');
    setDueTs(null);
    setRecordEdit('');
    setPaymentEdit('');
  };

  const declare = useMutation<BondPage, ApiError, void>({
    mutationFn: () => {
      const recordTs = Math.floor(
        new Date(fromLocalInput(recordAt) ?? '').getTime() / 1000,
      );
      return api.bonds.declare(id, {
        kind,
        recordTs,
        // У реестра без выплаты второй даты нет, но контракт её требует:
        // приравниваем к дате фиксации, как это делает и бэкенд.
        paymentTs: paymentAt
          ? Math.floor(
              new Date(fromLocalInput(paymentAt) ?? '').getTime() / 1000,
            )
          : recordTs,
        amountPerUnit: amount ? toMicro(amount) : undefined,
      });
    },
    onSuccess: (data) => {
      reset();
      onDone(data);
    },
  });

  const fields = DECLARE_FIELDS[kind];
  // У реестра без выплаты второй даты нет, у голосования сумма обязательна.
  const ready =
    Boolean(recordAt) &&
    (!fields.settlement || Boolean(paymentAt)) &&
    (kind !== 'vote' || Boolean(amount));

  return (
    <Card>
      <CardTitle>Объявить действие</CardTitle>
      <p className="mb-3 text-sm text-muted">
        Дата фиксации назначается заранее: держатели должны знать её до того,
        как реестр снят. На кого действие распространяется, решает она, а не
        день объявления.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Вид"
          value={kind}
          onChange={(event) => setKind(event.target.value as ActionKind)}
        >
          {DECLARABLE.map((item) => (
            <option key={item} value={item}>
              {ACTION_KIND_TITLE[item]}
            </option>
          ))}
        </Select>
        {fields.amount ? (
          <Field
            label={fields.amount.label}
            inputMode="decimal"
            placeholder={fields.amount.placeholder}
            hint={fields.amount.hint}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        ) : null}
        {schedule.length > 0 && fields.fromSchedule ? (
          <Select
            label="Платёж по графику"
            hint="Подставит даты ниже; их можно поправить"
            value={paymentAt}
            onChange={(event) => {
              const period = schedule.find(
                (item) => toInput(item.dueTs) === event.target.value,
              );
              if (!period) return;
              setDueTs(period.dueTs);
              setRecordEdit('');
              setPaymentEdit('');
            }}
          >
            {schedule.map((period) => (
              <option key={period.index} value={toInput(period.dueTs)}>
                {period.index}. {formatDateTime(period.dueTs)}
                {period.paid ? ' — оплачен' : ''}
              </option>
            ))}
          </Select>
        ) : null}
        <Field
          label="Дата фиксации"
          type="datetime-local"
          value={recordAt}
          onChange={(event) => setRecordEdit(event.target.value)}
        />
        {fields.settlement ? (
          <Field
            label={fields.settlement.label}
            type="datetime-local"
            hint={fields.settlement.hint}
            value={paymentAt}
            onChange={(event) => setPaymentEdit(event.target.value)}
          />
        ) : null}
      </div>

      {kind === 'record' ? (
        <p className="mt-3 text-sm text-muted">
          Реестр без выплаты — это просто срез держателей на дату: кто сколько
          держал. Денег он не касается, поэтому ни суммы, ни второй даты у него
          нет, и закрывается он сразу после снятия реестра.
        </p>
      ) : null}

      {declare.isError ? (
        <div className="mt-3">
          <Notice tone="danger" title={declare.error.message} />
        </div>
      ) : null}

      <Button
        className="mt-3"
        disabled={!ready}
        loading={declare.isPending}
        onClick={() => declare.mutate()}
      >
        Объявить
      </Button>
      <p className="mt-2 text-xs text-muted">Время местное.</p>
    </Card>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
    </div>
  );
}
