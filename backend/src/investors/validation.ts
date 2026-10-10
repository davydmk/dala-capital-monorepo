import {
  InvestorDocumentKind,
  InvestorType,
  type Investor,
  type InvestorBeneficiary,
  type InvestorDocument,
} from '@prisma/client';
import { isValidSolanaAddress } from '../borrowers/validation.js';
import { countryName, isBlockedCountry, isKnownCountry } from './countries.js';

export interface InvestorCheck {
  /** Короткий код для интерфейса. */
  key: string;
  title: string;
  ok: boolean;
  /** Что не так и как исправить. */
  hint?: string;
}

export type InvestorForCheck = Investor & {
  documents: Pick<InvestorDocument, 'kind'>[];
  beneficiaries: Pick<InvestorBeneficiary, 'shareBps' | 'fullName'>[];
};

/** Совершеннолетие: младше платформа инвесторов не принимает. */
export const MIN_AGE = 18;

/** Документы, без которых анкету не примут. */
export const REQUIRED_DOCUMENTS: Record<InvestorType, InvestorDocumentKind[]> =
  {
    [InvestorType.INDIVIDUAL]: [
      InvestorDocumentKind.IDENTITY,
      InvestorDocumentKind.SELFIE,
    ],
    [InvestorType.COMPANY]: [
      InvestorDocumentKind.IDENTITY,
      InvestorDocumentKind.SELFIE,
      InvestorDocumentKind.COMPANY_REGISTRY,
      InvestorDocumentKind.COMPANY_CHARTER,
      InvestorDocumentKind.DIRECTOR_APPOINTMENT,
      InvestorDocumentKind.OWNERSHIP_STRUCTURE,
    ],
  };

export const DOCUMENT_TITLE: Record<InvestorDocumentKind, string> = {
  IDENTITY: 'удостоверение личности',
  SELFIE: 'селфи с документом',
  PROOF_OF_ADDRESS: 'подтверждение адреса',
  COMPANY_REGISTRY: 'выписка из реестра',
  COMPANY_CHARTER: 'устав',
  DIRECTOR_APPOINTMENT: 'решение о назначении руководителя',
  OWNERSHIP_STRUCTURE: 'структура собственности',
  OTHER: 'прочее',
};

/** Полных лет на дату now. */
export function fullYears(birth: Date, now: Date): number {
  let years = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())
  ) {
    years -= 1;
  }
  return years;
}

const filled = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Что мешает отправить анкету на проверку. Один список для мастера инвестора
 * и для карточки админа: инвестор видит, что дозаполнить, админ — что проверять.
 */
