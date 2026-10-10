'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ExternalLink, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AccountCard, PasswordCard } from '@/components/account-cards';
import { formatDateTime } from '@/components/money';
import { Copyable } from '@/components/copyable';
import {
  BeneficiariesCard,
  CompanyCard,
  countryNamer,
  DocumentCard,
  DocumentsCard,
  PersonCard,
  Row,
} from '@/components/investor-profile';
import { useSession } from '@/components/session';
import {
  Button,
  buttonStyles,
  Card,
  CardTitle,
  Field,
  Notice,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { isValidSolanaAddress } from '@/lib/validation';
import {
  INVESTOR_TYPE_TITLE,
  KYC_STATUS_TITLE,
  type Investor,
} from '@/lib/types';

export function ProfileView() {
  const { data: user } = useSession();
  const profile = useQuery({ queryKey: ['kyc'], queryFn: api.kyc.me });
  const countries = useQuery({
    queryKey: ['countries'],
    queryFn: api.countries,
  });

  if (!user || profile.isPending) {
    return <p className="text-sm text-muted">Загружаем профиль…</p>;
  }
  if (profile.isError) {
    return <Notice tone="danger" title={(profile.error as ApiError).message} />;
  }

  const { investor, accountUrl } = profile.data;
  const countryName = countryNamer(countries.data);
  const company = investor.type === 'COMPANY';

  return (
    <div className="space-y-4">
      <AccountCard user={user} />
      <PasswordCard />
      <VerificationCard investor={investor} />

      {investor.submittedAt ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {company ? (
              <CompanyCard investor={investor} countryName={countryName} />
            ) : null}
            <PersonCard investor={investor} countryName={countryName} />
            <DocumentCard investor={investor} countryName={countryName} />
          </div>
          <Phone investor={investor} />
          {company ? (
            <BeneficiariesCard investor={investor} countryName={countryName} />
          ) : null}
          <DocumentsCard
            documents={investor.documents}
            url={api.kyc.documentUrl}
          />
        </>
      ) : null}

      {investor.onchainAccount || investor.status === 'APPROVED' ? (
        <Onchain investor={investor} accountUrl={accountUrl} />
      ) : null}

      {investor.submittedAt ? <Consents investor={investor} /> : null}
    </div>
  );
}

// ── Проверка личности ──────────────────────────────────────────────────────

function VerificationCard({ investor }: { investor: Investor }) {
  const editable = ['NOT_STARTED', 'DRAFT', 'RETRY'].includes(investor.status);
  return (
    <Card>
      <CardTitle>Проверка личности</CardTitle>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Row label="Статус" value={KYC_STATUS_TITLE[investor.status]} />
        <Row label="Тип" value={INVESTOR_TYPE_TITLE[investor.type]} />
      </dl>

      {investor.clientComment ? (
        <div className="mt-3">
          <Notice
            tone={investor.status === 'REJECTED' ? 'danger' : 'warning'}
            title="Комментарий платформы"
          >
            {investor.clientComment}
          </Notice>
        </div>
      ) : null}

      <Link
        href="/investor/verification"
        className={buttonStyles(editable ? 'primary' : 'secondary', 'mt-4')}
      >
        {editable ? 'Продолжить проверку' : 'Посмотреть анкету'}{' '}
        <ArrowRight size={16} aria-hidden />
      </Link>
    </Card>
  );
}

/** Телефон — способ связи, а не предмет проверки: его правят и после одобрения. */
function Phone({ investor }: { investor: Investor }) {
  const client = useQueryClient();
  const [phone, setPhone] = useState(investor.phone ?? '');

  const save = useMutation<unknown, ApiError, string>({
    mutationFn: (value) => api.kyc.update({ phone: value }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['kyc'] }),
  });

  return (
    <Card>
      <CardTitle>Связь</CardTitle>
      <p className="mb-3 text-sm text-muted">
        Проверенные данные изменить нельзя — для этого нужна новая проверка.
        Телефон меняется свободно.
      </p>
      <div className="space-y-3">
        <Field
          label="Телефон"
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
        {save.isError ? (
          <Notice tone="danger" title={save.error.message} />
        ) : null}
        <Button
          variant="secondary"
          disabled={phone.trim() === (investor.phone ?? '')}
          loading={save.isPending}
          onClick={() => save.mutate(phone.trim())}
        >
          Сохранить телефон
        </Button>
      </div>
    </Card>
  );
}

