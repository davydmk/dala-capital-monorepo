/**
 * Уведомление о корпоративном действии в раскладке ISO 15022: MT564, пока
 * действие объявлено, и MT566 — после исполнения. Этими сообщениями
 * депозитарии описывают корпоративные действия не первое десятилетие, и
 * запись из блокчейна ложится в них без потерь — это и есть смысл выгрузки.
 *
 * Это **не** сообщение SWIFT: нет блоков сети, BIC отправителя и получателя,
 * валидатора и подписи. Отправить такой текст в сеть нельзя, его можно
 * прочитать и сверить. Говорим об этом прямо — тот, кто формат знает,
 * проверит за секунду.
 */

/** Код события по CAEV. У служебного снимка реестра его не существует. */
const EVENT_CODE: Record<string, string | undefined> = {
  coupon: 'INTR',
  redemption: 'REDM',
  vote: 'BMET',
};

/** Обязательность по CAMV: голосование добровольное, выплаты — нет. */
const MANDATORY_CODE: Record<string, string | undefined> = {
  coupon: 'MAND',
  redemption: 'MAND',
  vote: 'VOLU',
};

export interface NoticeInput {
  /** Номер кампании в контракте — он же номер выпуска в ссылке сообщения. */
  onchainId: string;
  index: number;
  kind: string;
  status: string;
  recordTs: number;
  paymentTs: number;
  amountPerUnit: bigint;
  units: bigint;
  registerHash: string;
  settlement: string | null;
  /** Идентификатор бумаги; пусто — вместо него идёт название выпуска. */
  isin: string;
  title: string;
  mint: string;
  decimals: number;
}

/** Выгружаются только действия с кодом события: остальным его неоткуда взять. */
export const noticeAvailable = (kind: string) => Boolean(EVENT_CODE[kind]);

/** Дата в формате стандарта: YYYYMMDD. */
function date(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10).replace(/-/g, '');
}

/** Сумма в формате стандарта: запятая вместо точки, без лишних нулей. */
function amount(value: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals);
  const whole = value / unit;
  const fraction = (value % unit).toString().padStart(decimals, '0');
  return `${whole},${fraction.replace(/0+$/, '') || '0'}`;
}

/**
 * Собирает текст уведомления. Пока действие не исполнено — MT564 с типом
 * `NEWM`; после исполнения тот же состав полей отдаётся как MT566 с `CONF`
 * и ссылкой на расчётную транзакцию.
 */
export function buildNotice(input: NoticeInput): string {
  const event = EVENT_CODE[input.kind];
  if (!event) {
    throw new Error('У этого вида действия нет кода события по ISO 15022');
  }

  const settled = input.status === 'settled' || input.status === 'closed';
  const reference = `DALA-${input.onchainId}-${input.index}`;
  const lines: string[] = [];
  const put = (line: string) => lines.push(line);

  put(':16R:GENL');
  put(`:20C::CORP//${reference}`);
  if (settled && input.settlement) {
    // В MT566 ссылка на исходное уведомление и подпись расчёта.
    put(`:20C::RELA//${input.settlement.slice(0, 16)}`);
  }
  put(`:23G:${settled ? 'CONF' : 'NEWM'}`);
  put(`:22F::CAEV//${event}`);
  put(`:22F::CAMV//${MANDATORY_CODE[input.kind] ?? 'MAND'}`);
  put(':16S:GENL');

  put(':16R:USECU');
  // Поле допускает описание вместо кода, если идентификатор не присвоен.
  put(input.isin ? `:35B:ISIN ${input.isin}` : `:35B:/XX/${input.title}`);
  put(':16R:ACCTINTN');
  put(`:93B::ELIG//UNIT/${input.units.toString()},`);
  put(':16S:ACCTINTN');
  put(':16S:USECU');

  put(':16R:CADETL');
  put(`:98A::RDTE//${date(input.recordTs)}`);
  put(`:98A::PAYD//${date(input.paymentTs)}`);
  put(':16S:CADETL');

  put(':16R:CAOPTN');
  if (input.kind === 'vote') {
    // У голосования это не выплата на бумагу, а общий бюджет взыскания.
    put(`:92F::CASH//USD${amount(input.amountPerUnit, input.decimals)}`);
  } else {
    put(`:92F::${event}//USD${amount(input.amountPerUnit, input.decimals)}`);
  }
  // Расчёт идёт в USDC, а поле валюты требует три буквы ISO 4217. Ставим USD
  // и тут же говорим, чем платят на самом деле: молча подменять нельзя.
  put(`:70E::ADTX//SETTLEMENT TOKEN USDC MINT ${input.mint}`);
  // Отпечатка списка держателей в стандарте нет, а терять его нельзя: он и
  // есть доказательство того, что реестр не подменили задним числом.
  put(`:70E::ADTX//REGISTER HASH ${input.registerHash}`);
  if (settled && input.settlement) {
    put(`:70E::ADTX//SETTLEMENT TX ${input.settlement}`);
  }
  put(':16S:CAOPTN');

  return lines.join('\n') + '\n';
}

/** Имя файла: по нему видно вид сообщения и к чему оно относится. */
export function noticeFileName(input: NoticeInput): string {
  const settled = input.status === 'settled' || input.status === 'closed';
  return `MT${settled ? '566' : '564'}-DALA-${input.onchainId}-${input.index}.txt`;
}
