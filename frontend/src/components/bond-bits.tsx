'use client';

/** Общие детали облигаций: плашки статуса выпуска и стадии действия. */
import clsx from 'clsx';
import { formatDateTime } from './money';
import {
  ACTION_CODE_MEANING,
  ACTION_EVENT_CODE,
  ACTION_KIND_TITLE,
  ACTION_MANDATORY_CODE,
  actionStatusTitle,
  BOND_STATUS_TITLE,
  type ActionKind,
  type ActionStatus,
  type BondStatus,
  type CorporateAction,
} from '@/lib/types';

const BOND_STYLE: Record<BondStatus, string> = {
  active: 'border-transparent bg-accent-soft text-accent',
  defaulted: 'border-transparent bg-danger-soft text-danger',
  redeemed: 'border-border text-muted',
};

/**
 * Плашка статуса выпуска. У несостоявшегося сбора бумаги сжигаются без пометки
 * о погашении, и в контракте выпуск остаётся `active` — отличить его от пустого
 * нового можно только по состоянию займа, поэтому оно и приходит сюда.
 */
export function BondStatusBadge({
  status,
  dealState,
}: {
  status: BondStatus;
  dealState?: string;
}) {
  const cancelled = status === 'active' && dealState === 'failed';
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        cancelled ? 'border-border text-muted' : BOND_STYLE[status],
      )}
    >
      {cancelled ? 'Сбор не состоялся' : BOND_STATUS_TITLE[status]}
    </span>
  );
}

const STEP_STYLE: Record<ActionStatus, string> = {
  declared: 'border-border text-muted',
  snapshot: 'border-transparent bg-warning-soft text-warning',
  settled: 'border-transparent bg-accent-soft text-accent',
  closed: 'border-border text-muted',
};

export function ActionStatusBadge({
  status,
  kind,
}: {
  status: ActionStatus;
  kind: ActionKind;
}) {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        STEP_STYLE[status],
      )}
    >
      {actionStatusTitle(status, kind)}
    </span>
  );
}

/**
 * Стадии действия в том порядке, в каком их проходит программа. Объявление,
 * снятый реестр и исполнение — это и есть жизненный цикл корпоративного
 * действия, и видеть его целиком важнее, чем текущую подпись.
 */
export function ActionSteps({
  status,
  kind,
}: {
  status: ActionStatus;
  kind: ActionKind;
}) {
  // У реестра без выплаты исполнения не бывает: он закрывается прямо из
  // снятого реестра, и так же это проверяет контракт.
  const order: ActionStatus[] =
    kind === 'record'
      ? ['declared', 'snapshot', 'closed']
      : ['declared', 'snapshot', 'settled', 'closed'];
  const current = order.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {order.map((step, index) => (
        <li key={step} className="flex items-center gap-2">
          <span
            className={
              index <= current ? 'font-medium text-accent' : 'text-muted'
            }
          >
            {actionStatusTitle(step, kind)}
          </span>
          {index < order.length - 1 ? (
            <span aria-hidden className="text-muted">
              →
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function ActionKindTitle({ kind }: { kind: ActionKind }) {
  return <>{ACTION_KIND_TITLE[kind] ?? kind}</>;
}

/**
 * Коды события и обязательности по ISO 15022 — то, чем корпоративное действие
 * описывают в депозитарном сообщении. Рядом с названием, а не вместо него:
 * кому коды ничего не говорят, читает подпись.
 */
export function ActionCodes({ kind }: { kind: ActionKind }) {
  const codes = [ACTION_EVENT_CODE[kind], ACTION_MANDATORY_CODE[kind]].filter(
    (code): code is string => Boolean(code),
  );
  // У реестра без выплаты кода события нет — одну обязательность не показываем.
  if (!ACTION_EVENT_CODE[kind]) return null;

  return (
    <span className="ml-2 inline-flex items-center gap-1 align-middle">
      {codes.map((code) => (
        <span
          key={code}
          title={ACTION_CODE_MEANING[code]}
          className={clsx(
            'rounded border px-1.5 py-0.5 font-mono text-xs tracking-wide',
            // Добровольное действие требует от держателя шага: выделяем.
            code === 'VOLU'
              ? 'border-transparent bg-warning-soft text-warning'
              : 'border-border text-foreground',
          )}
        >
          {code}
        </span>
      ))}
    </span>
  );
}

/**
 * Какой шаг ждут по действию. Одна функция на список выпусков и на страницу
 * выпуска: иначе два экрана начнут говорить разное про один и тот же шаг.
 *
 * `due` — пора сейчас. Им красится всё, что ведёт к кнопке: бейдж в меню,
 * точка у карточки, рамка у записи. Жёлтый значит «сделайте», и ничего больше.
 */
export function nextStep(
  action: Pick<CorporateAction, 'kind' | 'status' | 'recordTs'>,
  now: number,
): { text: string; due: boolean } | null {
  if (action.status === 'declared') {
    return now >= action.recordTs
      ? { text: 'Пора составить список держателей', due: true }
      : {
          text: `Список держателей составляется ${formatDateTime(action.recordTs)}`,
          due: false,
        };
  }
  if (action.status === 'snapshot') {
    // У реестра без выплаты исполнения не бывает — он закрывается сразу.
    return action.kind === 'record'
      ? { text: 'Пора закрыть действие', due: true }
      : { text: 'Пора записать исполнение', due: true };
  }
  if (action.status === 'settled') {
    return { text: 'Пора закрыть действие', due: true };
  }
  return null;
}

/** Хеш реестра: целиком он не нужен, но первые знаки сверяются глазами. */
export function shortHash(hash: string): string {
  return hash ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : '—';
}