// ── Реквизиты в контракте ──────────────────────────────────────────────────

function Onchain({
  investor,
  accountUrl,
}: {
  investor: Investor;
  accountUrl: string | null;
}) {
  const client = useQueryClient();
  const [address, setAddress] = useState('');

  const request = useMutation<unknown, ApiError, string>({
    mutationFn: (value) => api.kyc.requestAddress(value),
    onSuccess: async () => {
      setAddress('');
      await client.invalidateQueries({ queryKey: ['kyc'] });
    },
  });

  const blocked = investor.whitelistBlockedUntil
    ? new Date(investor.whitelistBlockedUntil) > new Date()
    : false;
  const approved = investor.status === 'APPROVED';

  return (
    <Card>
      <CardTitle>Реквизиты в контракте</CardTitle>

      {investor.onchainAccount ? (
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted">Аккаунт инвестора</dt>
            <dd className="mt-0.5 flex flex-wrap items-center gap-2">
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
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Допуск к выводам</dt>
            <dd
              className={
                investor.whitelistStatus
                  ? 'font-medium text-accent'
                  : 'font-medium text-danger'
              }
            >
              {investor.whitelistStatus ? 'открыт' : 'закрыт'}
            </dd>
          </div>
        </dl>
      ) : (
        <Notice tone="warning" title="Аккаунт ещё создаётся">
          Его заводит платформа, участие не требуется. Загляните позже.
        </Notice>
      )}

      {blocked ? (
        <div className="mt-4">
          <Notice tone="warning" title="Выводы временно закрыты">
            Адрес вывода менялся, поэтому контракт держит выводы закрытыми до{' '}
            {formatDateTime(investor.whitelistBlockedUntil)}. Взносы это не
            затрагивает.
          </Notice>
        </div>
      ) : null}

      {!approved && !investor.whitelistStatus ? (
        <div className="mt-4">
          <Notice tone="warning" title="Идёт повторная проверка">
            Пока данные не подтверждены заново, вывод средств закрыт. Взносы в
            кампании это не затрагивает.
          </Notice>
        </div>
      ) : null}

      <div className="mt-4 border-t border-border pt-4">
        <p className="text-sm text-muted">Адрес для вывода средств</p>
        {investor.withdrawalAddress ? (
          <div className="mt-1 mb-3 flex items-center gap-2">
            <ShieldCheck size={18} aria-hidden className="text-accent" />
            <Copyable value={investor.withdrawalAddress} />
          </div>
        ) : null}

        {!approved ? (
          <p className="text-sm text-muted">
            Сменить адрес можно после того, как проверка будет пройдена.
          </p>
        ) : investor.pendingWithdrawalAddress ? (
          <Notice tone="warning" title="Заявка на смену отправлена">
            Новый адрес {investor.pendingWithdrawalAddress} будет установлен
            после проверки платформой.
          </Notice>
        ) : (
          <div className="space-y-3">
            <Field
              label="Новый адрес"
              placeholder="Оставьте пустым, если менять не нужно"
              value={address}
              onChange={(event) => setAddress(event.target.value.trim())}
              hint="Заявку подтверждает платформа; после смены выводы закрыты 48 часов"
            />
            {request.isError ? (
              <Notice tone="danger" title={request.error.message} />
            ) : null}
            <Button
              variant="secondary"
              disabled={!isValidSolanaAddress(address)}
              loading={request.isPending}
              onClick={() => request.mutate(address)}
            >
              Запросить смену адреса
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function Consents({ investor }: { investor: Investor }) {
  return (
    <Card>
      <CardTitle>Согласия</CardTitle>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Row
          label="Условия платформы приняты"
          value={formatDateTime(investor.termsAcceptedAt)}
        />
        <Row
          label="Декларация риска принята"
          value={formatDateTime(investor.riskAcceptedAt)}
        />
        <Row
          label="Анкета подана"
          value={formatDateTime(investor.submittedAt)}
        />
        <Row
          label="Решение принято"
          value={formatDateTime(investor.reviewedAt)}
        />
      </dl>
    </Card>
  );
}