export function checkInvestor(
  investor: InvestorForCheck,
  context: { now?: Date } = {},
): InvestorCheck[] {
  const now = context.now ?? new Date();
  const company = investor.type === InvestorType.COMPANY;
  const checks: InvestorCheck[] = [];
  const add = (key: string, title: string, ok: boolean, hint?: string) =>
    checks.push({ key, title, ok, hint: ok ? undefined : hint });

  const who = company ? 'подписанта' : 'инвестора';

  add(
    'name',
    `Имя и фамилия ${who}`,
    filled(investor.firstName) && filled(investor.lastName),
    'Укажите имя и фамилию латиницей, как в документе',
  );

  const dob = investor.dob;
  add(
    'age',
    `Возраст ${who} от ${MIN_AGE} лет`,
    Boolean(dob) && fullYears(dob as Date, now) >= MIN_AGE,
    `Укажите дату рождения: платформа принимает инвесторов с ${MIN_AGE} лет`,
  );

  for (const [key, code, title] of [
    ['nationality', investor.nationality, 'Гражданство'],
    ['country', investor.country, 'Страна проживания'],
  ] as const) {
    const known = filled(code) && isKnownCountry(code as string);
    add(
      key,
      `${title} указана`,
      known && !isBlockedCountry(code as string),
      known
        ? `Платформа не работает с юрисдикцией «${countryName(code as string)}»`
        : `Выберите страну из списка`,
    );
  }

  add(
    'address',
    'Адрес проживания',
    filled(investor.addressLine) && filled(investor.city),
    'Укажите адрес и город проживания',
  );

  add('phone', 'Телефон', filled(investor.phone), 'Укажите телефон для связи');

  const validUntil = investor.idDocValidUntil;
  add(
    'document',
    'Реквизиты удостоверения личности',
    Boolean(investor.idDocType) &&
      filled(investor.idDocNumber) &&
      filled(investor.idDocCountry) &&
      Boolean(validUntil) &&
      (validUntil as Date) > now,
    validUntil && validUntil <= now
      ? 'Срок действия документа истёк — приложите действующий'
      : 'Укажите тип, номер, страну выдачи и срок действия документа',
  );

  if (company) {
    add(
      'company',
      'Реквизиты компании',
      filled(investor.companyName) &&
        filled(investor.registrationNumber) &&
        Boolean(investor.incorporatedOn) &&
        filled(investor.legalAddress),
      'Укажите название, регистрационный номер, дату регистрации и юридический адрес',
    );

    const registered = investor.companyCountry;
    const known = filled(registered) && isKnownCountry(registered as string);
    add(
      'companyCountry',
      'Страна регистрации',
      known && !isBlockedCountry(registered as string),
      known
        ? `Платформа не работает с юрисдикцией «${countryName(registered as string)}»`
        : 'Выберите страну регистрации из списка',
    );

    add(
      'position',
      'Должность подписанта',
      filled(investor.position),
      'Укажите, кем подписант приходится компании: директор, управляющий',
    );

    const shares = investor.beneficiaries.reduce(
      (sum, item) => sum + item.shareBps,
      0,
    );
    add(
      'beneficiaries',
      'Бенефициары с долей от 25%',
      investor.beneficiaries.length > 0 &&
        shares <= 10_000 &&
        investor.beneficiaries.every((item) => item.shareBps > 0),
      shares > 10_000
        ? 'Сумма долей больше 100% — проверьте значения'
        : 'Добавьте владельцев с долей от 25%: этого требует проверка происхождения капитала',
    );
  }

  const kinds = new Set(investor.documents.map((item) => item.kind));
  const missing = REQUIRED_DOCUMENTS[investor.type].filter(
    (kind) => !kinds.has(kind),
  );
  add(
    'documents',
    'Документы загружены',
    missing.length === 0,
    `Не хватает: ${missing.map((kind) => DOCUMENT_TITLE[kind]).join(', ')}`,
  );

  const address = investor.withdrawalAddress;
  const addressOk = filled(address) && isValidSolanaAddress(address as string);
  add(
    'withdrawalAddress',
    'Адрес для вывода средств',
    addressOk && investor.withdrawalCheckResult !== 'rejected',
    addressOk
      ? 'Указанный адрес не подходит: это токен-счёт, а не кошелёк'
      : 'Укажите адрес кошелька Solana — на него контракт будет выводить выплаты',
  );

  add(
    'sourceOfFunds',
    'Источник средств',
    Boolean(investor.sourceOfFunds),
    'Выберите, откуда средства для вложений',
  );

  add(
    'pep',
    'Декларация о публичной должности',
    investor.isPep !== null && (!investor.isPep || filled(investor.pepDetails)),
    investor.isPep
      ? 'Опишите должность и страну: это не отказ, но проверка будет дольше'
      : 'Ответьте, занимает ли инвестор публичную должность',
  );

  add(
    'terms',
    'Согласие с условиями и рисками',
    Boolean(investor.termsAcceptedAt) && Boolean(investor.riskAcceptedAt),
    'Подтвердите согласие с условиями платформы и с принятием риска',
  );

  return checks;
}

export const allChecksPassed = (checks: InvestorCheck[]) =>
  checks.every((check) => check.ok);

/** Первая непройденная проверка — её показываем в ошибке отправки. */
export const firstFailure = (checks: InvestorCheck[]) =>
  checks.find((check) => !check.ok);
