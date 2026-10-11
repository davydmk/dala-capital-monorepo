'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Landmark } from 'lucide-react';
import Link from 'next/link';
import {
  ActionCodes,
  ActionKindTitle,
  ActionStatusBadge,
  BondStatusBadge,
  shortHash,
} from '@/components/bond-bits';
import { Copyable } from '@/components/copyable';
import { bpsToPercent, formatDateTime, formatMoney } from '@/components/money';
import {
  Button,
  buttonStyles,
  Card,
  CardTitle,
  EmptyState,
  Notice,
  StatTile,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { MyBond } from '@/lib/types';

type Mine = { rows: MyBond[]; now: number };

/**
 * Бумаги держателя: что у него на руках, сколько придёт купоном и какие
 * корпоративные действия его касаются. Здесь же он голосует по объявлению
 * дефолта — весом бумаг на дату фиксации.
 */
export function BondsView() {
  const client = useQueryClient();
  const bonds = useQuery({ queryKey: ['my-bonds'], queryFn: api.myBonds.list });

  const vote = useMutation<
    { tally: unknown } & Mine,
    ApiError,
    { campaignId: string; index: number; choice: 'FOR' | 'AGAINST' }
  >({
    mutationFn: ({ campaignId, index, choice }) =>
      api.myBonds.vote(campaignId, index, choice),
    // Итог голосования берём не из ответа, а из пересчитанных строк: они уже
    // несут текущий подсчёт по каждому действию, включая только что поданный
    // голос.
    onSuccess: (data) =>
      client.setQueryData(['my-bonds'], { rows: data.rows, now: data.now }),
  });

  if (bonds.isPending) {
    return <p className="text-sm text-muted">Читаем бумаги из сети…</p>;
  }
  if (bonds.isError) {
    return <Notice tone="danger" title={(bonds.error as ApiError).message} />;
  }
  if (bonds.data.rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Landmark size={28} aria-hidden />}
          title="Бумаг пока нет"
        >
          Облигация подтверждается бумагой в тот же момент, когда вы вносите
          деньги. У кредитов с аннуитетным графиком бумаги не бывает — там доля
          видна в портфеле.
        </EmptyState>
        <Link
          href="/investor/campaigns"
          className={buttonStyles('primary', 'mt-3')}
        >
          Посмотреть выпуски
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {vote.isError ? (
        <Notice tone="danger" title={vote.error.message} />
      ) : null}

      {bonds.data.rows.map((bond) => (
        <Card key={bond.campaignId}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <Link
                href={`/investor/campaigns/${bond.campaignId}`}
                className="font-medium hover:text-accent"
              >
                {bond.title}
              </Link>
              <p className="text-sm text-muted">
                {bond.borrower.name}
                {bond.isin ? (
                  <span className="ml-2 font-mono text-xs">{bond.isin}</span>
                ) : null}
              </p>
            </div>
            <BondStatusBadge status={bond.status} dealState={bond.dealState} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Бумаг" value={bond.units} hint="у вас на руках" />
            <StatTile
              label="Номинал"
              value={formatMoney(bond.faceValue, bond.mintDecimals)}
              hint="одной бумаги"
            />
            <StatTile
              label="Купон"
              value={formatMoney(bond.couponAmount, bond.mintDecimals)}
              hint={`${bpsToPercent(bond.couponRateBps)}% · ${bond.couponsPerYear} раза в год`}
            />
            <StatTile
              label="К погашению"
              value={formatMoney(bond.redemptionAmount, bond.mintDecimals)}
              hint={`срок ${formatDateTime(bond.maturityTs)}`}
            />
          </div>

          <div className="mt-4 rounded-lg border border-border p-3">
            <p className="mb-2 text-sm text-muted">
              Бумага именная: она подтверждает ваше право требования и не
              передаётся. Условия выпуска записаны в самом токене — их видно в
              кошельке и в обозревателе.
            </p>
            <p className="mt-2 text-xs text-muted">
              Купон и погашение рассчитываются T+0: платёж заёмщика и
              распределение держателям — одна транзакция. Дата фиксации решает,
              кому платить, а не когда деньги дойдут.
            </p>
            <Copyable value={bond.mint} />
            <a
              href={bond.mintUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm text-muted hover:text-accent"
            >
              Посмотреть в обозревателе <ExternalLink size={14} aria-hidden />
            </a>
          </div>

          {bond.actions.length > 0 ? (
            <div className="mt-4">
              <CardTitle>Корпоративные действия</CardTitle>
              <ul className="space-y-2">
                {bond.actions.map((action) => (
                  <li
                    key={action.index}
                    className="rounded-lg border border-border p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        <ActionKindTitle kind={action.kind} />
                        <ActionCodes kind={action.kind} />
                      </span>
                      <ActionStatusBadge
                        status={action.status}
                        kind={action.kind}
                      />
                    </div>
                    <p className="mt-1 text-muted">
                      Фиксация {formatDateTime(action.recordTs)}
                      {action.kind === 'record'
                        ? ''
                        : action.kind === 'vote'
                          ? ` · голосование до ${formatDateTime(action.paymentTs)}`
                          : ` · выплата ${formatDateTime(action.paymentTs)}`}
                    </p>

                    {action.status !== 'declared' ? (
                      <p className="mt-1 tabular-nums">
                        {action.myUnits !== '0' ? (
                          <>
                            Ваших бумаг на дату фиксации: {action.myUnits}
                            {action.kind !== 'vote' && action.myAmount !== '0'
                              ? ` · причитается ${formatMoney(action.myAmount, bond.mintDecimals)}`
                              : ''}
                          </>
                        ) : (
                          <span className="text-muted">
                            На дату фиксации бумаг у вас не было
                          </span>
                        )}
                        <span className="ml-2 text-xs text-muted">
                          реестр {shortHash(action.registerHash)}
                        </span>
                      </p>
                    ) : null}

                    {action.kind === 'vote' ? (
                      <Vote
                        bond={bond}
                        action={action}
                        busy={
                          vote.isPending &&
                          vote.variables?.index === action.index &&
                          vote.variables?.campaignId === bond.campaignId
                        }
                        onVote={(choice) =>
                          vote.mutate({
                            campaignId: bond.campaignId,
                            index: action.index,
                            choice,
                          })
                        }
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

/**
 * Голосование по объявлению дефолта. Главное, что должен понимать держатель:
 * расходы на взыскание возмещаются из первых поступлений, то есть до него.
 */
function Vote({
  bond,
  action,
  busy,
  onVote,
}: {
  bond: MyBond;
  action: MyBond['actions'][number];
  busy: boolean;
  onVote: (choice: 'FOR' | 'AGAINST') => void;
}) {
  if (!action.canVote) {
    return action.status === 'declared' ? (
      <p className="mt-2 text-muted">
        Голосование откроется, когда будет снят реестр на дату фиксации.
      </p>
    ) : null;
  }

  const closed = action.status === 'settled' || action.status === 'closed';

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-2">
        Объявить дефолт по займу? Взыскание стоит денег: юрист, пошлины, оценка.
        Эти расходы возмещаются из первых поступлений — раньше, чем деньги
        дойдут до держателей. Одобряемый предел —{' '}
        <span className="font-medium">
          {formatMoney(action.amountPerUnit, bond.mintDecimals)}
        </span>{' '}
        на всё дело, а не на каждую бумагу.
      </p>
      <p className="mb-2 text-xs text-muted">
        Решение принимается, если проголосует больше{' '}
        {(action.quorumBps / 100).toFixed(0)}% выпуска и голосов «за» окажется
        больше, чем «против». Вес голоса — число бумаг на дату фиксации.
      </p>
      {/* Пока итог не записан в сеть, в аккаунте действия нули: показываем
          подсчёт платформы и говорим, что он предварительный. */}
      <p className="mb-3 text-xs text-muted">
        Ваш вес — {action.myUnits} бумаг на дату фиксации.{' '}
        {closed ? (
          <>
            Итог в сети: за {action.votesFor}, против {action.votesAgainst}.
          </>
        ) : (
          <>
            Предварительно: за {action.liveFor}, против {action.liveAgainst} —
            это {(action.liveTurnoutBps / 100).toFixed(1)}% выпуска,
            {action.liveQuorumReached ? ' кворум набран' : ' кворума пока нет'}.
            Итог уйдёт в сеть, когда голосование закроют.
          </>
        )}
      </p>

      {closed ? (
        <p className="text-muted">
          Голосование закрыто. Итог записан в сеть вместе с хешем бюллетеней.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={action.myVote === 'FOR' ? 'primary' : 'secondary'}
            loading={busy}
            onClick={() => onVote('FOR')}
          >
            За дефолт
          </Button>
          <Button
            variant={action.myVote === 'AGAINST' ? 'primary' : 'secondary'}
            loading={busy}
            onClick={() => onVote('AGAINST')}
          >
            Против
          </Button>
          {action.myVote ? (
            <span className="text-xs text-muted">
              Ваш голос учтён, его можно изменить до закрытия
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
