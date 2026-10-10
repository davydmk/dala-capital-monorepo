'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Rocket,
  Save,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CompanyAvatar } from '@/components/company-avatar';
import {
  bpsToPercent,
  formatDateTime,
  formatMoney,
  fromLocalInput,
  fromMicro,
  percentToBps,
  toLocalInput,
  toMicro,
} from '@/components/money';
import { ScheduleTable } from '@/components/schedule-table';
import {
  Button,
  buttonStyles,
  Card,
  CardTitle,
  Field,
  Notice,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { words } from '@/lib/wording';
import {
  SCHEDULE_KIND_TITLE,
  SCHEDULE_STEP_TITLE,
  type Campaign,
  type CampaignInput,
  type ScheduleKind,
  type ScheduleStep,
} from '@/lib/types';

/** Склонение числительных: «1 день», «2 дня», «5 дней». */
function plural(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? one
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? few
        : many;
  return `${count} ${word}`;
}

const STEPS = ['Заёмщик', 'Деньги', 'Условия', 'График', 'Проверка'];

/** Названия шага в родительном падеже: «дедлайн плюс месяц». */
const STEP_NAME: Record<ScheduleStep, string> = {
  YEAR: 'год',
  HALF_YEAR: 'полгода',
  QUARTER: 'квартал',
  MONTH: 'месяц',
  WEEK: 'неделя',
  DAY: 'день',
  HOUR: 'час',
};

const DAY_MS = 24 * 60 * 60 * 1000;

const STEP_MS: Record<ScheduleStep, number> = {
  YEAR: 360 * DAY_MS,
  HALF_YEAR: 180 * DAY_MS,
  QUARTER: 90 * DAY_MS,
  MONTH: 30 * DAY_MS,
  WEEK: 7 * DAY_MS,
  DAY: DAY_MS,
  HOUR: 60 * 60 * 1000,
};

/**
 * Периодичность платежей — одно поле вместо двух. Делитель ставки и интервал
 * между датами обязаны совпадать: при 4 платежах в году и месячном шаге даты
 * шли бы ежемесячно, а проценты считались квартальные.
 */
const FREQUENCY: {
  periodsPerYear: number;
  step: ScheduleStep;
  title: string;
}[] = [
  { periodsPerYear: 12, step: 'MONTH', title: 'Ежемесячно' },
  { periodsPerYear: 4, step: 'QUARTER', title: 'Раз в квартал' },
  { periodsPerYear: 2, step: 'HALF_YEAR', title: 'Раз в полгода' },
  { periodsPerYear: 1, step: 'YEAR', title: 'Раз в год' },
];

/** Короткие шаги оставлены для прогона цикла за день — ставку они не делят. */
const FAST_STEPS: ScheduleStep[] = ['WEEK', 'DAY', 'HOUR'];

const isFast = (step: ScheduleStep) => FAST_STEPS.includes(step);

/** Какая периодичность выбрана: по делителю ставки, шаг мог быть ускорен. */
const frequencyOf = (periodsPerYear: number) =>
  FREQUENCY.find((item) => item.periodsPerYear === periodsPerYear) ??
  FREQUENCY[0];

/** Дата первого платежа по умолчанию: дедлайн сбора плюс один период. */
function shiftByStep(localDeadline: string, step: ScheduleStep): string {
  if (!localDeadline) return '';
  const shifted = new Date(new Date(localDeadline).getTime() + STEP_MS[step]);
  return new Date(shifted.getTime() - shifted.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

/** Форма держит строки: числа и даты приводим к виду API при сохранении. */
interface FormState {
  title: string;
  walletId: string;
  purpose: string;
  collateral: string;
  softCap: string;
  hardCap: string;
  minTicket: string;
  bondFaceValue: string;
  bondName: string;
  bondSymbol: string;
  bondUri: string;
  maxTicket: string;
  annualRate: string;
  periodsPerYear: number;
  periodCount: string;
  mint: string;
  mintDecimals: number;
  scheduleKind: ScheduleKind;
  scheduleStep: ScheduleStep;
  fundingStart: string;
  fundingDeadline: string;
  firstDueAt: string;
  penaltyRate: string;
  defaultThresholdDays: string;
  prepaymentFee: string;
  platformFee: string;
  cancelGraceDays: string;
}

const toForm = (campaign: Campaign): FormState => ({
  title: campaign.title,
  walletId: campaign.walletId ?? '',
  purpose: campaign.purpose ?? '',
  collateral: campaign.collateral ?? '',
  softCap: fromMicro(campaign.softCap, false),
  hardCap: fromMicro(campaign.hardCap, false),
  minTicket: fromMicro(campaign.minTicket, false),
  bondFaceValue: fromMicro(campaign.bondFaceValue, false),
  bondName: campaign.bondName ?? '',
  bondSymbol: campaign.bondSymbol ?? '',
  bondUri: campaign.bondUri ?? '',
  maxTicket: fromMicro(campaign.maxTicket, false),
  annualRate: bpsToPercent(campaign.annualRateBps),
  periodsPerYear: campaign.periodsPerYear ?? 12,
  periodCount: campaign.periodCount ? String(campaign.periodCount) : '',
  mint: campaign.mint ?? '',
  mintDecimals: campaign.mintDecimals ?? 6,
  scheduleKind: campaign.scheduleKind ?? 'ANNUITY',
  scheduleStep: campaign.scheduleStep ?? 'MONTH',
  fundingStart: toLocalInput(campaign.fundingStart),
  fundingDeadline: toLocalInput(campaign.fundingDeadline),
  firstDueAt: toLocalInput(campaign.firstDueAt),
  penaltyRate: bpsToPercent(campaign.penaltyRateBps),
  defaultThresholdDays: String(campaign.defaultThresholdDays ?? 90),
  prepaymentFee: bpsToPercent(campaign.prepaymentFeeBps),
  platformFee: bpsToPercent(campaign.platformFeeBps),
  cancelGraceDays: String(campaign.cancelGraceDays ?? 7),
});

const toInput = (form: FormState): CampaignInput => ({
  title: form.title.trim(),
  walletId: form.walletId || undefined,
  purpose: form.purpose.trim(),
  collateral: form.collateral.trim(),
  softCap: form.softCap ? toMicro(form.softCap) : undefined,
  hardCap: form.hardCap ? toMicro(form.hardCap) : undefined,
  minTicket: form.minTicket ? toMicro(form.minTicket) : undefined,
  bondFaceValue: form.bondFaceValue ? toMicro(form.bondFaceValue) : undefined,
  bondName: form.bondName.trim() || undefined,
  bondSymbol: form.bondSymbol.trim() || undefined,
  bondUri: form.bondUri.trim() || undefined,
  maxTicket: toMicro(form.maxTicket || '0'),
  annualRateBps: form.annualRate ? percentToBps(form.annualRate) : undefined,
  periodsPerYear: form.periodsPerYear,
  periodCount: form.periodCount ? Number(form.periodCount) : undefined,
  mint: form.mint || undefined,
  mintDecimals: form.mintDecimals,
  scheduleKind: form.scheduleKind,
  scheduleStep: form.scheduleStep,
  fundingStart: fromLocalInput(form.fundingStart),
  fundingDeadline: fromLocalInput(form.fundingDeadline),
  firstDueAt: fromLocalInput(form.firstDueAt),
  penaltyRateBps: percentToBps(form.penaltyRate || '0'),
  defaultThresholdDays: Number(form.defaultThresholdDays || 90),
  // У облигации досрочного погашения нет, значит и комиссии за него быть
  // не может: контракт такую кампанию не примет.
  prepaymentFeeBps:
    form.scheduleKind === 'COUPON'
      ? 0
      : percentToBps(form.prepaymentFee || '0'),
  platformFeeBps: percentToBps(form.platformFee || '0'),
  cancelGraceDays: Number(form.cancelGraceDays || 7),
});

export function CampaignWizard({ campaign }: { campaign: Campaign }) {
  const router = useRouter();
  const client = useQueryClient();
  const [form, setForm] = useState<FormState>(() => toForm(campaign));
  const [step, setStep] = useState(campaign.step ?? 1);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = useMutation<Campaign, ApiError, number>({
    mutationFn: (nextStep) =>
      api.campaigns.update(campaign.id, {
        ...toInput(form),
        // Токен не лежит в форме: его не выбирают, а берут из настроек.
        mint: mint || undefined,
        mintDecimals: decimals,
        step: nextStep,
      }),
    onSuccess: async (_data, nextStep) => {
      setStep(nextStep);
      await client.invalidateQueries({ queryKey: ['campaign', campaign.id] });
      await client.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });

  // Список разрешённых токенов: расчётный берётся из него сам.
  const tokens = useQuery({
    queryKey: ['platform'],
    queryFn: api.platform.state,
  });

  // Выбора токена в мастере нет: всегда последний разрешённый платформой.
  // Черновик ещё не в контракте, так что подменить его токен безопасно —
  // а вот молча оставить старый значит собрать кампанию не в том токене.
  // Слова зависят от схемы: у кредита сбор и взносы, у облигации размещение
  // и заявки. Подписи переключаются вместе с селектом, на лету.
  const w = words(form.scheduleKind);
  const allowed = tokens.data?.tokens ?? [];
  const token = allowed[allowed.length - 1];
  const mint = token?.address ?? form.mint;
  // Число знаков у токенов разное: без него суммы разъедутся.
  const decimals = token?.decimals ?? form.mintDecimals;

  // Предпросмотр считает сервер — теми же формулами, что и контракт.
  const preview = useQuery({
    queryKey: ['campaign-preview', campaign.id, step],
    queryFn: () => api.campaigns.preview(campaign.id),
    enabled: step >= 4,
    retry: false,
  });

  const checks = useQuery({
    queryKey: ['campaign-checks', campaign.id, step],
    queryFn: () => api.campaigns.checks(campaign.id),
    enabled: step === 5,
  });

  const publish = useMutation<Campaign, ApiError, void>({
    mutationFn: () => api.campaigns.publish(campaign.id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['campaign', campaign.id] });
      router.refresh();
    },
  });

  const goTo = (next: number) =>
    save.mutate(Math.min(Math.max(next, 1), STEPS.length));
  const fastSchedule = isFast(form.scheduleStep);

  return (
    <div className="space-y-4">
      <Link
        href="/admin/campaigns"
        className="inline-flex items-center gap-2 text-sm text-muted"
      >
        <ArrowLeft size={16} aria-hidden /> К списку кампаний
      </Link>

      <StepBar step={step} onSelect={goTo} />

      {save.isError ? (
        <Notice tone="danger" title={save.error.message} />
      ) : null}

      {step === 1 ? (
        <Card>
          <CardTitle>Заёмщик и кошелёк</CardTitle>
          <div className="mb-4 flex items-center gap-3">
            <CompanyAvatar
              id={campaign.borrower.id}
              name={campaign.borrower.name}
              hasLogo={Boolean(campaign.borrower.logoKey)}
            />
            <div>
              <p className="font-medium">{campaign.borrower.name}</p>
              <p className="text-sm text-muted">БИН {campaign.borrower.bin}</p>
            </div>
          </div>

          <div className="space-y-4">
            <Field
              label="Название кампании"
              placeholder="Оборотный заём на закуп товара"
              value={form.title}
              onChange={(event) => set('title', event.target.value)}
            />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">
                Кошелёк получения займа
              </span>
              <select
                className="min-h-11 w-full rounded-lg border border-border bg-surface px-3"
                value={form.walletId}
                onChange={(event) => set('walletId', event.target.value)}
              >
                <option value="">Не выбран</option>
                {campaign.borrower.wallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.label} — {wallet.address.slice(0, 6)}…
                    {wallet.address.slice(-4)}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-sm text-muted">
                Сюда уйдёт вся собранная сумма за вычетом комиссии платформы
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">
                На что берутся деньги
              </span>
              <textarea
                rows={3}
                placeholder="Закуп товара к сезону, расширение склада"
                className="w-full rounded-lg border border-border bg-surface p-3 placeholder:text-muted"
                value={form.purpose}
                onChange={(event) => set('purpose', event.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">
                Чем подкреплён возврат
              </span>
              <textarea
                rows={2}
                placeholder="Залог оборудования, поручительство собственника, контракты с покупателями"
                className="w-full rounded-lg border border-border bg-surface p-3 placeholder:text-muted"
                value={form.collateral}
                onChange={(event) => set('collateral', event.target.value)}
              />
            </label>
          </div>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardTitle>Сумма и график</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={`${w.softCap}, USDC`}
              inputMode="decimal"
              hint="Не соберём — деньги вернутся инвесторам"
              value={form.softCap}
              onChange={(event) => set('softCap', event.target.value)}
            />
            <Field
              label={`${w.hardCap}, USDC`}
              inputMode="decimal"
              hint="Больше этой суммы контракт не примет"
              value={form.hardCap}
              onChange={(event) => set('hardCap', event.target.value)}
            />
            <Field
              label={`${w.minTicket}, USDC`}
              inputMode="decimal"
              value={form.minTicket}
              onChange={(event) => set('minTicket', event.target.value)}
            />
            <Field
              label={`${w.maxTicket}, USDC`}
              inputMode="decimal"
              hint="0 — без ограничения"
              value={form.maxTicket}
              onChange={(event) => set('maxTicket', event.target.value)}
            />
            <Field
              label="Ставка, % годовых"
              inputMode="decimal"
              value={form.annualRate}
              onChange={(event) => set('annualRate', event.target.value)}
            />
            <Field
              label="Число платежей"
              inputMode="numeric"
              hint="Не больше 60 — таков размер графика в контракте"
              value={form.periodCount}
              onChange={(event) => set('periodCount', event.target.value)}
            />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">
                Схема выплат
              </span>
              <select
                className="min-h-11 w-full rounded-lg border border-border bg-surface px-3"
                value={form.scheduleKind}
                onChange={(event) =>
                  set('scheduleKind', event.target.value as ScheduleKind)
                }
              >
                {Object.entries(SCHEDULE_KIND_TITLE).map(([value, title]) => (
                  <option key={value} value={value}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">
                Периодичность платежей
              </span>
              <select
                className="min-h-11 w-full rounded-lg border border-border bg-surface px-3"
                value={form.periodsPerYear}
                onChange={(event) => {
                  const picked = frequencyOf(Number(event.target.value));
                  setForm((current) => {
                    // Шаг идёт за периодичностью, кроме ускоренного режима:
                    // иначе даты и проценты считались бы по разным периодам.
                    const step = isFast(current.scheduleStep)
                      ? current.scheduleStep
                      : picked.step;
                    return {
                      ...current,
                      periodsPerYear: picked.periodsPerYear,
                      scheduleStep: step,
                      firstDueAt: shiftByStep(current.fundingDeadline, step),
                    };
                  });
                }}
              >
                {FREQUENCY.map((item) => (
                  <option key={item.step} value={item.periodsPerYear}>
                    {item.title}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-sm text-muted">
                Задаёт и даты платежей, и долю ставки в каждом: при ежемесячной
                платёж несёт 1/12 годовой ставки
              </span>
            </label>
            {/* Сразу за схемой выплат: бумага существует только у облигации. */}
            {form.scheduleKind === 'COUPON' ? (
              <>
                <Field
                  label="Номинал бумаги, USDC"
                  inputMode="decimal"
                  hint="Одна облигация у держателя; пусто — равен минимальному взносу"
                  value={form.bondFaceValue}
                  onChange={(event) => set('bondFaceValue', event.target.value)}
                />
                <Field
                  label="Название бумаги"
                  placeholder="Dala Bond Астана Трейд"
                  hint="Так бумага подпишется в кошельке держателя. До 32 символов; после публикации не меняется"
                  value={form.bondName}
                  onChange={(event) => set('bondName', event.target.value)}
                />
                <Field
                  label="Тикер"
                  placeholder="DALA7"
                  hint="Короткое обозначение в обозревателе, до 10 символов"
                  value={form.bondSymbol}
                  onChange={(event) => set('bondSymbol', event.target.value)}
                />
                <Field
                  label="Ссылка на выпуск"
                  placeholder="https://dala.capital/bonds/7"
                  hint="Её тоже видно в обозревателе; пусто — подставим страницу выпуска"
                  value={form.bondUri}
                  onChange={(event) => set('bondUri', event.target.value)}
                />
              </>
            ) : null}
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">
                Ускоренный режим
              </span>
              <select
                className="min-h-11 w-full rounded-lg border border-border bg-surface px-3"
                value={isFast(form.scheduleStep) ? form.scheduleStep : ''}
                onChange={(event) => {
                  const picked = event.target.value as ScheduleStep | '';
                  setForm((current) => {
                    const step =
                      picked === ''
                        ? frequencyOf(current.periodsPerYear).step
                        : picked;
                    return {
                      ...current,
                      scheduleStep: step,
                      firstDueAt: shiftByStep(current.fundingDeadline, step),
                    };
                  });
                }}
              >
                <option value="">Нет — настоящие сроки</option>
                {FAST_STEPS.map((value) => (
                  <option key={value} value={value}>
                    Шаг {STEP_NAME[value]} — проверка
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-sm text-muted">
                Сжимает интервалы между платежами, чтобы пройти весь цикл займа
                за день. Инвесторам такую кампанию не выпускают
              </span>
            </label>
            <div className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">
                Расчётный токен
              </span>
              <p className="min-h-11 rounded-lg border border-border bg-surface px-3 py-2.5 font-mono text-sm break-all">
                {mint || 'Токенов платформе пока не разрешено'}
              </p>
              <span className="mt-1.5 block text-sm text-muted">
                Последний разрешённый токен платформы, {decimals} знаков после
                запятой. В нём идут все расчёты по займу; чтобы сменить —
                разрешите другой токен в настройках платформы
              </span>
            </div>
          </div>

          {fastSchedule ? (
            <div className="mt-4">
              <Notice
                tone="warning"
                title="Ускоренный график — только для проверки"
              >
                Суммы платежей считаются по периодичности начисления, а не по
                фактическим интервалам. Такая кампания подходит, чтобы пройти
                весь цикл займа за день, но выпускать её инвесторам нельзя.
              </Notice>
            </div>
          ) : null}
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardTitle>Сроки и условия</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={
                form.scheduleKind === 'COUPON'
                  ? 'Начало размещения'
                  : 'Начало сбора'
              }
              type="datetime-local"
              value={form.fundingStart}
              onChange={(event) => set('fundingStart', event.target.value)}
            />
            <Field
              label={
                form.scheduleKind === 'COUPON'
                  ? 'Дедлайн размещения'
                  : 'Дедлайн сбора'
              }
              type="datetime-local"
              hint={
                form.scheduleKind === 'COUPON'
                  ? 'После него итоги размещения подводит оператор'
                  : 'После него сбор закрывает оператор'
              }
              value={form.fundingDeadline}
              onChange={(event) => {
                const deadline = event.target.value;
                setForm((current) => ({
                  ...current,
                  fundingDeadline: deadline,
                  // Первый период считается от дедлайна, поэтому дата платежа
                  // подставляется сама: дедлайн плюс шаг графика.
                  firstDueAt: shiftByStep(deadline, current.scheduleStep),
                }));
              }}
            />
            <div>
              <Field
                label="Первый платёж"
                type="datetime-local"
                hint={`Первый период считается от дедлайна. Обычно это дедлайн плюс ${STEP_NAME[form.scheduleStep]}`}
                value={form.firstDueAt}
                onChange={(event) => set('firstDueAt', event.target.value)}
              />
              {form.fundingDeadline &&
              form.firstDueAt !==
                shiftByStep(form.fundingDeadline, form.scheduleStep) ? (
                <button
                  className="mt-1.5 text-sm text-accent"
                  onClick={() =>
                    set(
                      'firstDueAt',
                      shiftByStep(form.fundingDeadline, form.scheduleStep),
                    )
                  }
                >
                  Вернуть обычную дату: дедлайн плюс{' '}
                  {STEP_NAME[form.scheduleStep]}
                </button>
              ) : null}
            </div>
            <Field
              label="Пеня, % годовых"
              inputMode="decimal"
              hint="Начисляется на просрочку по фактическому времени"
              value={form.penaltyRate}
              onChange={(event) => set('penaltyRate', event.target.value)}
            />
            <Field
              label="Порог дефолта, дней"
              inputMode="numeric"
              hint="Столько дней просрочки — и заём можно перевести в дефолт"
              value={form.defaultThresholdDays}
              onChange={(event) =>
                set('defaultThresholdDays', event.target.value)
              }
            />
            <Field
              label="Комиссия платформы, %"
              inputMode="decimal"
              hint="Удерживается из суммы займа при выдаче"
              value={form.platformFee}
              onChange={(event) => set('platformFee', event.target.value)}
            />
            {/* Облигации досрочное погашение недоступно: контракт его не примет,
                а поле на экране сбивает с толку. */}
            {form.scheduleKind === 'ANNUITY' ? (
              <Field
                label="Комиссия за досрочное погашение, %"
                inputMode="decimal"
                hint="Её получают инвесторы: досрочный возврат лишает их процентов"
                value={form.prepaymentFee}
                onChange={(event) => set('prepaymentFee', event.target.value)}
              />
            ) : null}
            <Field
              label="Льготный срок отмены, дней"
              inputMode="numeric"
              hint="Через столько дней после дедлайна админ сможет отменить кампанию, если итоги так и не подвели"
              value={form.cancelGraceDays}
              onChange={(event) => set('cancelGraceDays', event.target.value)}
            />
          </div>
        </Card>
      ) : null}

      {step === 4 ? (
        <div className="space-y-4">
          {preview.isError ? (
            <Notice tone="danger" title={preview.error.message} />
          ) : null}
          {preview.isPending ? (
            <p className="text-sm text-muted">Считаем график…</p>
          ) : null}
          {preview.data ? (
            <>
              <Notice title="Как читать график">
                Проценты первого платежа начисляются за период от дедлайна до
                первой даты, а тело — от фактически привлечённой суммы. Поэтому
                график показан для минимума и максимума.
              </Notice>
              <a
                href={api.campaigns.csvUrl(campaign.id)}
                className={buttonStyles('secondary')}
              >
                <Download size={18} aria-hidden /> Выгрузить график в CSV
              </a>
              <ScheduleTable
                schedule={preview.data.max}
                title="Если соберём максимум"
                internal
              />
              <ScheduleTable
                schedule={preview.data.min}
                title="Если соберём минимум"
                internal
              />
            </>
          ) : null}
        </div>
      ) : null}

      {step === 5 ? (
        <div className="space-y-4">
          <Card>
            <CardTitle>Сводка условий</CardTitle>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <Row label="Заёмщик" value={campaign.borrower.name} />
              <Row
                label="Сбор"
                value={`${formatMoney(campaign.softCap)} — ${formatMoney(campaign.hardCap)}`}
              />
              <Row
                label="Ставка"
                value={`${bpsToPercent(campaign.annualRateBps)}% годовых`}
              />
              <Row
                label="График"
                value={`${campaign.periodCount} платежей, ${SCHEDULE_STEP_TITLE[campaign.scheduleStep].toLowerCase()}`}
              />
              <Row
                label={w.deadline}
                value={formatDateTime(campaign.fundingDeadline)}
              />
              <Row
                label="Первый платёж"
                value={formatDateTime(campaign.firstDueAt)}
              />
              <Row
                label="Пеня"
                value={`${bpsToPercent(campaign.penaltyRateBps)}% годовых`}
              />
              <Row
                label="Дефолт"
                value={
                  plural(campaign.defaultThresholdDays, 'день', 'дня', 'дней') +
                  ' просрочки'
                }
              />
            </dl>
          </Card>

          <Card>
            <CardTitle>Проверки перед публикацией</CardTitle>
            <ul className="space-y-2 text-sm">
              {checks.data?.map((check) => (
                <li key={check.key} className="flex items-start gap-2">
                  <span className={check.ok ? 'text-accent' : 'text-danger'}>
                    {check.ok ? (
                      <Check size={18} aria-hidden />
                    ) : (
                      <X size={18} aria-hidden />
                    )}
                  </span>
                  <span>
                    {check.title}
                    {check.hint ? (
                      <span className="block text-muted">{check.hint}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Notice
            tone="warning"
            title="После публикации условия изменить нельзя"
          >
            График фиксируется в контракте. Поменять можно будет только кошелёк
            заёмщика — и то пока идёт сбор.
          </Notice>

          {publish.isError ? (
            <Notice tone="danger" title={publish.error.message} />
          ) : null}

          <Button
            loading={publish.isPending}
            disabled={!checks.data?.every((check) => check.ok)}
            onClick={() => {
              if (
                window.confirm(
                  'Опубликовать кампанию в контракт? Условия станут неизменяемыми.',
                )
              )
                publish.mutate();
            }}
          >
            <Rocket size={18} aria-hidden /> Опубликовать
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {step > 1 ? (
          <Button variant="secondary" onClick={() => goTo(step - 1)}>
            <ArrowLeft size={18} aria-hidden /> Назад
          </Button>
        ) : null}
        {step < STEPS.length ? (
          <Button loading={save.isPending} onClick={() => goTo(step + 1)}>
            Дальше <ArrowRight size={18} aria-hidden />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          onClick={() => {
            save.mutate(step);
            router.push('/admin/campaigns');
          }}
        >
          <Save size={18} aria-hidden /> Сохранить и выйти
        </Button>
      </div>
    </div>
  );
}

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
              className={
                number === step
                  ? 'min-h-9 shrink-0 rounded-full bg-accent px-3 text-sm font-medium text-white'
                  : `min-h-9 shrink-0 rounded-full border border-border px-3 text-sm ${done ? 'text-accent' : 'text-muted'}`
              }
            >
              {number}. {title}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
