'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { AccountCard, PasswordCard } from '@/components/account-cards';
import {
  StatusBadge,
  RatingBadge,
  formatDate,
} from '@/components/borrower-bits';
import { CompanyAvatar } from '@/components/company-avatar';
import { Copyable } from '@/components/copyable';
import { Row } from '@/components/investor-profile';
import { useSession } from '@/components/session';
import { Card, CardTitle, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

/** Профиль заёмщика: учётная запись, карточка компании и кошельки получения. */
export function ProfileView() {
  const { data: user } = useSession();
  const profile = useQuery({
    queryKey: ['borrower-profile'],
    queryFn: api.loans.profile,
  });

  if (!user) return null;

  return (
    <div className="space-y-4">
      <AccountCard user={user} />
      <PasswordCard />

      {profile.isPending ? (
        <p className="text-sm text-muted">Загружаем карточку компании…</p>
      ) : profile.isError ? (
        <Notice tone="danger" title={(profile.error as ApiError).message} />
      ) : (
        <>
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <CompanyAvatar
                id={profile.data.id}
                name={profile.data.name}
                hasLogo={Boolean(profile.data.logoKey)}
              />
              <div>
                <h2 className="text-lg font-semibold">{profile.data.name}</h2>
                <p className="flex items-center gap-2 text-sm text-muted">
                  БИН {profile.data.bin}
                  <StatusBadge status={profile.data.status} />
                  <RatingBadge rating={profile.data.rating} />
                </p>
              </div>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
              <Row label="Отрасль" value={profile.data.industry} />
              <Row label="Юридический адрес" value={profile.data.address} />
              <Row label="Сайт" value={profile.data.website} />
              <Row
                label="Зарегистрирована"
                value={formatDate(profile.data.foundedAt)}
              />
              <Row
                label="Сотрудников"
                value={
                  profile.data.employees
                    ? String(profile.data.employees)
                    : undefined
                }
              />
              <Row label="Контактное лицо" value={profile.data.contactName} />
              <Row label="Телефон" value={profile.data.contactPhone} />
              <Row label="Почта" value={profile.data.contactEmail} />
            </dl>

            <p className="mt-3 text-sm text-muted">
              Данные компании и рейтинг ведёт платформа: они опираются на
              документы, которые вы предоставили. Если что-то изменилось —
              напишите нам, и мы обновим карточку.
            </p>
          </Card>

          <Card>
            <CardTitle>Кошельки для получения займа</CardTitle>
            <p className="mb-3 text-sm text-muted">
              На один из этих адресов придут собранные деньги, когда платформа
              закроет сбор. Адрес кампании выбирается при её создании, а сменить
              его можно до закрытия сбора — через платформу.
            </p>

            {profile.data.wallets.length === 0 ? (
              <Notice tone="warning" title="Кошелёк не указан">
                Без адреса получения кампанию нельзя опубликовать. Пришлите нам
                адрес в сети Solana — тот, с которого вы сможете распорядиться
                деньгами.
              </Notice>
            ) : (
              <ul className="space-y-2">
                {profile.data.wallets.map((wallet) => (
                  <li
                    key={wallet.id}
                    className="rounded-lg border border-border p-3"
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {wallet.label}
                      </span>
                      {wallet.isDefault ? (
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
                          основной
                        </span>
                      ) : null}
                      <a
                        href={wallet.url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-accent"
                      >
                        Обозреватель <ExternalLink size={12} aria-hidden />
                      </a>
                    </div>
                    <Copyable value={wallet.address} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
