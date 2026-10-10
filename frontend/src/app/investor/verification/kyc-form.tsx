'use client';

/**
 * Шаги анкеты и документов. Вынесены отдельно намеренно: когда проверку заберёт
 * внешний сервис, эти два шага заменит его контейнер, а остальные шаги мастера
 * (тип лица, адрес вывода, декларации) останутся нашими.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatSize } from '@/components/borrower-bits';
import {
  Button,
  Card,
  CardTitle,
  Field,
  Notice,
  Select,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import {
  ID_DOC_TITLE,
  INVESTOR_DOCUMENT_TITLE,
  REQUIRED_DOCUMENTS,
  type BeneficiaryInput,
  type Country,
  type Investor,
  type InvestorDocumentKind,
  type InvestorInput,
} from '@/lib/types';

type Setter = <K extends keyof InvestorInput>(
  key: K,
  value: InvestorInput[K],
) => void;

/** Список стран: запрещённые не показываем — выбрать их всё равно нельзя. */
function CountrySelect({
  label,
  hint,
  value,
  countries,
  onChange,
}: {
  label: string;
  hint?: string;
  value?: string;
  countries: Country[];
  onChange: (code: string) => void;
}) {
  return (
    <Select
      label={label}
      hint={hint}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Не выбрана</option>
      {countries
        .filter((country) => !country.blocked)
        .map((country) => (
          <option key={country.code} value={country.code}>
            {country.name}
          </option>
        ))}
    </Select>
  );
}

export function ProfileFields({
  form,
  set,
  countries,
  isCompany,
}: {
  form: InvestorInput;
  set: Setter;
  countries: Country[];
  isCompany: boolean;
}) {
  return (
    <div className="space-y-4">
      {isCompany ? (
        <Card>
          <CardTitle>Компания</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Полное название"
              placeholder="Dala Holdings Ltd"
              value={form.companyName ?? ''}
              onChange={(event) => set('companyName', event.target.value)}
            />
            <Field
              label="Регистрационный номер"
              value={form.registrationNumber ?? ''}
              onChange={(event) =>
                set('registrationNumber', event.target.value)
              }
            />
            <CountrySelect
              label="Страна регистрации"
              value={form.companyCountry}
              countries={countries}
              onChange={(code) => set('companyCountry', code)}
            />
            <Field
              label="Дата регистрации"
              type="date"
              value={form.incorporatedOn ?? ''}
              onChange={(event) => set('incorporatedOn', event.target.value)}
            />
            <Field
              label="Юридический адрес"
              className="sm:col-span-2"
              value={form.legalAddress ?? ''}
              onChange={(event) => set('legalAddress', event.target.value)}
            />
            <Field
              label="Сайт"
              placeholder="https://"
              value={form.website ?? ''}
              onChange={(event) => set('website', event.target.value)}
            />
            <Field
              label="Должность подписанта"
              placeholder="Директор"
              hint="Кем вы приходитесь компании"
              value={form.position ?? ''}
              onChange={(event) => set('position', event.target.value)}
            />
          </div>
        </Card>
      ) : null}

      <Card>
        <CardTitle>{isCompany ? 'Подписант' : 'Личные данные'}</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Имя"
            placeholder="Ivan"
            hint="Латиницей, как в документе"
            value={form.firstName ?? ''}
            onChange={(event) => set('firstName', event.target.value)}
          />
          <Field
            label="Фамилия"
            placeholder="Petrov"
            value={form.lastName ?? ''}
            onChange={(event) => set('lastName', event.target.value)}
          />
          <Field
            label="Дата рождения"
            type="date"
            value={form.dob ?? ''}
            onChange={(event) => set('dob', event.target.value)}
          />
          <CountrySelect
            label="Гражданство"
            value={form.nationality}
            countries={countries}
            onChange={(code) => set('nationality', code)}
          />
          <CountrySelect
            label="Страна проживания"
            value={form.country}
            countries={countries}
            onChange={(code) => set('country', code)}
          />
          <Field
            label="Город"
            value={form.city ?? ''}
            onChange={(event) => set('city', event.target.value)}
          />
          <Field
            label="Адрес"
            className="sm:col-span-2"
            placeholder="Улица, дом, квартира"
            value={form.addressLine ?? ''}
            onChange={(event) => set('addressLine', event.target.value)}
          />
          <Field
            label="Телефон"
            type="tel"
            placeholder="+7 700 000 00 00"
            value={form.phone ?? ''}
            onChange={(event) => set('phone', event.target.value)}
          />
        </div>
      </Card>

      <Card>
        <CardTitle>Удостоверение личности</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Тип документа"
            value={form.idDocType ?? ''}
            onChange={(event) =>
              set('idDocType', event.target.value as InvestorInput['idDocType'])
            }
          >
            <option value="">Не выбран</option>
            {Object.entries(ID_DOC_TITLE).map(([value, title]) => (
              <option key={value} value={value}>
                {title}
              </option>
            ))}
          </Select>
          <Field
            label="Номер документа"
            value={form.idDocNumber ?? ''}
            onChange={(event) => set('idDocNumber', event.target.value)}
          />
          <CountrySelect
            label="Страна выдачи"
            value={form.idDocCountry}
            countries={countries}
            onChange={(code) => set('idDocCountry', code)}
          />
          <Field
            label="Действует до"
            type="date"
            value={form.idDocValidUntil ?? ''}
            onChange={(event) => set('idDocValidUntil', event.target.value)}
          />
        </div>
      </Card>
    </div>
  );
}

