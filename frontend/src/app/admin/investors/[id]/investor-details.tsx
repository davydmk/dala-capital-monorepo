'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  KeyRound,
  ShieldCheck,
  ShieldOff,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Copyable } from '@/components/copyable';
import {
  BeneficiariesCard,
  CompanyCard,
  countryNamer,
  DocumentCard,
  DocumentsCard,
  PersonCard,
} from '@/components/investor-profile';
import { formatDateTime, formatMoney } from '@/components/money';
import {
  Button,
  Card,
  CardTitle,
  Notice,
  Select,
  TextArea,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import {
  INVESTOR_TYPE_TITLE,
  type DecisionAction,
  type Investor,
  type InvestorCheck,
} from '@/lib/types';
import { KycBadge } from '../kyc-badge';
import { investorTitle } from '../investors-list';

const ACTION_TITLE: Record<DecisionAction, string> = {
  approve: 'Допустить',
  retry: 'Вернуть на доработку',
  reject: 'Отказать окончательно',
  hold: 'Отложить',
};

export function InvestorDetails({ id }: { id: string }) {
  const client = useQueryClient();
  const card = useQuery({
    queryKey: ['investor', id],
    queryFn: () => api.investors.get(id),
  });
  const countries = useQuery({
    queryKey: ['countries'],
    queryFn: api.countries,
  });
  const history = useQuery({
    queryKey: ['investor-history', id],
    queryFn: () => api.investors.history(id),
  });

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ['investor', id] }),
      client.invalidateQueries({ queryKey: ['investor-history', id] }),
      client.invalidateQueries({ queryKey: ['investors'] }),
    ]);

  if (card.isPending) return <p className="text-sm text-muted">Загружаем…</p>;
  if (card.isError) {
    return <Notice tone="danger" title={(card.error as ApiError).message} />;
  }

  const { investor, checks, accountUrl } = card.data;
  const name = countryNamer(countries.data);

  return (
    <div className="space-y-4">
      <Link
        href="/admin/investors"
        className="inline-flex items-center gap-2 text-sm text-muted"
      >
        <ArrowLeft size={16} aria-hidden /> К списку инвесторов
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold">
            {investorTitle(investor)}
          </h2>
          <p className="text-sm text-muted">
            {investor.user.email} · {INVESTOR_TYPE_TITLE[investor.type]}
          </p>
        </div>
        <KycBadge status={investor.status} />
      </div>

      {investor.clientComment ? (
        <Notice tone="warning" title="Комментарий инвестору">
          {investor.clientComment}
        </Notice>
      ) : null}
      {investor.moderationComment ? (
        <Notice tone="info" title="Заметка платформы">
          {investor.moderationComment}
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {investor.type === 'COMPANY' ? (
          <CompanyCard investor={investor} countryName={name} />
        ) : null}
        <PersonCard investor={investor} countryName={name} />
        <DocumentCard investor={investor} countryName={name} />
      </div>
      {investor.type === 'COMPANY' ? (
        <BeneficiariesCard investor={investor} countryName={name} />
      ) : null}
      <DocumentsCard
        documents={investor.documents}
        url={(documentId) => api.investors.documentUrl(investor.id, documentId)}
      />
      <Holdings id={id} />
      <Withdrawal investor={investor} onDone={refresh} />
      <Checks checks={checks} />
      <Decision investor={investor} onDone={refresh} />
      <Onchain investor={investor} accountUrl={accountUrl} onDone={refresh} />

      <Card>
        <CardTitle>Журнал</CardTitle>
        {history.data && history.data.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {history.data.map((event) => (
              <li key={event.id} className="flex flex-wrap gap-x-2 text-muted">
                <span className="tabular-nums">
                  {formatDateTime(event.createdAt)}
                </span>
                <span className="text-foreground">{event.field}</span>
                {/* Адрес в base58 не переносится сам и уводит страницу вбок на телефоне. */}
                <span className="break-all">
                  {event.oldValue ?? '—'} → {event.newValue ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Пока ничего не менялось.</p>
        )}
      </Card>
    </div>
  );
}

function Withdrawal({
  investor,
  onDone,
}: {
  investor: Investor;
  onDone: () => Promise<unknown>;
}) {
  const confirm = useMutation<unknown, ApiError, void>({
    mutationFn: () => api.investors.confirmAddress(investor.id),
    onSuccess: onDone,
  });

  return (
    <Card>
      <CardTitle>Адрес для вывода средств</CardTitle>
      {investor.withdrawalAddress ? (
        <div className="flex flex-wrap items-center gap-2">
          <Copyable value={investor.withdrawalAddress} />
          <span className="text-xs text-muted">
            {investor.withdrawalCheckResult === 'ok'
              ? 'проверен в сети: это кошелёк'
              : 'проверить в сети не удалось'}
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted">Не указан.</p>
      )}

      {investor.pendingWithdrawalAddress ? (
        <div className="mt-4 space-y-3">
          <Notice tone="warning" title="Инвестор просит сменить адрес">
            Новый адрес: {investor.pendingWithdrawalAddress}. Запрошено{' '}
            {formatDateTime(investor.pendingRequestedAt)}. Убедитесь, что
            просьба настоящая: после смены контракт закроет выводы на 48 часов.
          </Notice>
          {confirm.isError ? (
            <Notice tone="danger" title={confirm.error.message} />
          ) : null}
          <Button
            loading={confirm.isPending}
            onClick={() => {
              if (
                window.confirm(
                  'Сменить адрес вывода? Выводы закроются на 48 часов.',
                )
              ) {
                confirm.mutate();
              }
            }}
          >
            <KeyRound size={16} aria-hidden /> Подтвердить смену адреса
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function Checks({ checks }: { checks: InvestorCheck[] }) {
  const failed = checks.filter((check) => !check.ok);
  return (
    <Card>
      <CardTitle>Полнота анкеты</CardTitle>
      {failed.length === 0 ? (
        <p className="flex items-center gap-2 text-sm">
          <Check size={16} aria-hidden className="text-accent" /> Заполнено всё,
          что требуется.
        </p>
      ) : (
        <ul className="space-y-2">
          {failed.map((check) => (
            <li key={check.key} className="flex items-start gap-2 text-sm">
              <X
                size={16}
                aria-hidden
                className="mt-0.5 shrink-0 text-danger"
              />
              <span>
                {check.title}
                {check.hint ? (
                  <span className="block text-muted">{check.hint}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Decision({
  investor,
  onDone,
}: {
  investor: Investor;
  onDone: () => Promise<unknown>;
}) {
  const approved = investor.status === 'APPROVED';
  // Допущенного инвестора можно только отправить на перепроверку или закрыть:
  // одобрять его повторно нечего.
  const actions = (
    approved
      ? ['retry', 'reject', 'hold']
      : ['approve', 'retry', 'reject', 'hold']
  ) as DecisionAction[];
  const [action, setAction] = useState<DecisionAction>(
    approved ? 'retry' : 'approve',
  );
  const [clientComment, setClientComment] = useState('');
  const [moderationComment, setModerationComment] = useState('');

  const decide = useMutation<unknown, ApiError, void>({
    mutationFn: () =>
      api.investors.decide(investor.id, {
        action,
        clientComment: clientComment.trim() || undefined,
        moderationComment: moderationComment.trim() || undefined,
      }),
    onSuccess: async () => {
      setClientComment('');
      setModerationComment('');
      await onDone();
    },
  });

  // Решение по допущенному закрывает ему выводы, поэтому объяснение обязательно.
  const needsComment = action === 'retry' || action === 'reject' || approved;

  return (
    <Card>
      <CardTitle>Решение</CardTitle>
      <div className="space-y-4">
        {approved ? (
          <Notice tone="warning" title="Инвестор уже допущен">
            Любое решение отсюда — это повторная проверка: контракт закроет ему
            выводы, пока анкета не будет подтверждена заново. Взносы в кампании
            это не останавливает.
          </Notice>
        ) : null}

        <Select
          label="Что делаем"
          value={action}
          onChange={(event) => setAction(event.target.value as DecisionAction)}
        >
          {actions.map((value) => (
            <option key={value} value={value}>
              {ACTION_TITLE[value]}
            </option>
          ))}
        </Select>

        <TextArea
          label="Комментарий инвестору"
          rows={2}
          placeholder={needsComment ? 'Что именно исправить' : 'Не обязательно'}
          value={clientComment}
          onChange={(event) => setClientComment(event.target.value)}
          hint="Инвестор увидит это в кабинете. Письма платформа не отправляет — сообщите решение сами"
        />
        <TextArea
          label="Заметка платформы"
          rows={2}
          placeholder="Что проверяли, на чём основано решение"
          value={moderationComment}
          onChange={(event) => setModerationComment(event.target.value)}
        />

        {decide.isError ? (
          <Notice tone="danger" title={decide.error.message} />
        ) : null}

        <Button
          variant={action === 'reject' ? 'danger' : 'primary'}
          loading={decide.isPending}
          disabled={needsComment && clientComment.trim().length === 0}
          onClick={() => decide.mutate()}
        >
          {ACTION_TITLE[action]}
        </Button>
      </div>
    </Card>
  );
}

function Onchain({
  investor,
  accountUrl,
  onDone,
}: {
  investor: Investor;
  accountUrl: string | null;
  onDone: () => Promise<unknown>;
}) {
  const create = useMutation<unknown, ApiError, void>({
    mutationFn: () => api.investors.onchain(investor.id),
    onSuccess: onDone,
  });
  const whitelist = useMutation<unknown, ApiError, boolean>({
    mutationFn: (enabled) => api.investors.whitelist(investor.id, enabled),
    onSuccess: onDone,
  });

  const blockedUntil = investor.whitelistBlockedUntil
    ? new Date(investor.whitelistBlockedUntil)
    : null;
  const blocked = blockedUntil ? blockedUntil > new Date() : false;

  return (
    <Card>
      <CardTitle>Аккаунт в контракте</CardTitle>

      {!investor.onchainAccount && investor.status !== 'APPROVED' ? (
        <p className="text-sm text-muted">
          Аккаунт создаётся после одобрения анкеты.
        </p>
      ) : !investor.onchainAccount ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Заводим инвестора в контракте ключом whitelist и сразу открываем
            допуск. Повторное нажатие безопасно: второй аккаунт не появится.
          </p>
          {create.isError ? (
            <Notice tone="danger" title={create.error.message} />
          ) : null}
          <Button loading={create.isPending} onClick={() => create.mutate()}>
            <ShieldCheck size={16} aria-hidden /> Создать аккаунт и допустить
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Copyable value={investor.onchainAccount} short />
            {accountUrl ? (
              <a
                href={accountUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent"
              >
                Обозреватель <ExternalLink size={14} aria-hidden />
              </a>
            ) : null}
          </div>

          <p className="text-sm">
            Допуск к выводам:{' '}
            <span
              className={
                investor.whitelistStatus ? 'text-accent' : 'text-danger'
              }
            >
              {investor.whitelistStatus ? 'открыт' : 'закрыт'}
            </span>
          </p>

          {blocked ? (
            <Notice tone="warning" title="Идёт задержка после смены адреса">
              Контракт вернёт допуск не раньше{' '}
              {formatDateTime(investor.whitelistBlockedUntil)}.
            </Notice>
          ) : null}

          {investor.status === 'APPROVED' &&
          !investor.whitelistStatus &&
          !blocked ? (
            <Notice tone="warning" title="Анкета одобрена, но выводы закрыты">
              Так бывает после повторной проверки: доступ к деньгам возвращается
              отдельным действием.
            </Notice>
          ) : null}

          {investor.status !== 'APPROVED' && !investor.whitelistStatus ? (
            <p className="text-sm text-muted">
              Выводы закрыты на время проверки. Взносы в кампании контракт при
              этом не останавливает.
            </p>
          ) : null}

          {whitelist.isError ? (
            <Notice tone="danger" title={whitelist.error.message} />
          ) : null}

          <Button
            variant={
              investor.status === 'APPROVED' && !investor.whitelistStatus
                ? 'primary'
                : 'secondary'
            }
            loading={whitelist.isPending}
            disabled={!investor.whitelistStatus && blocked}
            onClick={() => whitelist.mutate(!investor.whitelistStatus)}
          >
            {investor.whitelistStatus ? (
              <>
                <ShieldOff size={16} aria-hidden /> Снять допуск
              </>
            ) : (
              <>
                <ShieldCheck size={16} aria-hidden /> Вернуть допуск
              </>
            )}
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * Что инвестор держит. Считается тем же кодом, что и его собственный кабинет:
 * у админа просто другой вход. Без этой карточки страница рассказывает только
 * про анкету, а вопрос «что у человека на руках» остаётся без ответа.
 */
function Holdings({ id }: { id: string }) {
  const holdings = useQuery({
    queryKey: ['investor-holdings', id],
    queryFn: () => api.investors.holdings(id),
  });

  if (holdings.isPending) {
    return (
      <Card>
        <CardTitle>Участия и бумаги</CardTitle>
        <p className="text-sm text-muted">Считаем по контракту…</p>
      </Card>
    );
  }
  if (holdings.isError) {
    return (
      <Card>
        <CardTitle>Участия и бумаги</CardTitle>
        <Notice tone="danger" title={(holdings.error as ApiError).message} />
      </Card>
    );
  }

  const { portfolio } = holdings.data;
  // Погашенные выпуски оставляют строку с нулём бумаг: держать там уже нечего,
  // а участие в них видно выше, в списке кампаний.
  const papers = holdings.data.bonds.rows.filter((row) => row.units !== '0');
  const totals = portfolio.totals;
  const decimals = portfolio.rows[0]?.mintDecimals ?? 6;

  return (
    <Card>
      <CardTitle>Участия и бумаги</CardTitle>

      {portfolio.rows.length === 0 && papers.length === 0 ? (
        <p className="text-sm text-muted">
          Инвестор пока ничего не держит: ни взносов в кампании, ни бумаг.
        </p>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Figure
              label="Размещено"
              value={formatMoney(totals.invested, decimals)}
            />
            <Figure
              label="Получено"
              value={formatMoney(totals.received, decimals)}
            />
            <Figure
              label="Ожидается"
              value={formatMoney(totals.available, decimals)}
            />
            <Figure label="Действующих" value={String(totals.activeCount)} />
          </dl>

          {portfolio.rows.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {portfolio.rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                >
                  <Link
                    href={`/admin/campaigns/${row.id}`}
                    className="font-medium hover:text-accent"
                  >
                    {row.title}
                  </Link>
                  <span className="tabular-nums text-muted">
                    доля {row.shareBps / 100}% · вложено{' '}
                    {formatMoney(row.invested, row.mintDecimals)} · получено{' '}
                    {formatMoney(row.received, row.mintDecimals)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {papers.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {papers.map((row) => (
                <li
                  key={row.campaignId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                >
                  <Link
                    href={`/admin/bonds/${row.campaignId}`}
                    className="font-medium hover:text-accent"
                  >
                    {row.title}
                    {row.isin ? (
                      <span className="ml-2 font-mono text-xs text-muted">
                        {row.isin}
                      </span>
                    ) : null}
                  </Link>
                  <span className="tabular-nums text-muted">
                    {row.units} бумаг
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
