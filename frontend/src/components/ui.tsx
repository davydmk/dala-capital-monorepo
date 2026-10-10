/** Мелкие кирпичики интерфейса: кнопка, поле, карточка, плашка, пустое состояние. */
import clsx from 'clsx';
import type { ComponentProps, ReactNode } from 'react';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  /** Шаг, которого ждут: тот же жёлтый, что у бейджа в меню и у пометки. */
  | 'due';

/** Вид кнопки отдельно от тега: те же стили нужны ссылкам. */
export const buttonStyles = (
  variant: ButtonVariant = 'primary',
  className?: string,
) =>
  clsx(
    // min-h-11 — 44px: минимальная цель для пальца.
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition',
    'disabled:cursor-not-allowed disabled:opacity-60',
    variant === 'primary' && 'bg-accent text-white hover:bg-accent-hover',
    variant === 'secondary' &&
      'border border-border bg-surface hover:bg-background',
    variant === 'ghost' && 'text-muted hover:text-foreground',
    variant === 'danger' &&
      'border border-danger text-danger hover:bg-danger-soft',
    variant === 'due' &&
      'border border-warning bg-warning-soft text-warning hover:brightness-95',
    className,
  );

export function Button({
  variant = 'primary',
  className,
  loading,
  children,
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      className={buttonStyles(variant, className)}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? 'Подождите…' : children}
    </button>
  );
}

export function Field({
  label,
  error,
  hint,
  className,
  ...props
}: ComponentProps<'input'> & { label: string; error?: string; hint?: string }) {
  const id = props.id ?? props.name;
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        className={clsx(
          'min-h-11 w-full rounded-lg border bg-surface px-3 text-foreground',
          'placeholder:text-muted',
          error ? 'border-danger' : 'border-border',
          className,
        )}
        {...props}
      />
      {error ? (
        <span className="mt-1.5 block text-sm text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-sm text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={clsx(
        'rounded-xl border border-border bg-surface p-4 sm:p-5',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-base font-semibold">{children}</h2>;
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger';
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      className={clsx(
        'rounded-xl border p-4 text-sm',
        tone === 'info' && 'border-border bg-accent-soft',
        tone === 'warning' && 'border-transparent bg-warning-soft text-warning',
        tone === 'danger' && 'border-transparent bg-danger-soft text-danger',
      )}
    >
      <p className="font-medium">{title}</p>
      {children ? <p className="mt-1 opacity-90">{children}</p> : null}
    </div>
  );
}

/** Плитка показателя. Пока данных нет, показывает прочерк и подпись «откуда возьмётся». */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <div className="text-muted">{icon}</div>
      <p className="font-medium">{title}</p>
      {children ? (
        <p className="max-w-sm text-sm text-muted">{children}</p>
      ) : null}
    </div>
  );
}

/** Чек-лист «что делать дальше»: главный элемент пустого дашборда. */
export function Steps({
  items,
}: {
  items: { title: string; done?: boolean }[];
}) {
  return (
    <ol className="space-y-3">
      {items.map((item, index) => (
        <li key={item.title} className="flex items-start gap-3">
          <span
            className={clsx(
              'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
              item.done
                ? 'bg-accent text-white'
                : 'border border-border text-muted',
            )}
          >
            {item.done ? '✓' : index + 1}
          </span>
          <span
            className={clsx('text-sm', item.done && 'text-muted line-through')}
          >
            {item.title}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Select({
  label,
  error,
  hint,
  className,
  children,
  ...props
}: ComponentProps<'select'> & {
  label: string;
  error?: string;
  hint?: string;
}) {
  const id = props.id ?? props.name;
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <select
        id={id}
        aria-invalid={Boolean(error)}
        className={clsx(
          'min-h-11 w-full rounded-lg border bg-surface px-3 text-foreground',
          error ? 'border-danger' : 'border-border',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {error ? (
        <span className="mt-1.5 block text-sm text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-sm text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function TextArea({
  label,
  hint,
  className,
  ...props
}: ComponentProps<'textarea'> & { label: string; hint?: string }) {
  const id = props.id ?? props.name;
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <textarea
        id={id}
        className={clsx(
          'w-full rounded-lg border border-border bg-surface p-3 placeholder:text-muted',
          className,
        )}
        {...props}
      />
      {hint ? (
        <span className="mt-1.5 block text-sm text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

/** Галочка с подписью: цель нажатия — вся строка, а не квадратик 16 на 16. */
export function Checkbox({
  label,
  hint,
  ...props
}: ComponentProps<'input'> & { label: ReactNode; hint?: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1">
      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0 accent-accent"
        {...props}
      />
      <span className="text-sm">
        {label}
        {hint ? <span className="mt-0.5 block text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * Чип фильтра: вкладки и срезы списков. Нажатое состояние даём через
 * `aria-pressed`, чтобы его слышал и экранный диктор, а не только видел глаз.
 */
export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'min-h-9 shrink-0 rounded-full border px-3 text-sm',
        active
          ? 'border-accent font-medium text-accent'
          : 'border-border text-muted',
      )}
    >
      {children}
    </button>
  );
}
