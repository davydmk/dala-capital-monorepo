'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  Copy,
  FileText,
  ImagePlus,
  Trash2,
  Upload,
} from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { CompanyAvatar } from '@/components/company-avatar';
import { PhotosBlock } from './photos-block';
import { WalletsBlock } from './wallets-block';
import {
  formatDate,
  formatSize,
  formatUsd,
  RatingBadge,
  StatusBadge,
} from '@/components/borrower-bits';
import { BorrowerForm } from '@/components/borrower-form';
import {
  Button,
  Card,
  CardTitle,
  EmptyState,
  Field,
  Notice,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import {
  BORROWER_STATUS_TITLE,
  DOCUMENT_KIND_TITLE,
  type BorrowerDetails as Borrower,
  type BorrowerInput,
  type BorrowerSaveResult,
  type BorrowerStatus,
  type DocumentKind,
  type ActiveInvite,
  type InviteResult,
  PUBLIC_RISK_TITLE,
} from '@/lib/types';

/** Понятные названия полей в журнале изменений. */
const FIELD_TITLE: Record<string, string> = {
  status: 'Статус',
  rating: 'Рейтинг',
  wallet: 'Кошелёк',
  defaultWallet: 'Основной кошелёк',
  userId: 'Кабинет заёмщика',
};

/** Значения в журнале хранятся кодами, показываем их по-человечески. */
function eventValue(field: string, value: string | null): string {
  if (!value) return '—';
  if (field === 'status')
    return BORROWER_STATUS_TITLE[value as BorrowerStatus] ?? value;
  if (field === 'defaultWallet')
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
  if (field === 'userId') return 'создан';
  return value;
}

export function BorrowerDetails({ id }: { id: string }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);

  const borrower = useQuery({
    queryKey: ['borrower', id],
    queryFn: () => api.borrowers.get(id),
  });
  const history = useQuery({
    queryKey: ['borrower-history', id],
    queryFn: () => api.borrowers.history(id),
  });

  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['borrower', id] }),
      client.invalidateQueries({ queryKey: ['borrower-history', id] }),
      client.invalidateQueries({ queryKey: ['borrowers'] }),
    ]);
  };

  const save = useMutation<BorrowerSaveResult, ApiError, BorrowerInput>({
    mutationFn: (values) => api.borrowers.update(id, values),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });

  const uploadLogo = useMutation<unknown, ApiError, File>({
    mutationFn: (file) => api.borrowers.setLogo(id, file),
    onSuccess: () => refresh(),
  });

  if (borrower.isPending)
    return <p className="text-sm text-muted">Загружаем карточку…</p>;
  if (borrower.isError)
    return <Notice tone="danger" title="Карточка не найдена" />;
  const data = borrower.data;

  return (
    <div className="space-y-4">
      <Link
        href="/admin/borrowers"
        className="inline-flex items-center gap-2 text-sm text-muted"
      >
        <ArrowLeft size={16} aria-hidden /> К списку
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <button
          className="relative rounded-full"
          title="Загрузить логотип"
          onClick={() => logoInput.current?.click()}
        >
          <CompanyAvatar
            id={data.id}
            name={data.name}
            hasLogo={Boolean(data.logoKey)}
            size="lg"
          />
          <span className="absolute -right-1 -bottom-1 flex size-7 items-center justify-center rounded-full border border-border bg-surface text-muted">
            <ImagePlus size={14} aria-hidden />
          </span>
        </button>
        <input
          ref={logoInput}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) uploadLogo.mutate(file);
          }}
        />
        <div>
          <h2 className="text-xl font-semibold">{data.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={data.status} />
            <RatingBadge rating={data.rating} />
            {data.rating ? (
              <span className="text-sm text-muted">
                инвестор увидит: {PUBLIC_RISK_TITLE[data.rating].toLowerCase()}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {uploadLogo.isError ? (
        <Notice tone="danger" title={uploadLogo.error.message} />
      ) : null}
      {save.isError ? (
        <Notice tone="danger" title={save.error.message} />
      ) : null}

      {editing ? (
        <BorrowerForm
          submitLabel="Сохранить"
          pending={save.isPending}
          defaultValues={{
            name: data.name,
            bin: data.bin,
            description: data.description ?? '',
            industry: data.industry ?? '',
            address: data.address ?? '',
            website: data.website ?? '',
            foundedAt: data.foundedAt ? data.foundedAt.slice(0, 10) : '',
            annualRevenueUsd: data.annualRevenueUsd
              ? String(data.annualRevenueUsd)
              : '',
            employees: data.employees ? String(data.employees) : '',
            contactName: data.contactName ?? '',
            contactEmail: data.contactEmail ?? '',
            contactPhone: data.contactPhone ?? '',
            rating: data.rating ?? '',
            riskNote: data.riskNote ?? '',
          }}
          onSubmit={(values) => save.mutate(values)}
        />
      ) : (
        <Summary data={data} onEdit={() => setEditing(true)} />
      )}

      <StatusActions
        data={data}
        onChange={(status) => save.mutate({ status })}
      />
      <WalletsBlock id={id} wallets={data.wallets} onChange={refresh} />
      <PhotosBlock id={id} photos={data.photos} onChange={refresh} />
      <Documents id={id} documents={data.documents} onChange={refresh} />
      <Access
        id={id}
        user={data.user}
        invite={data.invites[0]}
        onChange={refresh}
      />

      <Card>
        <CardTitle>Журнал изменений</CardTitle>
        {history.data?.length ? (
          <ul className="space-y-2 text-sm">
            {history.data.map((event) => (
              <li key={event.id} className="flex flex-wrap gap-x-2 text-muted">
                <span className="text-foreground">
                  {FIELD_TITLE[event.field] ?? event.field}
                </span>
                <span>{eventValue(event.field, event.oldValue)} → </span>
                <span className="text-foreground">
                  {eventValue(event.field, event.newValue)}
                </span>
                <span className="ml-auto">
                  {new Date(event.createdAt).toLocaleString('ru-RU')}
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right text-sm break-all">{value}</span>
    </div>
  );
}

function Summary({ data, onEdit }: { data: Borrower; onEdit: () => void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle>Видно инвестору</CardTitle>
        <Row label="Отрасль" value={data.industry ?? '—'} />
        <Row label="Дата регистрации" value={formatDate(data.foundedAt)} />
        <Row label="Сайт" value={data.website ?? '—'} />
        <Row label="Описание" value={data.description ?? '—'} />
      </Card>
      <Card>
        <CardTitle>Только для платформы</CardTitle>
        <Row label="БИН" value={data.bin} />
        <Row label="Адрес" value={data.address ?? '—'} />
        <Row label="Выручка за год" value={formatUsd(data.annualRevenueUsd)} />
        <Row
          label="Сотрудников"
          value={data.employees ? String(data.employees) : '—'}
        />
        <Row
          label="Контакт"
          value={[data.contactName, data.contactEmail, data.contactPhone]
            .filter(Boolean)
            .join(', ')}
        />
        <Row label="Заметка о рисках" value={data.riskNote ?? '—'} />
        <Button variant="secondary" className="mt-3" onClick={onEdit}>
          Править данные
        </Button>
      </Card>
    </div>
  );
}

/** Смена статуса: допуск к кампаниям и архив подтверждаются отдельно. */
function StatusActions({
  data,
  onChange,
}: {
  data: Borrower;
  onChange: (status: BorrowerStatus) => void;
}) {
  // Без кошелька кампанию не собрать, поэтому допуск закрыт.
  const ready = Boolean(data.name && data.bin && data.wallets.length > 0);

  const confirmAnd = (status: BorrowerStatus, question: string) => () => {
    if (window.confirm(question)) onChange(status);
  };

  return (
    <Card>
      <CardTitle>Статус: {BORROWER_STATUS_TITLE[data.status]}</CardTitle>
      {!ready && data.status !== 'APPROVED' ? (
        <p className="mb-3 text-sm text-muted">
          Для допуска к кампаниям заполните название и БИН и добавьте хотя бы
          один кошелёк.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {data.status !== 'APPROVED' ? (
          <Button
            disabled={!ready}
            onClick={confirmAnd(
              'APPROVED',
              'Допустить заёмщика к кампаниям? Он станет доступен для выбора при создании кампании.',
            )}
          >
            Допустить к кампаниям
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={confirmAnd(
              'SUSPENDED',
              'Приостановить? Новые кампании создать будет нельзя.',
            )}
          >
            Приостановить
          </Button>
        )}
        {data.status !== 'ARCHIVED' ? (
          <Button
            variant="danger"
            onClick={confirmAnd(
              'ARCHIVED',
              'Отправить в архив? Карточка исчезнет из списков, но история займов сохранится.',
            )}
          >
            В архив
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => onChange('DRAFT')}>
            Вернуть из архива
          </Button>
        )}
      </div>
    </Card>
  );
}

function Documents({
  id,
  documents,
  onChange,
}: {
  id: string;
  documents: Borrower['documents'];
  onChange: () => Promise<void>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocumentKind>('REGISTRATION');

  const upload = useMutation<unknown, ApiError, File>({
    mutationFn: (file) => api.borrowers.addDocument(id, file, kind),
    onSuccess: async () => {
      if (fileInput.current) fileInput.current.value = '';
      await onChange();
    },
  });
  const remove = useMutation<void, ApiError, string>({
    mutationFn: (documentId) => api.borrowers.removeDocument(id, documentId),
    onSuccess: () => onChange(),
  });

  return (
    <Card>
      <CardTitle>Документы</CardTitle>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block sm:w-64">
          <span className="mb-1.5 block text-sm font-medium">
            Тип документа
          </span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as DocumentKind)}
            className="min-h-11 w-full rounded-lg border border-border bg-surface px-3"
          >
            {Object.entries(DOCUMENT_KIND_TITLE).map(([value, title]) => (
              <option key={value} value={value}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
            }}
          />
          <Button
            variant="secondary"
            loading={upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={18} aria-hidden /> Загрузить файл
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        PDF, JPG или PNG, не больше 10 МБ.
      </p>

      {upload.isError ? (
        <div className="mt-3">
          <Notice tone="danger" title={upload.error.message} />
        </div>
      ) : null}

      {documents.length === 0 ? (
        <EmptyState
          icon={<FileText size={26} aria-hidden />}
          title="Документов пока нет"
        >
          Устав, справка о регистрации, отчётность — всё, что подтверждает
          данные компании.
        </EmptyState>
      ) : (
        <ul className="mt-3 space-y-2">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex items-center gap-3 rounded-lg border border-border p-3"
            >
              <FileText size={18} aria-hidden className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <a
                  href={api.borrowers.documentUrl(id, document.id)}
                  className="block truncate font-medium hover:text-accent"
                >
                  {document.fileName}
                </a>
                <p className="text-xs text-muted">
                  {DOCUMENT_KIND_TITLE[document.kind]} ·{' '}
                  {formatSize(document.sizeBytes)} ·{' '}
                  {formatDate(document.uploadedAt)}
                </p>
              </div>
              <button
                aria-label="Удалить документ"
                className="flex size-11 items-center justify-center rounded-lg text-muted hover:text-danger"
                onClick={() => {
                  if (window.confirm(`Удалить «${document.fileName}»?`))
                    remove.mutate(document.id);
                }}
              >
                <Trash2 size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Доступ в кабинет выдаётся ссылкой: пароль задаёт сам заёмщик.
 * Письма не отправляются, ссылку админ передаёт сам; почта — это будущий логин.
 */
function Access({
  id,
  user,
  invite: active,
  onChange,
}: {
  id: string;
  user: Borrower['user'];
  invite?: ActiveInvite;
  onChange: () => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [copied, setCopied] = useState(false);

  const create = useMutation<InviteResult, ApiError, string>({
    mutationFn: (value) => api.borrowers.invite(id, value),
    onSuccess: async () => {
      setCopied(false);
      await onChange();
    },
  });

  const revoke = useMutation<void, ApiError, void>({
    mutationFn: () => api.borrowers.revokeInvite(id),
    onSuccess: async () => {
      create.reset();
      await onChange();
    },
  });

  const link = create.data
    ? `${window.location.origin}${create.data.path}`
    : '';

  if (user) {
    return (
      <Card>
        <CardTitle>Кабинет заёмщика</CardTitle>
        <p className="text-sm text-muted">
          Вход создан: <span className="text-foreground">{user.email}</span>
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>Кабинет заёмщика</CardTitle>

      {create.data ? (
        <>
          <Notice title="Скопируйте ссылку сейчас">
            Ссылка показывается один раз: в базе хранится только её хеш.
            Потеряете — выпустите новую, старая перестанет работать.
          </Notice>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={link}
              aria-label="Ссылка-приглашение"
              className="min-h-11 w-full rounded-lg border border-border bg-background px-3 font-mono text-xs"
              onFocus={(event) => event.target.select()}
            />
            <Button
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              }}
            >
              {copied ? (
                <>
                  <Check size={16} aria-hidden /> Скопировано
                </>
              ) : (
                <>
                  <Copy size={16} aria-hidden /> Скопировать
                </>
              )}
            </Button>
          </div>
        </>
      ) : active ? (
        <p className="text-sm text-muted">
          Ссылка выпущена {formatDate(active.createdAt)} и действует до{' '}
          {formatDate(active.expiresAt)}. Логин заёмщика:{' '}
          <span className="text-foreground">{active.email}</span>. Саму ссылку
          посмотреть нельзя — выпустите новую, старая перестанет работать.
        </p>
      ) : (
        <p className="mb-3 text-sm text-muted">
          Укажите почту представителя — выдадим ссылку на создание пароля.
          Пароль знает только заёмщик: платформа его не хранит. Письма пока не
          отправляются, ссылку передайте сами.
        </p>
      )}

      {!create.data ? (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field
            label={active ? 'Новая почта' : 'Почта представителя'}
            type="email"
            inputMode="email"
            className="sm:w-80"
            value={email}
            placeholder={active?.email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button
            variant="secondary"
            loading={create.isPending}
            disabled={!(email || active?.email)?.includes('@')}
            onClick={() => create.mutate((email || active?.email || '').trim())}
          >
            {active ? 'Выпустить новую ссылку' : 'Пригласить'}
          </Button>
          {active ? (
            <Button
              variant="ghost"
              loading={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              Отозвать
            </Button>
          ) : null}
        </div>
      ) : null}

      {create.isError ? (
        <div className="mt-3">
          <Notice tone="danger" title={create.error.message} />
        </div>
      ) : null}
    </Card>
  );
}
