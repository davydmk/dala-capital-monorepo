'use client';

import { Users } from 'lucide-react';
import { shortAddress } from '@/components/borrower-bits';
import { formatMoney } from '@/components/money';
import { Card, CardTitle, EmptyState } from '@/components/ui';
import type { CampaignPage } from '@/lib/types';

/**
 * Состав инвесторов так, как его видно в блокчейне: доли подписаны адресом
 * позиции в контракте. Имён здесь нет и быть не может — платформа их не
 * раскрывает, а адрес позиции ничего не говорит ни о человеке, ни о кошельке.
 */
export function InvestorsBlock({
  investors,
  decimals,
}: {
  investors: CampaignPage['investors'];
  decimals: number;
}) {
  if (investors.count === 0) {
    return (
      <Card>
        <CardTitle>Состав инвесторов</CardTitle>
        <EmptyState icon={<Users size={28} aria-hidden />} title="Пока никого">
          Взносов ещё не было — вы можете стать первым.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>Состав инвесторов</CardTitle>
      <dl className="mb-4 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-muted">Инвесторов</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {investors.count}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Средний вклад</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {formatMoney(investors.average, decimals)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Крупнейшая доля</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {investors.largestShareBps / 100}%
          </dd>
        </div>
      </dl>

      <ul className="space-y-2">
        {investors.shares.map((share) => (
          <li
            key={share.address}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
          >
            {/* Доли анонимны: адрес здесь — PDA служебного аккаунта позиции,
                он никого не называет, а в обозревателе человеку ничего не
                говорит. Поэтому просто подпись без ссылки. */}
            <span
              className="font-mono text-xs text-muted"
              title={share.address}
            >
              {shortAddress(share.address)}
              {share.mine ? (
                <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 font-sans text-xs text-accent">
                  вы
                </span>
              ) : null}
            </span>
            <span className="tabular-nums">
              {formatMoney(share.principal, decimals)}
              <span className="ml-2 text-muted">{share.shareBps / 100}%</span>
            </span>
          </li>
        ))}
      </ul>

      {investors.count > investors.shares.length ? (
        <p className="mt-3 text-xs text-muted">
          Показаны {investors.shares.length} крупнейших долей из{' '}
          {investors.count}.
        </p>
      ) : null}
    </Card>
  );
}