export function DocumentsBlock({ investor }: { investor: Investor }) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ['kyc'] });

  return (
    <Card>
      <CardTitle>Документы</CardTitle>
      <p className="mb-3 text-sm text-muted">
        Подойдут снимок или скан: разворот целиком, без бликов, все углы в
        кадре.
      </p>
      <ul className="space-y-2">
        {REQUIRED_DOCUMENTS[investor.type].map((kind) => (
          <DocumentRow
            key={kind}
            kind={kind}
            file={investor.documents.find((item) => item.kind === kind)}
            onDone={refresh}
          />
        ))}
      </ul>
    </Card>
  );
}

function DocumentRow({
  kind,
  file,
  onDone,
}: {
  kind: InvestorDocumentKind;
  file?: Investor['documents'][number];
  onDone: () => Promise<unknown>;
}) {
  const input = useRef<HTMLInputElement>(null);

  const upload = useMutation<unknown, ApiError, File>({
    mutationFn: (selected) => api.kyc.addDocument(selected, kind),
    onSuccess: onDone,
  });
  const remove = useMutation<unknown, ApiError, void>({
    mutationFn: () => api.kyc.removeDocument(file!.id),
    onSuccess: onDone,
  });

  // Селфи бывает только снимком; остальное принимаем и в PDF.
  const accept =
    kind === 'SELFIE'
      ? 'image/jpeg,image/png'
      : 'application/pdf,image/jpeg,image/png';

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{INVESTOR_DOCUMENT_TITLE[kind]}</p>
          {file ? (
            <p className="truncate text-xs text-muted">
              {file.fileName} · {formatSize(file.sizeBytes)}
            </p>
          ) : (
            <p className="text-xs text-muted">Не загружен</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {file ? (
            <>
              <a
                href={api.kyc.documentUrl(file.id)}
                target="_blank"
                rel="noreferrer"
                className="text-muted hover:text-accent"
                aria-label="Открыть файл"
              >
                <FileCheck2 size={18} aria-hidden />
              </a>
              <button
                aria-label="Удалить файл"
                className="text-muted hover:text-danger"
                onClick={() => remove.mutate()}
              >
                <Trash2 size={18} aria-hidden />
              </button>
            </>
          ) : null}
          <input
            ref={input}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) upload.mutate(selected);
            }}
          />
          <Button
            variant="secondary"
            loading={upload.isPending}
            onClick={() => input.current?.click()}
          >
            <Upload size={16} aria-hidden /> {file ? 'Заменить' : 'Загрузить'}
          </Button>
        </div>
      </div>
      {upload.isError ? (
        <p className="mt-2 text-sm text-danger">{upload.error.message}</p>
      ) : null}
    </li>
  );
}

export function BeneficiariesBlock({
  investor,
  countries,
}: {
  investor: Investor;
  countries: Country[];
}) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ['kyc'] });
  const empty = { fullName: '', country: '', share: '', position: '' };
  const [draft, setDraft] = useState(empty);

  const add = useMutation<unknown, ApiError, BeneficiaryInput>({
    mutationFn: (input) => api.kyc.addBeneficiary(input),
    onSuccess: async () => {
      setDraft(empty);
      await refresh();
    },
  });
  const remove = useMutation<unknown, ApiError, string>({
    mutationFn: (id) => api.kyc.removeBeneficiary(id),
    onSuccess: refresh,
  });

  const share = Number(draft.share.replace(',', '.'));
  const ready =
    draft.fullName.trim().length > 1 &&
    draft.country !== '' &&
    share > 0 &&
    share <= 100;

  return (
    <Card>
      <CardTitle>Бенефициары</CardTitle>
      <p className="mb-3 text-sm text-muted">
        Владельцы с долей от 25%. Если владелец один, укажите его со 100%.
      </p>

      {investor.beneficiaries.length > 0 ? (
        <ul className="mb-4 space-y-2">
          {investor.beneficiaries.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.fullName}</p>
                <p className="text-xs text-muted">
                  {countries.find((country) => country.code === item.country)
                    ?.name ?? item.country}{' '}
                  · {(item.shareBps / 100).toFixed(2).replace(/\.?0+$/, '')}%
                  {item.position ? ` · ${item.position}` : ''}
                </p>
              </div>
              <button
                aria-label="Убрать бенефициара"
                className="shrink-0 text-muted hover:text-danger"
                onClick={() => remove.mutate(item.id)}
              >
                <Trash2 size={18} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Имя и фамилия"
          value={draft.fullName}
          onChange={(event) =>
            setDraft({ ...draft, fullName: event.target.value })
          }
        />
        <CountrySelect
          label="Страна"
          value={draft.country}
          countries={countries}
          onChange={(code) => setDraft({ ...draft, country: code })}
        />
        <Field
          label="Доля, %"
          inputMode="decimal"
          placeholder="25"
          value={draft.share}
          onChange={(event) =>
            setDraft({ ...draft, share: event.target.value })
          }
        />
        <Field
          label="Должность"
          placeholder="Не обязательно"
          value={draft.position}
          onChange={(event) =>
            setDraft({ ...draft, position: event.target.value })
          }
        />
      </div>
      {add.isError ? (
        <div className="mt-3">
          <Notice tone="danger" title={add.error.message} />
        </div>
      ) : null}
      <Button
        variant="secondary"
        className="mt-3"
        disabled={!ready}
        loading={add.isPending}
        onClick={() =>
          add.mutate({
            fullName: draft.fullName.trim(),
            country: draft.country,
            shareBps: Math.round(share * 100),
            position: draft.position.trim() || undefined,
          })
        }
      >
        Добавить бенефициара
      </Button>
    </Card>
  );
}
