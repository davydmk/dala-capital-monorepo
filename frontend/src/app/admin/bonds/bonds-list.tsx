'use client';

import { useQuery } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import clsx from 'clsx';
import {
  ActionKindTitle,
  BondStatusBadge,
  nextStep,
} from '@/components/bond-bits';
import { bpsToPercent, formatDateTime, formatMoney } from '@/components/money';
import { Card, Chip, EmptyState, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { BondSummary } from '@/lib/types';

/**
 * Срез по состоянию выпуска. «Сбор не состоялся» в контракте не хранится:
 * бумаги там сожжены, а статус остался действующим — отличаем по займу.
 */
type Filter = 'all' | 'active' | 'defaulted' | 'redeemed' | 'cancelled';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'В обращении' },
  { value: 'defaulted', label: 'Дефолт' },
  { value: 'redeemed', label: 'Погашены' },
  { value: 'cancelled', label: 'Сбор не состоялся' },
];

const stateOf = (bond: BondSummary): Exclude<Filter, 'all'> =>
  bond.status === 'active' && bond.dealState === 'failed'
    ? 'cancelled'
    : bond.status;

/**
 * Выпуски облигаций. Бумага выпускается только по купонной схеме: у кредита
 * с аннуитетом её нет и быть не должно.
 */
export function BondsList() {
  const [filter, setFilter] = useState<Filter>('all');
  const bonds = useQuery({ queryKey: ['bonds'], queryFn: api.bonds.list });

  if (bonds.isPending) {
    return <p className="text-sm text-muted">Читаем выпуски из сети…</p>;
  }
  if (bonds.isError) {
    return <Notice tone="danger" title={(bonds.error as ApiError).message} />;
  }
  if (bonds.data.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Landmark size={28} aria-hidden />}
          title="Выпусков пока нет"
        >
          Бумага выпускается вместе с публикацией кампании по купонной схеме. У
          кредита с аннуитетным графиком бумаги не бывает.
        </EmptyState>
      </Card>
    );
  }

  const shown = bonds.data.filter(
    (bond) => filter === 'all' || stateOf(bond) === filter,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => {
          const count =
            item.value === 'all'
              ? bonds.data.length
              : bonds.data.filter((bond) => stateOf(bond) === item.value)
                  .length;
          if (count === 0 && item.value !== 'all') return null;
          return (
            <Chip
              key={item.value}
              active={filter === item.value}
              onClick={() => setFilter(item.value)}
            >
              {item.label} · {count}
            </Chip>
          );
        })}
      </div>

      <ul className="space-y-3">
        {shown.map((bond) => {
          const step = bond.pending ? nextStep(bond.pending, bond.now) : null;
          return (
            <li key={bond.campaignId}>
              <Link
                href={`/admin/bonds/${bond.campaignId}`}
                className={clsx(
                  'block rounded-xl border bg-surface p-4 transition hover:border-accent',
                  // Жёлтым помечено то, что ждёт шага. Выпуск с закрытыми
                  // действиями ничего не требует, и отличать его надо сразу.
                  step?.due ? 'border-warning' : 'border-border',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {step?.due ? (
                      <span
                        aria-hidden
                        className="mr-2 inline-block size-2 rounded-full bg-warning align-middle"
                      />
                    ) : null}
                    {bond.title}
                  </span>
                  <BondStatusBadge
                    status={bond.status}
                    dealState={bond.dealState}
                  />
                </div>
                <p className="mt-1 text-sm text-muted">{bond.borrower.name}</p>

                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
                  <Cell
                    label="Номинал"
                    value={formatMoney(bond.faceValue, bond.mintDecimals)}
                  />
                  <Cell
                    label="Купон"
                    value={`${bpsToPercent(bond.couponRateBps)}% · ${bond.couponsPerYear} раза в год`}
                  />
                  <Cell
                    label="В обращении"
                    value={`${bond.outstanding} из ${bond.maxSupply}`}
                  />
                  <Cell
                    label="Срок погашения"
                    value={formatDateTime(bond.maturityTs)}
                  />
                </dl>

                <p className="mt-3 text-sm">
                  {step ? (
                    <>
                      <span
                        className={
                          step.due ? 'font-medium text-warning' : 'text-muted'
                        }
                      >
                        {step.text}
                      </span>
                      <span className="text-muted">
                        {' · '}
                        <ActionKindTitle kind={bond.pending!.kind} />
                      </span>
                    </>
                  ) : (
                    <span className="text-muted">
                      {bond.actions > 0
                        ? `Действий в журнале: ${bond.actions}`
                        : 'Корпоративных действий ещё не было'}
                    </span>
                  )}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>

      {shown.length === 0 ? (
        <p className="text-sm text-muted">Выпусков в этом состоянии нет.</p>
      ) : null}
    </div>
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
