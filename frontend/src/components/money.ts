/** Суммы приходят строками в микроединицах: у USDC шесть знаков после запятой. */
const DECIMALS = 6n;
const UNIT = 10n ** DECIMALS;

/** «1234.5» → «1234500000». Пробелы и запятая допускаются: так удобнее вводить. */
export function toMicro(value: string): string {
  const cleaned = value.replace(/\s/g, '').replace(',', '.');
  if (!cleaned) return '0';
  const [whole, fraction = ''] = cleaned.split('.');
  const padded = fraction
    .padEnd(Number(DECIMALS), '0')
    .slice(0, Number(DECIMALS));
  return (BigInt(whole || '0') * UNIT + BigInt(padded || '0')).toString();
}

/** «1234500000» → «1 234,50». Для полей ввода — без разделителей групп. */
export function fromMicro(
  value: string | null | undefined,
  grouped = true,
): string {
  if (value === null || value === undefined || value === '') return '';
  const amount = BigInt(value);
  const whole = amount / UNIT;
  const fraction = (amount % UNIT)
    .toString()
    .padStart(Number(DECIMALS), '0')
    .replace(/0+$/, '');
  const head = grouped
    ? new Intl.NumberFormat('ru-RU').format(whole)
    : whole.toString();
  return fraction ? `${head},${fraction}` : head;
}

/**
 * В интерфейсе показываем два знака: шесть знаков USDC читать невозможно.
 * Число знаков у токена берётся из кампании — у разных токенов оно разное.
 * Обозначение пока всегда «USDC»: другого токена платформа не разрешает,
 * а как появится — понадобится поле с обозначением у токена.
 */
export const formatMoney = (
  value: string | null | undefined,
  decimals = Number(DECIMALS),
) => {
  if (value === null || value === undefined || value === '') return '—';
  // Значение приходит из сети: если это не целое число, честнее показать
  // прочерк, чем уронить страницу.
  let units: bigint;
  try {
    units = BigInt(value);
  } catch {
    return '—';
  }
  const amount = Number(units) / 10 ** decimals;
  return `${new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)} USDC`;
};

/** Базисные пункты в проценты: 1000 → «10%». */
export const bpsToPercent = (bps: number | null | undefined) =>
  bps === null || bps === undefined ? '' : String(bps / 100);

export const percentToBps = (percent: string) =>
  Math.round(Number(percent.replace(',', '.') || '0') * 100);

/** Значение для input[type=datetime-local] в местном времени. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export const fromLocalInput = (value: string) =>
  value ? new Date(value).toISOString() : undefined;

export const formatDateTime = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === '') return '—';
  const date =
    typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return date.toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
};
