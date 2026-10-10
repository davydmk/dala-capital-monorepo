'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Send,
  User as UserIcon,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import clsx from 'clsx';
import { formatDateTime } from '@/components/money';
import {
  Button,
  buttonStyles,
  Card,
  CardTitle,
  Checkbox,
  Field,
  Notice,
  Select,
  TextArea,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { BeneficiariesBlock, DocumentsBlock, ProfileFields } from './kyc-form';
import { isValidSolanaAddress } from '@/lib/validation';
import {
  INVESTOR_TYPE_TITLE,
  KYC_STATUS_TITLE,
  SOURCE_OF_FUNDS_TITLE,
  type Country,
  type Investor,
  type InvestorCheck,
  type InvestorInput,
  type InvestorType,
  type SourceOfFunds,
} from '@/lib/types';

const STEPS = [
  'Кто вы',
  'Анкета',
  'Документы',
  'Адрес вывода',
  'Подтверждение',
];

/** Статусы, в которых анкету ещё можно менять. */
const EDITABLE = ['NOT_STARTED', 'DRAFT', 'RETRY'];

/** Дата из ISO в значение поля «дата». */
const toDateInput = (value: string | null) => value?.slice(0, 10) ?? '';

export function Verification() {
  const profile = useQuery({ queryKey: ['kyc'], queryFn: api.kyc.me });
  const countries = useQuery({
    queryKey: ['countries'],
    queryFn: api.countries,
  });

  if (profile.isPending || countries.isPending) {
    return <p className="text-sm text-muted">Загружаем анкету…</p>;
  }
  if (profile.isError) {
    return <Notice tone="danger" title={(profile.error as ApiError).message} />;
  }
  if (countries.isError) {
    return (
      <Notice tone="danger" title="Не удалось загрузить справочник стран" />
    );
  }

  const { investor, checks } = profile.data;
  return EDITABLE.includes(investor.status) ? (
    <Wizard
      key={investor.id}
      investor={investor}
      checks={checks}
      countries={countries.data}
    />
  ) : (
    <StatusScreen investor={investor} />
  );
}

// ── Мастер ─────────────────────────────────────────────────────────────────

function Wizard({
  investor,
  checks,
  countries,
}: {
  investor: Investor;
  checks: InvestorCheck[];
  countries: Country[];
}) {
  const client = useQueryClient();
  const [step, setStep] = useState(Math.min(investor.step, STEPS.length));
  const [form, setForm] = useState<InvestorInput>({
    type: investor.type,
    firstName: investor.firstName ?? '',
    lastName: investor.lastName ?? '',
    dob: toDateInput(investor.dob),
    nationality: investor.nationality ?? '',
    country: investor.country ?? '',
    addressLine: investor.addressLine ?? '',
    city: investor.city ?? '',
    phone: investor.phone ?? '',
    position: investor.position ?? '',
    idDocType: investor.idDocType ?? undefined,
    idDocNumber: investor.idDocNumber ?? '',
    idDocCountry: investor.idDocCountry ?? '',
    idDocValidUntil: toDateInput(investor.idDocValidUntil),
    companyName: investor.companyName ?? '',
    registrationNumber: investor.registrationNumber ?? '',
    incorporatedOn: toDateInput(investor.incorporatedOn),
    companyCountry: investor.companyCountry ?? '',
    legalAddress: investor.legalAddress ?? '',
    website: investor.website ?? '',
    withdrawalAddress: investor.withdrawalAddress ?? '',
    sourceOfFunds: investor.sourceOfFunds ?? undefined,
    sourceOfFundsNote: investor.sourceOfFundsNote ?? '',
    isPep: investor.isPep ?? undefined,
    pepDetails: investor.pepDetails ?? '',
    acceptTerms: Boolean(investor.termsAcceptedAt),
    acceptRisk: Boolean(investor.riskAcceptedAt),
  });

  const set: Setter = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = useMutation<unknown, ApiError, number>({
    mutationFn: (next) => api.kyc.update({ ...form, step: next }),
    onSuccess: async (_data, next) => {
      setStep(next);
      await client.invalidateQueries({ queryKey: ['kyc'] });
    },
  });

  const submit = useMutation<unknown, ApiError, void>({
    // Перед отправкой сохраняем последний шаг: иначе галочки останутся в браузере.
    mutationFn: async () => {
      await api.kyc.update({ ...form, step: STEPS.length });
      return api.kyc.submit();
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['kyc'] }),
  });

  const goTo = (next: number) =>
    save.mutate(Math.min(Math.max(next, 1), STEPS.length));

  const isCompany = form.type === 'COMPANY';
  const addressOk = isValidSolanaAddress(form.withdrawalAddress ?? '');
  const failed = checks.filter((check) => !check.ok);

  return (
    <div className="space-y-4">
      {investor.status === 'RETRY' ? (
        <Notice tone="warning" title="Анкету вернули на доработку">
          {investor.clientComment ??
            'Проверьте данные и приложите документы заново.'}
        </Notice>
      ) : null}

      <StepBar step={step} onSelect={goTo} />

      {save.isError ? (
        <Notice tone="danger" title={save.error.message} />
      ) : null}

      {step === 1 ? (
        <Card>
          <CardTitle>Кто будет инвестором</CardTitle>
          <p className="mb-3 text-sm text-muted">
            От этого зависит, какие документы понадобятся. Поменять выбор после
            отправки анкеты уже нельзя.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['INDIVIDUAL', 'COMPANY'] as InvestorType[]).map((value) => (
              <button
                key={value}
                onClick={() => set('type', value)}
                aria-pressed={form.type === value}
                className={clsx(
                  'flex items-start gap-3 rounded-xl border p-4 text-left transition',
                  form.type === value
                    ? 'border-accent bg-accent-soft'
                    : 'border-border hover:bg-background',
                )}
              >
                {value === 'INDIVIDUAL' ? (
                  <UserIcon size={20} aria-hidden className="mt-0.5" />
                ) : (
                  <Building2 size={20} aria-hidden className="mt-0.5" />
                )}
                <span>
                  <span className="block font-medium">
                    {INVESTOR_TYPE_TITLE[value]}
                  </span>
                  <span className="mt-1 block text-sm text-muted">
                    {value === 'INDIVIDUAL'
                      ? 'Документ, селфи и анкета — обычно проверяем за день'
                      : 'Дополнительно устав, выписка из реестра и бенефициары'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {step === 2 ? (
        <ProfileFields
          form={form}
          set={set}
          countries={countries}
          isCompany={isCompany}
        />
      ) : null}

      {step === 3 ? (
        <div className="space-y-4">
          <DocumentsBlock investor={investor} />
          {isCompany ? (
            <BeneficiariesBlock investor={investor} countries={countries} />
          ) : null}
        </div>
      ) : null}

      {step === 4 ? (
        <Card>
          <CardTitle>Адрес для вывода средств</CardTitle>
          <div className="space-y-4">
            <Notice tone="info" title="Куда пойдут деньги">
              На этот адрес контракт переводит всё, что вам причитается: тело
              займа, проценты и возврат при несостоявшемся сборе. Подключать
              кошелёк не нужно — платформа ничего не подписывает от вашего
              имени.
            </Notice>
            <Field
              label="Адрес кошелька Solana"
              placeholder="Начинается с букв и цифр, 32–44 символа"
              value={form.withdrawalAddress ?? ''}
              onChange={(event) =>
                set('withdrawalAddress', event.target.value.trim())
              }
              error={
                form.withdrawalAddress && !addressOk
                  ? 'Не похоже на адрес Solana'
                  : undefined
              }
              hint="Это адрес кошелька, а не токен-счёт: счёт для USDC контракт создаст сам"
            />
            <Notice tone="warning" title="Сменить адрес можно, но не мгновенно">
              После смены контракт закрывает выводы на 48 часов. Так у вас есть
              время заметить чужое вмешательство, если доступ к кабинету
              украдут.
            </Notice>
          </div>
        </Card>
      ) : null}

      {step === 5 ? (
        <div className="space-y-4">
          <Card>
            <CardTitle>Источник средств</CardTitle>
            <div className="space-y-4">
              <Select
                label="Откуда средства для вложений"
                value={form.sourceOfFunds ?? ''}
                onChange={(event) =>
                  set(
                    'sourceOfFunds',
                    (event.target.value || undefined) as SourceOfFunds,
                  )
                }
              >
                <option value="">Не выбрано</option>
                {Object.entries(SOURCE_OF_FUNDS_TITLE).map(([value, title]) => (
                  <option key={value} value={value}>
                    {title}
                  </option>
                ))}
              </Select>
              <TextArea
                label="Пояснение"
                rows={2}
                placeholder="Не обязательно"
                value={form.sourceOfFundsNote ?? ''}
                onChange={(event) =>
                  set('sourceOfFundsNote', event.target.value)
                }
              />
            </div>
          </Card>

          <Card>
            <CardTitle>Публичная должность</CardTitle>
            <p className="mb-3 text-sm text-muted">
              Публичное должностное лицо — это госслужащий, депутат, судья,
              руководитель госкомпании, а также их близкие родственники. Ответ
              «да» не отказ: проверка просто займёт больше времени.
            </p>
            <div className="flex gap-2">
              {[
                { value: false, label: 'Нет' },
                { value: true, label: 'Да' },
              ].map((option) => (
                <button
                  key={String(option.value)}
                  onClick={() => set('isPep', option.value)}
                  aria-pressed={form.isPep === option.value}
                  className={clsx(
                    'min-h-11 flex-1 rounded-lg border px-4 text-sm font-medium',
                    form.isPep === option.value
                      ? 'border-accent bg-accent-soft'
                      : 'border-border',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {form.isPep ? (
              <div className="mt-4">
                <TextArea
                  label="Должность и страна"
                  rows={2}
                  value={form.pepDetails ?? ''}
                  onChange={(event) => set('pepDetails', event.target.value)}
                />
              </div>
            ) : null}
          </Card>

          <Card>
            <CardTitle>Согласия</CardTitle>
            <Checkbox
              label="Я подтверждаю, что данные анкеты верны, и принимаю условия платформы"
              checked={form.acceptTerms ?? false}
              onChange={(event) => set('acceptTerms', event.target.checked)}
            />
            <Checkbox
              label="Я понимаю, что заём может быть не возвращён"
              hint="Dala Capital не гарантирует доход и не возмещает потери при дефолте заёмщика."
              checked={form.acceptRisk ?? false}
              onChange={(event) => set('acceptRisk', event.target.checked)}
            />
          </Card>

          <Card>
            <CardTitle>Что осталось заполнить</CardTitle>
            {failed.length === 0 ? (
              <p className="text-sm text-muted">
                Анкета заполнена. Проверка обычно занимает один рабочий день.
              </p>
            ) : (
              <ul className="space-y-2">
                {failed.map((check) => (
                  <li key={check.key} className="flex items-start gap-2">
                    <X size={16} aria-hidden className="mt-0.5 text-danger" />
                    <span className="text-sm">
                      {check.title}
                      {check.hint ? (
                        <span className="block text-muted">{check.hint}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">
              Список обновляется после сохранения шага.
            </p>
          </Card>

          {submit.isError ? (
            <Notice tone="danger" title={submit.error.message} />
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="secondary"
          disabled={step === 1}
          onClick={() => goTo(step - 1)}
        >
          <ArrowLeft size={18} aria-hidden /> Назад
        </Button>
        {step < STEPS.length ? (
          <Button loading={save.isPending} onClick={() => goTo(step + 1)}>
            Далее <ArrowRight size={18} aria-hidden />
          </Button>
        ) : (
          <Button loading={submit.isPending} onClick={() => submit.mutate()}>
            <Send size={18} aria-hidden /> Отправить на проверку
          </Button>
        )}
      </div>
    </div>
  );
}

type Setter = <K extends keyof InvestorInput>(
  key: K,
  value: InvestorInput[K],
) => void;

function StepBar({
  step,
  onSelect,
}: {
  step: number;
  onSelect: (step: number) => void;
}) {
  return (
    <ol className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      {STEPS.map((title, index) => {
        const number = index + 1;
        const done = number < step;
        return (
          <li key={title}>
            <button
              onClick={() => onSelect(number)}
              aria-current={number === step ? 'step' : undefined}
              className={clsx(
                'flex min-h-9 shrink-0 items-center gap-2 rounded-full px-3 text-sm',
                number === step
                  ? 'bg-accent text-white'
                  : 'border border-border text-muted',
              )}
            >
              <span className="font-medium">
                {done ? <Check size={14} aria-hidden /> : number}
              </span>
              {title}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ── Экран статуса ──────────────────────────────────────────────────────────

function StatusScreen({ investor }: { investor: Investor }) {
  return (
    <div className="space-y-4">
      {investor.status === 'PENDING' ? (
        <Notice tone="info" title="Анкета на проверке">
          Отправлена {formatDateTime(investor.submittedAt)}. Обычно проверка
          занимает один рабочий день; решение появится здесь и в профиле.
        </Notice>
      ) : null}

      {investor.status === 'ON_HOLD' ? (
        <Notice tone="warning" title="Проверка отложена">
          {investor.clientComment ??
            'Нужны уточнения. Мы свяжемся с вами по почте, указанной при регистрации.'}
        </Notice>
      ) : null}

      {investor.status === 'REJECTED' ? (
        <Notice tone="danger" title="В доступе отказано">
          {investor.clientComment ??
            'Мы не можем принять вас как инвестора платформы.'}
        </Notice>
      ) : null}

      {investor.status === 'APPROVED' ? (
        <Notice tone="info" title="Проверка пройдена">
          Вы допущены к кампаниям платформы. Аккаунт инвестора заведён в
          контракте: выплаты пойдут на указанный адрес вывода.
        </Notice>
      ) : null}

      <Card>
        <CardTitle>Анкета</CardTitle>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Row label="Статус" value={KYC_STATUS_TITLE[investor.status]} />
          <Row label="Тип" value={INVESTOR_TYPE_TITLE[investor.type]} />
          <Row
            label="Отправлена"
            value={formatDateTime(investor.submittedAt)}
          />
          <Row
            label="Документов приложено"
            value={String(investor.documents.length)}
          />
        </dl>
        <Link
          href="/investor/profile"
          className={buttonStyles('secondary', 'mt-4')}
        >
          Вернуться в профиль
        </Link>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-medium">{value || '—'}</dd>
    </div>
  );
}
