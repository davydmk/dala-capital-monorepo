'use client';

/** Форма карточки заёмщика: общая для создания и правки. */
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Card, CardTitle, Field, Notice } from '@/components/ui';
import { isValidBin, isValidSolanaAddress } from '@/lib/validation';
import {
  RATING_TITLE,
  type BorrowerInput,
  type CreditRating,
} from '@/lib/types';

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const schema = z.object({
  name: z.string().trim().min(2, 'Название от 2 символов').max(200),
  bin: z
    .string()
    .trim()
    .refine(
      isValidBin,
      'БИН — 12 цифр; проверьте контрольную цифру, скорее всего опечатка',
    ),
  description: optionalText,
  industry: optionalText,
  address: optionalText,
  website: optionalText,
  foundedAt: optionalText,
  annualRevenueUsd: z
    .string()
    .trim()
    .optional()
    .transform((value) =>
      value ? Number(value.replace(/\s/g, '')) : undefined,
    )
    .refine(
      (value) => value === undefined || Number.isFinite(value),
      'Только цифры',
    ),
  employees: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? Number(value) : undefined))
    .refine(
      (value) => value === undefined || Number.isInteger(value),
      'Только целое число',
    ),
  contactName: optionalText,
  contactEmail: z
    .union([z.literal(''), z.email('Некорректная почта')])
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  contactPhone: optionalText,
  payoutWallet: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === '' ? undefined : value))
    .refine(
      (value) => value === undefined || isValidSolanaAddress(value),
      'Не похоже на адрес Solana',
    ),
  rating: z.union([z.literal(''), z.enum(['A', 'B', 'C', 'D'])]).optional(),
  riskNote: optionalText,
});

/** В форме всё строки, после разбора — числа и нужные типы. */
type FormValues = z.input<typeof schema>;
type ParsedValues = z.output<typeof schema>;

export function BorrowerForm({
  defaultValues,
  submitLabel,
  error,
  pending,
  onSubmit,
}: {
  defaultValues?: Partial<FormValues>;
  submitLabel: string;
  error?: string;
  pending?: boolean;
  onSubmit: (values: BorrowerInput) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues, unknown, ParsedValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={handleSubmit((values) =>
        // Пустая строка в селекте рейтинга означает «не присвоен».
        onSubmit({
          ...values,
          rating: (values.rating || undefined) as CreditRating | undefined,
        }),
      )}
    >
      <Card>
        <CardTitle>Видно инвестору</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Название"
            placeholder="ТОО «Астана Трейд»"
            error={errors.name?.message}
            {...register('name')}
          />
          <Field
            label="Отрасль"
            placeholder="Оптовая торговля"
            error={errors.industry?.message}
            {...register('industry')}
          />
          <Field
            label="Дата регистрации"
            type="date"
            error={errors.foundedAt?.message}
            {...register('foundedAt')}
          />
          <Field
            label="Сайт"
            placeholder="astana-trade.kz"
            error={errors.website?.message}
            {...register('website')}
          />
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium">Описание</span>
            <textarea
              rows={3}
              placeholder="Чем занимается компания: это увидят инвесторы на витрине"
              className="w-full rounded-lg border border-border bg-surface p-3 placeholder:text-muted"
              {...register('description')}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Рейтинг</span>
            <select
              className="min-h-11 w-full rounded-lg border border-border bg-surface px-3"
              {...register('rating')}
            >
              <option value="">Не присвоен</option>
              {Object.entries(RATING_TITLE).map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <Card>
        <CardTitle>Только для платформы</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="БИН"
            inputMode="numeric"
            maxLength={12}
            placeholder="12 цифр"
            error={errors.bin?.message}
            {...register('bin')}
          />
          <Field
            label="Юридический адрес"
            error={errors.address?.message}
            {...register('address')}
          />
          <Field
            label="Годовая выручка, $"
            inputMode="numeric"
            placeholder="2400000"
            error={errors.annualRevenueUsd?.message}
            {...register('annualRevenueUsd')}
          />
          <Field
            label="Сотрудников"
            inputMode="numeric"
            error={errors.employees?.message}
            {...register('employees')}
          />
          <Field
            label="Контактное лицо"
            error={errors.contactName?.message}
            {...register('contactName')}
          />
          <Field
            label="Почта контакта"
            type="email"
            inputMode="email"
            error={errors.contactEmail?.message}
            {...register('contactEmail')}
          />
          <Field
            label="Телефон"
            type="tel"
            inputMode="tel"
            error={errors.contactPhone?.message}
            {...register('contactPhone')}
          />
          <Field
            label="Кошелёк для получения займа"
            placeholder="Адрес Solana"
            hint="Сюда уйдёт вся сумма займа. Биржевой адрес с обязательным memo не подойдёт"
            error={errors.payoutWallet?.message}
            className="font-mono"
            {...register('payoutWallet')}
          />
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium">
              Заметка о рисках
            </span>
            <textarea
              rows={3}
              placeholder="Что проверяли, почему такой рейтинг"
              className="w-full rounded-lg border border-border bg-surface p-3 placeholder:text-muted"
              {...register('riskNote')}
            />
          </label>
        </div>
      </Card>

      {error ? <Notice tone="danger" title={error} /> : null}

      <div className="flex gap-3">
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
