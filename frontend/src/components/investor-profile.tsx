/**
 * Анкета инвестора только для чтения. Одни и те же блоки нужны админу в карточке
 * проверки и самому инвестору в профиле, поэтому лежат здесь, а не в одном из них.
 * Ссылка на файл у них разная, поэтому её передают параметром.
 */
import { ExternalLink, FileText } from 'lucide-react';
import { formatDate, formatSize } from './borrower-bits';
import { formatDateTime } from './money';
import { Card, CardTitle } from './ui';
import {
  ID_DOC_TITLE,
  INVESTOR_DOCUMENT_TITLE,
  SOURCE_OF_FUNDS_TITLE,
  type Country,
  type Investor,
} from '@/lib/types';

/** Название страны по коду; для неизвестного кода возвращает сам код. */
export function countryNamer(countries: Country[] | undefined) {
  return (code: string | null) =>
    code
      ? ((countries ?? []).find((item) => item.code === code)?.name ?? code)
      : '—';
}

export function Row({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-medium break-words">{value?.trim() || '—'}</dd>
    </div>
  );
}

export function CompanyCard({
  investor,
  countryName,
}: {
  investor: Investor;
  countryName: (code: string | null) => string;
}) {
  return (
    <Card>
      <CardTitle>Компания</CardTitle>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Row label="Название" value={investor.companyName} />
        <Row label="Рег. номер" value={investor.registrationNumber} />
        <Row
          label="Страна регистрации"
          value={countryName(investor.companyCountry)}
        />
        <Row
          label="Дата регистрации"
          value={formatDate(investor.incorporatedOn)}
        />
        <Row label="Юридический адрес" value={investor.legalAddress} />
        <Row label="Сайт" value={investor.website} />
      </dl>
    </Card>
  );
}

export function PersonCard({
  investor,
  countryName,
}: {
  investor: Investor;
  countryName: (code: string | null) => string;
}) {
  return (
    <Card>
      <CardTitle>
        {investor.type === 'COMPANY' ? 'Подписант' : 'Личные данные'}
      </CardTitle>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Row
          label="Имя"
          value={`${investor.firstName ?? ''} ${investor.lastName ?? ''}`}
        />
        <Row label="Дата рождения" value={formatDate(investor.dob)} />
        <Row label="Гражданство" value={countryName(investor.nationality)} />
        <Row label="Проживание" value={countryName(investor.country)} />
        <Row
          label="Адрес"
          value={[investor.city, investor.addressLine]
            .filter(Boolean)
            .join(', ')}
        />
        <Row label="Телефон" value={investor.phone} />
        {investor.type === 'COMPANY' ? (
          <Row label="Должность" value={investor.position} />
        ) : null}
      </dl>
    </Card>
  );
}

export function DocumentCard({
  investor,
  countryName,
}: {
  investor: Investor;
  countryName: (code: string | null) => string;
}) {
  return (
    <Card>
      <CardTitle>Документ и декларации</CardTitle>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Row
          label="Тип документа"
          value={investor.idDocType ? ID_DOC_TITLE[investor.idDocType] : null}
        />
        <Row label="Номер" value={investor.idDocNumber} />
        <Row label="Страна выдачи" value={countryName(investor.idDocCountry)} />
        <Row
          label="Действует до"
          value={formatDate(investor.idDocValidUntil)}
        />
        <Row
          label="Источник средств"
          value={
            investor.sourceOfFunds
              ? SOURCE_OF_FUNDS_TITLE[investor.sourceOfFunds]
              : null
          }
        />
        <Row
          label="Публичная должность"
          value={
            investor.isPep === null
              ? null
              : investor.isPep
                ? `да — ${investor.pepDetails ?? 'без пояснения'}`
                : 'нет'
          }
        />
        {investor.sourceOfFundsNote ? (
          <Row label="Пояснение" value={investor.sourceOfFundsNote} />
        ) : null}
        <Row
          label="Согласия приняты"
          value={formatDateTime(investor.termsAcceptedAt)}
        />
      </dl>
    </Card>
  );
}

export function DocumentsCard({
  documents,
  url,
}: {
  documents: Investor['documents'];
  /** Где лежит файл: у админа и у инвестора адреса разные. */
  url: (documentId: string) => string;
}) {
  return (
    <Card>
      <CardTitle>Документы</CardTitle>
      {documents.length === 0 ? (
        <p className="text-sm text-muted">Ничего не приложено.</p>
      ) : (
        <ul className="space-y-2">
          {documents.map((file) => (
            <li key={file.id}>
              <a
                href={url(file.id)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-lg border border-border p-3 transition hover:bg-background"
              >
                <FileText
                  size={18}
                  aria-hidden
                  className="shrink-0 text-muted"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {INVESTOR_DOCUMENT_TITLE[file.kind]}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {file.fileName} · {formatSize(file.sizeBytes)} ·{' '}
                    {formatDate(file.uploadedAt)}
                  </span>
                </span>
                <ExternalLink size={16} aria-hidden className="text-muted" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function BeneficiariesCard({
  investor,
  countryName,
}: {
  investor: Investor;
  countryName: (code: string | null) => string;
}) {
  const total = investor.beneficiaries.reduce(
    (sum, item) => sum + item.shareBps,
    0,
  );
  return (
    <Card>
      <CardTitle>Бенефициары</CardTitle>
      {investor.beneficiaries.length === 0 ? (
        <p className="text-sm text-muted">Не указаны.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {investor.beneficiaries.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-border p-3 text-sm"
              >
                <p className="font-medium">{item.fullName}</p>
                <p className="text-muted">
                  {countryName(item.country)} · {item.shareBps / 100}%
                  {item.position ? ` · ${item.position}` : ''}
                  {item.isPep ? ' · публичная должность' : ''}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted">
            Указано долей: {total / 100}%
          </p>
        </>
      )}
    </Card>
  );
}
