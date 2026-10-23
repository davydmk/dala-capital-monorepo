export type Role = 'ADMIN' | 'BORROWER' | 'INVESTOR';
export type UserStatus = 'PENDING' | 'ACTIVE' | 'BLOCKED';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
  /** Вход, предшествующий текущему; у новичка пустой. */
  previousLoginAt: string | null;
  /** Режим просмотра: кабинет настоящий, но изменения отклоняет сервер. */
  viewer?: boolean;
}

/** Куда ведём пользователя после входа. */
export const HOME_BY_ROLE: Record<Role, string> = {
  ADMIN: '/admin',
  BORROWER: '/borrower',
  INVESTOR: '/investor',
};

export const ROLE_TITLE: Record<Role, string> = {
  ADMIN: 'Администратор',
  BORROWER: 'Заёмщик',
  INVESTOR: 'Инвестор',
};

// ── Заёмщики ───────────────────────────────────────────────────────────────

export type BorrowerStatus = 'DRAFT' | 'APPROVED' | 'SUSPENDED' | 'ARCHIVED';
export type CreditRating = 'A' | 'B' | 'C' | 'D';
export type DocumentKind =
  'REGISTRATION' | 'CHARTER' | 'FINANCIALS' | 'TAX' | 'CONTRACT' | 'OTHER';

export const BORROWER_STATUS_TITLE: Record<BorrowerStatus, string> = {
  DRAFT: 'Черновик',
  APPROVED: 'Допущен',
  SUSPENDED: 'Приостановлен',
  ARCHIVED: 'В архиве',
};

/** Как оценку риска видит инвестор: без буквы, чтобы её не приняли за рейтинг агентства. */
export const PUBLIC_RISK_TITLE: Record<CreditRating, string> = {
  A: 'Низкий риск',
  B: 'Умеренный риск',
  C: 'Повышенный риск',
  D: 'Высокий риск',
};

export const RISK_DISCLAIMER =
  'Внутренняя оценка Dala Capital по документам заёмщика. Это не кредитный рейтинг рейтингового агентства и не инвестиционная рекомендация.';

export const RATING_TITLE: Record<CreditRating, string> = {
  A: 'A — низкий риск',
  B: 'B — умеренный риск',
  C: 'C — повышенный риск',
  D: 'D — высокий риск',
};

export const DOCUMENT_KIND_TITLE: Record<DocumentKind, string> = {
  REGISTRATION: 'Справка о регистрации',
  CHARTER: 'Устав',
  FINANCIALS: 'Финансовая отчётность',
  TAX: 'Справка об отсутствии налоговой задолженности',
  CONTRACT: 'Договор',
  OTHER: 'Другое',
};

/** Поля карточки заёмщика, которые заполняет админ. */
export interface BorrowerInput {
  name?: string;
  bin?: string;
  description?: string;
  industry?: string;
  address?: string;
  website?: string;
  foundedAt?: string;
  annualRevenueUsd?: number;
  employees?: number;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  rating?: CreditRating;
  riskNote?: string;
  status?: BorrowerStatus;
}

export interface BorrowerListItem extends BorrowerInput {
  id: string;
  name: string;
  bin: string;
  status: BorrowerStatus;
  logoKey: string | null;
  createdAt: string;
  wallets: BorrowerWallet[];
  _count: { documents: number; photos: number };
}

export interface BorrowerWallet {
  id: string;
  label: string;
  address: string;
  isDefault: boolean;
}

export interface BorrowerPhoto {
  id: string;
  caption: string | null;
  sortOrder: number;
}

export interface BorrowerDocument {
  id: string;
  kind: DocumentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface ActiveInvite {
  id: string;
  email: string;
  expiresAt: string;
  createdAt: string;
}

export interface BorrowerDetails extends BorrowerListItem {
  documents: BorrowerDocument[];
  photos: BorrowerPhoto[];
  user: { id: string; email: string; status: UserStatus } | null;
  /// Действующее приглашение; массив пустой или из одного элемента.
  invites: ActiveInvite[];
}

export interface BorrowerEvent {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

export interface BorrowerSaveResult {
  borrower: BorrowerDetails;
}

/** Ответ на добавление кошелька: сам адрес и результат проверки в сети. */
export interface WalletSaveResult {
  wallet: BorrowerWallet;
  check: { ok: true | false | 'unknown'; reason?: string };
}

export interface InviteResult {
  token: string;
  path: string;
  email: string;
  expiresAt: string;
}

// ── Кампании ───────────────────────────────────────────────────────────────

export type ScheduleKind = 'ANNUITY' | 'COUPON';
export type ScheduleStep =
  'YEAR' | 'HALF_YEAR' | 'QUARTER' | 'MONTH' | 'WEEK' | 'DAY' | 'HOUR';
export type CampaignState = 'DRAFT' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED';

/**
 * Две схемы — два разных инструмента, а не два варианта графика. Кредит
 * гасится равными платежами и живёт только в контракте; по облигации платятся
 * купоны, тело возвращается в конце, а держателю выпускается бумага.
 */
export const SCHEDULE_KIND_TITLE: Record<ScheduleKind, string> = {
  ANNUITY: 'Кредит — равные платежи',
  COUPON: 'Облигация — купоны, тело в конце',
};

/** Короткая форма для плитки: на неё длинное название не помещается. */
export const SCHEDULE_KIND_SHORT: Record<ScheduleKind, string> = {
  ANNUITY: 'Кредит',
  COUPON: 'Облигация',
};

export const SCHEDULE_STEP_TITLE: Record<ScheduleStep, string> = {
  YEAR: 'Год',
  HALF_YEAR: 'Полгода',
  QUARTER: 'Квартал',
  MONTH: 'Месяц',
  WEEK: 'Неделя',
  DAY: 'День',
  HOUR: 'Час',
};

export const CAMPAIGN_STATE_TITLE: Record<CampaignState, string> = {
  DRAFT: 'Черновик',
  PUBLISHING: 'Публикуется',
  PUBLISHED: 'Опубликована',
  FAILED: 'Ошибка публикации',
};

/** Периодичность начисления: контракт принимает только эти значения. */
export const PERIODS_PER_YEAR = [1, 2, 4, 12] as const;

export interface CampaignInput {
  borrowerId?: string;
  walletId?: string;
  title?: string;
  purpose?: string;
  collateral?: string;
  mint?: string;
  mintDecimals?: number;
  scheduleKind?: ScheduleKind;
  scheduleStep?: ScheduleStep;
  softCap?: string;
  hardCap?: string;
  minTicket?: string;
  /** Номинал бумаги у облигации. */
  bondFaceValue?: string;
  bondName?: string;
  bondSymbol?: string;
  bondIsin?: string;
  bondUri?: string;
  maxTicket?: string;
  fundingStart?: string;
  fundingDeadline?: string;
  firstDueAt?: string;
  annualRateBps?: number;
  periodsPerYear?: number;
  periodCount?: number;
  penaltyRateBps?: number;
  defaultThresholdDays?: number;
  prepaymentFeeBps?: number;
  platformFeeBps?: number;
  cancelGraceDays?: number;
  step?: number;
}

export interface CampaignListItem {
  id: string;
  title: string;
  state: CampaignState;
  softCap: string | null;
  hardCap: string | null;
  annualRateBps: number | null;
  periodCount: number | null;
  onchainId: string | null;
  fundingDeadline: string | null;
  updatedAt: string;
  scheduleKind: ScheduleKind;
  /** Состояние займа в сети; `UNKNOWN`, если сеть не ответила. */
  status: CampaignStatus | 'UNKNOWN';
  borrower: { id: string; name: string; logoKey: string | null };
}

export interface Campaign extends Required<Omit<CampaignInput, 'step'>> {
  id: string;
  state: CampaignState;
  step: number;
  error: string | null;
  onchainId: string | null;
  payoutWallet: string | null;
  borrower: BorrowerDetails;
  txs: { stage: string; signature: string; createdAt: string }[];
}

export interface SchedulePeriod {
  index: number;
  dueTs: number;
  principal: string;
  interest: string;
  total: string;
  balance: string;
}

export interface Schedule {
  periods: SchedulePeriod[];
  totals: {
    principal: string;
    interest: string;
    total: string;
    platformFee: string;
    payout: string;
  };
}

export interface SchedulePreview {
  min: Schedule;
  max: Schedule;
}

export interface CampaignCheck {
  key: string;
  title: string;
  ok: boolean;
  hint?: string;
}

export interface OnchainDeal {
  state: string;
  totalRaised: string;
  periodCount: number;
  scheduleFinalized: boolean;
  borrowerWallet: string;
  fundingDeadline: number;
  address: string;
  repayAddress: string | null;
  /** Дни просрочки на сейчас, досчитанные бэкендом. */
  daysPastDue: number;
  /** Пусто — сбор можно отменить; иначе почему сейчас нельзя. */
  cancelBlock: string | null;
  defaultPrincipal: string;
  defaultInterest: string;
  penalty: string;
  recoveryCosts: string;
  recoveryReimbursed: string;
  overduePrincipal: string;
  /** Что произойдёт при закрытии сбора — видно до нажатия кнопки. */
  closing: {
    /** Пусто — закрывать можно; иначе причина, почему пока нет. */
    block: string | null;
    /** Минимум не собран: закрытие отправит кампанию в несостоявшийся сбор. */
    willFail: boolean;
    platformFee: string;
    payoutAmount: string;
    wallets: {
      id: string;
      label: string;
      address: string;
      /** Этот адрес сейчас записан в контракте. */
      current: boolean;
    }[];
  };
  txs: { stage: string; signature: string; url: string; createdAt: string }[];
  /** Состав инвесторов поимённо — только у админа. */
  investors: {
    investorId: string | null;
    title: string | null;
    type: string | null;
    country: string | null;
    principal: string;
    shareBps: number;
    credited: string;
    received: string;
  }[];
}

/**
 * Открытая задача: то, чего платформа ждёт от человека прямо сейчас.
 * Не событие в ленте — появляется сама и исчезает, когда дело сделано.
 */
export interface Task {
  key: string;
  title: string;
  hint: string;
  /** Экран, где это делается; по нему же считается счётчик в меню. */
  href: string;
  count: number;
  tone: 'danger' | 'warning' | 'info';
  /** Срок, до которого дело надо сделать; есть не у всякой задачи. */
  deadline?: number | null;
}

export interface PlatformRole {
  key: string;
  /** Название роли на рынке ценных бумаг; `key` — имя ключа в контракте. */
  title: string;
  address: string;
  purpose: string;
  sol: number | null;
  /** SOL заканчивается: операции этого ключа скоро начнут падать. */
  low: boolean;
  url: string;
}

export interface PlatformToken {
  address: string;
  decimals: number | null;
  isToken2022: boolean;
  /** У Token-2022 расширения могут съедать часть перевода. */
  hasExtensions: boolean;
  treasuryAmount: string | null;
  campaigns: number;
  url: string;
}

export interface PlatformState {
  cluster: string;
  programId: string;
  programUrl: string;
  campaignCount: string;
  defaultMint: string;
  roles: PlatformRole[];
  tokens: PlatformToken[];
}

export interface TokenInfo {
  address: string;
  decimals: number;
  isToken2022: boolean;
  hasExtensions: boolean;
}

export interface AdminAction {
  id: string;
  action: string;
  target: string;
  signature: string | null;
  createdAt: string;
  /** Кто нажал: сотрудник платформы. */
  actor: { email: string };
  /** Чем подписано: технический ключ роли и её название. */
  role: string | null;
  roleTitle: string | null;
}

export const ADMIN_ACTION_TITLE: Record<string, string> = {
  allowMint: 'Разрешён токен',
  removeMint: 'Убран токен',
  publishCampaign: 'Опубликована кампания',
  cancelCampaign: 'Отменена кампания',
  closeFunding: 'Закрыт сбор',
  markDefault: 'Объявлен дефолт',
  recordRecoveryCost: 'Записаны расходы на взыскание',
  recoveryPayment: 'Поступление по взысканию',
  createUser: 'Заведён инвестор',
  setWhitelist: 'Изменён допуск инвестора',
  setWithdrawalAddress: 'Изменён адрес вывода',
};

// ── Инвесторы ──────────────────────────────────────────────────────────────

export type InvestorType = 'INDIVIDUAL' | 'COMPANY';
export type KycStatus =
  | 'NOT_STARTED'
  | 'DRAFT'
  | 'PENDING'
  | 'ON_HOLD'
  | 'APPROVED'
  | 'RETRY'
  | 'REJECTED';
export type IdDocType = 'PASSPORT' | 'ID_CARD' | 'RESIDENCE_PERMIT' | 'DRIVERS';
export type InvestorDocumentKind =
  | 'IDENTITY'
  | 'SELFIE'
  | 'PROOF_OF_ADDRESS'
  | 'COMPANY_REGISTRY'
  | 'COMPANY_CHARTER'
  | 'DIRECTOR_APPOINTMENT'
  | 'OWNERSHIP_STRUCTURE'
  | 'OTHER';
export type SourceOfFunds =
  | 'SALARY'
  | 'BUSINESS'
  | 'INVESTMENTS'
  | 'SALE_OF_ASSETS'
  | 'INHERITANCE'
  | 'SAVINGS'
  | 'OTHER';

export const INVESTOR_TYPE_TITLE: Record<InvestorType, string> = {
  INDIVIDUAL: 'Частное лицо',
  COMPANY: 'Компания',
};

export const KYC_STATUS_TITLE: Record<KycStatus, string> = {
  NOT_STARTED: 'Не начата',
  DRAFT: 'Черновик',
  PENDING: 'На проверке',
  ON_HOLD: 'Отложена',
  APPROVED: 'Допущен',
  RETRY: 'Нужны правки',
  REJECTED: 'Отказано',
};

export const ID_DOC_TITLE: Record<IdDocType, string> = {
  PASSPORT: 'Загранпаспорт',
  ID_CARD: 'Удостоверение личности',
  RESIDENCE_PERMIT: 'Вид на жительство',
  DRIVERS: 'Водительское удостоверение',
};

export const INVESTOR_DOCUMENT_TITLE: Record<InvestorDocumentKind, string> = {
  IDENTITY: 'Документ, удостоверяющий личность',
  SELFIE: 'Селфи с документом',
  PROOF_OF_ADDRESS: 'Подтверждение адреса',
  COMPANY_REGISTRY: 'Выписка из торгового реестра',
  COMPANY_CHARTER: 'Устав',
  DIRECTOR_APPOINTMENT: 'Решение о назначении руководителя',
  OWNERSHIP_STRUCTURE: 'Структура собственности',
  OTHER: 'Прочее',
};

export const SOURCE_OF_FUNDS_TITLE: Record<SourceOfFunds, string> = {
  SALARY: 'Зарплата и трудовой доход',
  BUSINESS: 'Доход от бизнеса',
  INVESTMENTS: 'Доход от инвестиций',
  SALE_OF_ASSETS: 'Продажа имущества',
  INHERITANCE: 'Наследство или дарение',
  SAVINGS: 'Накопления',
  OTHER: 'Другое',
};

/** Документы, которые нужно приложить. Совпадает с проверками бэкенда. */
export const REQUIRED_DOCUMENTS: Record<InvestorType, InvestorDocumentKind[]> =
  {
    INDIVIDUAL: ['IDENTITY', 'SELFIE'],
    COMPANY: [
      'IDENTITY',
      'SELFIE',
      'COMPANY_REGISTRY',
      'COMPANY_CHARTER',
      'DIRECTOR_APPOINTMENT',
      'OWNERSHIP_STRUCTURE',
    ],
  };

export interface Country {
  /** ISO 3166-1 alpha-3. */
  code: string;
  name: string;
  blocked: boolean;
}

export interface InvestorBeneficiary {
  id: string;
  fullName: string;
  country: string;
  /** Доля в сотых долях процента: 2500 — это 25%. */
  shareBps: number;
  position: string | null;
  isPep: boolean;
}

export interface InvestorFile {
  id: string;
  kind: InvestorDocumentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

/** Поля анкеты, которые заполняет инвестор. */
export interface InvestorInput {
  type?: InvestorType;
  step?: number;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  dob?: string;
  placeOfBirth?: string;
  countryOfBirth?: string;
  nationality?: string;
  country?: string;
  addressLine?: string;
  city?: string;
  postCode?: string;
  phone?: string;
  position?: string;
  idDocType?: IdDocType;
  idDocNumber?: string;
  idDocCountry?: string;
  idDocValidUntil?: string;
  companyName?: string;
  registrationNumber?: string;
  incorporatedOn?: string;
  companyCountry?: string;
  legalAddress?: string;
  website?: string;
  sourceOfFunds?: SourceOfFunds;
  sourceOfFundsNote?: string;
  isPep?: boolean;
  pepDetails?: string;
  acceptTerms?: boolean;
  acceptRisk?: boolean;
  withdrawalAddress?: string;
}

/** Анкета так, как её отдаёт сервер: незаполненные поля приходят пустыми. */
export interface Investor {
  id: string;
  userId: string;
  type: InvestorType;
  step: number;
  status: KycStatus;
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  dob: string | null;
  placeOfBirth: string | null;
  countryOfBirth: string | null;
  nationality: string | null;
  country: string | null;
  addressLine: string | null;
  city: string | null;
  postCode: string | null;
  phone: string | null;
  position: string | null;
  idDocType: IdDocType | null;
  idDocNumber: string | null;
  idDocCountry: string | null;
  idDocValidUntil: string | null;
  companyName: string | null;
  registrationNumber: string | null;
  incorporatedOn: string | null;
  companyCountry: string | null;
  legalAddress: string | null;
  website: string | null;
  sourceOfFunds: SourceOfFunds | null;
  sourceOfFundsNote: string | null;
  isPep: boolean | null;
  pepDetails: string | null;
  withdrawalAddress: string | null;
  provider: 'MANUAL' | 'SUMSUB';
  levelName: string | null;
  reviewAnswer: 'GREEN' | 'RED' | null;
  reviewRejectType: 'RETRY' | 'FINAL' | null;
  rejectLabels: string[];
  /** Только у админа: внутренняя заметка модератора. */
  moderationComment?: string | null;
  /** Что инвестору исправить. */
  clientComment: string | null;
  reviewedAt: string | null;
  submittedAt: string | null;
  termsAcceptedAt: string | null;
  riskAcceptedAt: string | null;
  withdrawalCheckResult: string | null;
  pendingWithdrawalAddress: string | null;
  pendingRequestedAt: string | null;
  onchainAccount: string | null;
  onchainSignature: string | null;
  onchainCreatedAt: string | null;
  whitelistStatus: boolean;
  whitelistBlockedUntil: string | null;
  createdAt: string;
  documents: InvestorFile[];
  beneficiaries: InvestorBeneficiary[];
  user: { id: string; email: string; name: string; status: UserStatus };
}

export interface InvestorCheck {
  key: string;
  title: string;
  ok: boolean;
  hint?: string;
}

export interface InvestorProfile {
  investor: Investor;
  checks: InvestorCheck[];
  /** Ссылка на аккаунт в обозревателе; собирает бэкенд, он знает про сеть. */
  accountUrl: string | null;
}

export type InvestorCard = InvestorProfile;

export interface InvestorListItem {
  id: string;
  type: InvestorType;
  status: KycStatus;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  country: string | null;
  submittedAt: string | null;
  createdAt: string;
  user: { id: string; email: string; status: UserStatus };
  _count: { documents: number };
}

export interface InvestorList {
  investors: InvestorListItem[];
  /** Сколько заявок ждёт решения — для значка в меню. */
  pending: number;
}

export interface InvestorEvent {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

export type DecisionAction = 'approve' | 'retry' | 'reject' | 'hold';

export interface BeneficiaryInput {
  fullName: string;
  country: string;
  shareBps: number;
  position?: string;
  isPep?: boolean;
}

// ── Участие в кампании ─────────────────────────────────────────────────────

/** Что происходит с кампанией. Считает бэкенд: одного состояния сделки мало. */
export type CampaignStatus =
  | 'FUNDING'
  | 'FUNDING_ENDED'
  | 'ACTIVE'
  | 'OVERDUE'
  | 'DEFAULT'
  | 'REPAID'
  | 'FAILED'
  | 'UNKNOWN';

export const CAMPAIGN_STATUS_TITLE: Record<CampaignStatus, string> = {
  FUNDING: 'Идёт сбор',
  FUNDING_ENDED: 'Сбор завершён',
  ACTIVE: 'Действует',
  OVERDUE: 'Просрочка',
  DEFAULT: 'Дефолт',
  REPAID: 'Погашен',
  FAILED: 'Сбор не состоялся',
  UNKNOWN: 'Уточняется',
};

/** Плитка кампании на витрине. */
export interface CampaignCard {
  id: string;
  title: string;
  borrower: {
    id: string;
    name: string;
    logoKey: string | null;
    rating: CreditRating | null;
  };
  /** Фотография предприятия; пусто — покажем логотип. */
  photoUrl: string | null;
  status: CampaignStatus;
  scheduleKind: ScheduleKind;
  annualRateBps: number | null;
  mintDecimals: number;
  softCap: string;
  hardCap: string;
  minTicket: string;
  maxTicket: string;
  totalRaised: string;
  /** Unix-секунды. */
  fundingDeadline: number;
  /** Дата последнего платежа: по ней считаем срок до конца займа. */
  lastDueTs: number;
  /** Сколько вложил текущий инвестор. */
  invested: string;
}

/** Почему зачислить нельзя и что с этим делать. */
export interface DepositBlock {
  code: string;
  reason: string;
  action: 'wait' | 'withdraw' | 'none';
}

export interface DepositCredit {
  amount: string;
  sender: string | null;
  createdAt: string;
  url: string;
}

export interface DepositState {
  campaign: {
    id: string;
    title: string;
    borrower: CampaignCard['borrower'];
    annualRateBps: number | null;
    periodCount: number | null;
    scheduleStep: ScheduleStep;
    scheduleKind: ScheduleKind;
    /** Номинал бумаги у облигации: взнос обязан быть кратен ему. */
    faceValue: string | null;
    mint: string;
    mintDecimals: number;
  };
  /** Сбор больше не принимает деньги: дедлайн прошёл или сбор закрыт. */
  fundingOver: boolean;
  deal: {
    state: string;
    totalRaised: string;
    softCap: string;
    hardCap: string;
    minTicket: string;
    maxTicket: string;
    fundingStart: number;
    fundingDeadline: number;
  };
  deposit: {
    /** Этот адрес показываем инвестору: на него переводят деньги. */
    owner: string;
    address: string;
    openedAt: string;
    claimedAt: string | null;
    url: string;
  } | null;
  /** Лежит на адресе и ещё не зачислено. */
  pending: string;
  /** Уже вложено в кампанию. */
  invested: string;
  creditable: string;
  block: DepositBlock | null;
  /** Пусто, когда участвовать можно; иначе — почему пока нельзя. */
  participationBlock: string | null;
  credits: DepositCredit[];
  /** Появляется в ответ на попытку зачисления. */
  result?: { credited: string; message: string };
}

// ── Страница кампании ──────────────────────────────────────────────────────

/** Сколько инвестору причитается, по статьям распределения. */
export interface PayoutParts {
  principal: string;
  interest: string;
  penalty: string;
  prepaymentFee: string;
  total: string;
}

export interface CampaignPosition {
  address: string;
  principal: string;
  /** Доля в кампании в сотых долях процента: 2500 — это 25%. */
  shareBps: number;
  payout: PayoutParts;
  /** Сколько вернётся за весь срок, если заём погасят по графику. */
  expected: string;
  next: {
    index: number;
    dueTs: number;
    total: string;
    /** Сколько из этого платежа придётся на вас. */
    yours: string;
  } | null;
}

export interface InvestorShare {
  address: string;
  principal: string;
  shareBps: number;
  /** Ваша строка в списке долей. */
  mine: boolean;
  url: string;
}

export interface OnchainDealFull {
  state: string;
  totalRaised: string;
  periodCount: number;
  borrowerWallet: string;
  fundingStart: number;
  fundingDeadline: number;
  softCap: string;
  hardCap: string;
  minTicket: string;
  maxTicket: string;
  lastDueTs: number;
  overduePrincipal: string;
  nextPeriod: number;
}

export interface CampaignPage {
  campaign: {
    id: string;
    title: string;
    purpose: string | null;
    collateral: string | null;
    scheduleKind: ScheduleKind;
    scheduleStep: ScheduleStep;
    periodsPerYear: number;
    periodCount: number | null;
    annualRateBps: number | null;
    penaltyRateBps: number;
    defaultThresholdDays: number;
    prepaymentFeeBps: number;
    cancelGraceDays: number;
    mint: string;
    mintDecimals: number;
    firstDueAt: string | null;
  };
  borrower: {
    id: string;
    name: string;
    logoKey: string | null;
    rating: CreditRating | null;
    description: string | null;
    industry: string | null;
    website: string | null;
    foundedAt: string | null;
    photos: { id: string; caption: string | null }[];
  };
  status: CampaignStatus;
  deal: OnchainDealFull;
  schedules: { min: Schedule; max: Schedule; collecting: boolean };
  position: CampaignPosition | null;
  investors: {
    count: number;
    total: string;
    average: string;
    largestShareBps: number;
    shares: InvestorShare[];
  };
  addresses: { label: string; address: string; url: string }[];
  /** Минт облигации и ссылка на его расширения; у кредита бумаги нет. */
  bond: { mint: string; url: string } | null;
  participationBlock: string | null;
  /** Часы платформы в unix-секундах: время считаем по ним, а не по браузеру. */
  now: number;
}

/** Событие контракта в истории кампании. */
export interface CampaignEvent {
  name: string;
  payload: Record<string, string>;
  at: string | null;
  signature: string;
  url: string;
}

/** Понятные подписи событий: имена из контракта человеку ничего не говорят. */
export const EVENT_TITLE: Record<string, string> = {
  CampaignCreated: 'Кампания создана',
  SchedulePeriodsAdded: 'Загружен график',
  ScheduleFinalized: 'График зафиксирован',
  DepositOpened: 'Открыт адрес пополнения',
  Invested: 'Взнос зачислён',
  FundingClosed: 'Сбор закрыт, деньги у заёмщика',
  FundingFailed: 'Сбор не состоялся',
  CampaignCancelled: 'Кампания отменена',
  RepaymentProcessed: 'Платёж заёмщика',
  EarlyRepayment: 'Досрочное погашение',
  DefaultMarked: 'Объявлен дефолт',
  RecoveryCostRecorded: 'Расходы на взыскание',
  PayoutWithdrawn: 'Выплата инвестору',
  RefundWithdrawn: 'Возврат взноса',
  DepositWithdrawn: 'Остаток возвращён инвестору',
  BorrowerWalletChanged: 'Сменён кошелёк заёмщика',
};

// ── Кабинет заёмщика ───────────────────────────────────────────────────────

/** Ближайший платёж по графику. */
export interface LoanPayment {
  index: number;
  dueTs: number;
  principal: string;
  interest: string;
  total: string;
}

/** Из чего складывается сумма к оплате. */
export interface AmountDue {
  scheduledInterest: string;
  extraInterest: string;
  principal: string;
  penalty: string;
  total: string;
}

/** Плитка займа в списке своих займов. */
export interface LoanCard {
  id: string;
  title: string;
  mintDecimals: number;
  annualRateBps: number | null;
  scheduleKind: ScheduleKind;
  status: CampaignStatus;
  totalRaised: string;
  softCap: string;
  hardCap: string;
  fundingDeadline: number;
  lastDueTs: number;
  /** Неоплаченное тело займа. */
  outstanding: string;
  /** Сколько причитается прямо сейчас. */
  due: string;
  daysPastDue: number;
  next: LoanPayment | null;
}

export type LoanPeriodStatus = 'paid' | 'overdue' | 'due' | 'upcoming';

export interface LoanSchedulePeriod {
  index: number;
  dueTs: number;
  principal: string;
  interest: string;
  total: string;
  paid: string;
  status: LoanPeriodStatus;
}

/** Котировка полного досрочного погашения. */
export interface FullPrepayQuote {
  overdue: string;
  /** Проценты текущего периода за фактическое время. */
  currentInterest: string;
  remainingPrincipal: string;
  fee: string;
  total: string;
}

/** Почему частичное досрочное погашение сейчас недоступно. */
export type PartialPrepayBlock =
  | 'NOT_ALLOWED'
  | 'NOT_ACTIVE'
  | 'NOT_PAYMENT_DATE'
  | 'HAS_ADVANCE'
  | 'LAST_PERIOD';

export interface PartialPrepayWindow {
  open: boolean;
  block: PartialPrepayBlock | null;
  /** Когда окно откроется снова: дата ближайшего платежа. */
  opensAt: number | null;
  /** Докуда открыто сейчас: сутки с даты платежа. */
  closesAt: number | null;
  /** Наибольшая сумма тела, которую можно погасить частично. */
  maxAmount: string;
}

/** Предпросмотр частичного погашения: что перевести и каким станет график. */
export interface PartialPrepayQuote {
  due: string;
  principal: string;
  fee: string;
  total: string;
  saved: string;
  periods: {
    index: number;
    dueTs: number;
    principal: string;
    interest: string;
    total: string;
    /** Каким платёж был до досрочного погашения. */
    was: string;
  }[];
}

export interface LoanPage {
  campaign: {
    id: string;
    title: string;
    purpose: string | null;
    collateral: string | null;
    scheduleKind: ScheduleKind;
    scheduleStep: ScheduleStep;
    annualRateBps: number | null;
    penaltyRateBps: number;
    defaultThresholdDays: number;
    periodCount: number | null;
    mint: string;
    mintDecimals: number;
  };
  status: CampaignStatus;
  deal: {
    state: string;
    totalRaised: string;
    softCap: string;
    hardCap: string;
    fundingDeadline: number;
    lastDueTs: number;
    borrowerWallet: string;
  };
  due: AmountDue;
  /** Появляется после дефолта: долг во взыскании и расходы платформы. */
  recovery: {
    interest: string;
    principal: string;
    penalty: string;
    total: string;
    costs: string;
    outstanding: string;
  } | null;
  /** Момент, по состоянию на который долг считал сам контракт. */
  accruedTo: number;
  next: LoanPayment | null;
  outstanding: string;
  totalOutstanding: string;
  daysPastDue: number;
  schedule: LoanSchedulePeriod[];
  repay: {
    address: string;
    url: string;
    balance: string;
    /** Излишек, который можно зачесть в счёт будущих платежей. */
    advance: string;
    /** Переплата закрытого займа: её забирают обратно. */
    excess: string;
  };
  /** Досрочное погашение: разрешено ли, во что обойдётся и открыто ли окно. */
  prepayment: {
    allowed: boolean;
    feeBps: number;
    full: FullPrepayQuote | null;
    partial: PartialPrepayWindow;
  };
  now: number;
  /** Появляется в ответ на попытку провести платёж. */
  result?: { received: string; message: string };
}

/** Карточка своей компании в профиле заёмщика: только для чтения. */
export interface BorrowerProfile {
  id: string;
  name: string;
  bin: string;
  status: BorrowerStatus;
  rating: CreditRating | null;
  industry: string | null;
  address: string | null;
  website: string | null;
  foundedAt: string | null;
  employees: number | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  logoKey: string | null;
  wallets: (BorrowerWallet & { url: string })[];
}

// ── Портфель инвестора ─────────────────────────────────────────────────────

/** Ближайший платёж по кампании и доля инвестора в нём. */
export interface PortfolioPayment {
  index: number;
  dueTs: number;
  total: string;
  /** Сколько из этого платежа придётся на вас. */
  yours: string;
}

/** Участие в одной кампании. */
export interface PortfolioRow {
  id: string;
  title: string;
  borrower: { id: string; name: string; logoKey: string | null };
  status: CampaignStatus;
  mintDecimals: number;
  annualRateBps: number | null;
  scheduleKind: ScheduleKind;
  /** Сколько внесено: у возвращённого взноса берётся из своих зачислений. */
  invested: string;
  /** Сколько уже пришло на адрес вывода. */
  received: string;
  /** Доступно к выводу прямо сейчас. */
  available: string;
  /** Доля в кампании в сотых долях процента: 2500 — это 25%. */
  shareBps: number;
  /** true — забирается взнос несостоявшегося сбора, а не выплата. */
  refund: boolean;
  payout: PayoutParts;
  next: PortfolioPayment | null;
  fundingDeadline: number;
  lastDueTs: number;
  finished: boolean;
}

/** Итоги портфеля: простая сумма по строкам. */
export interface PortfolioTotals {
  invested: string;
  received: string;
  available: string;
  activeCount: number;
}

export interface Portfolio {
  rows: PortfolioRow[];
  totals: PortfolioTotals;
  /** Пусто, когда забирать можно; иначе — почему пока нельзя. */
  participationBlock: string | null;
  now?: number;
}

// ── Дашборд админа ─────────────────────────────────────────────────────────

/** Займ с просрочкой в списке у админа. */
export interface OverdueLoan {
  id: string;
  title: string;
  borrower: { id: string; name: string };
  status: CampaignStatus;
  mintDecimals: number;
  daysPastDue: number;
  defaultThresholdDays: number;
  due: string;
}

export interface AdminDashboard {
  funding: number;
  /** Собрано по сборам, закрытым за последние 30 дней. */
  raised: string;
  overdueCount: number;
  pendingKyc: number;
  overdue: OverdueLoan[];
}

// ── Витрина заёмщика ───────────────────────────────────────────────────────

export interface BorrowerShowcase {
  borrower: {
    id: string;
    name: string;
    description: string | null;
    industry: string | null;
    website: string | null;
    foundedAt: string | null;
    employees: number | null;
    rating: CreditRating | null;
    logoKey: string | null;
    photos: { id: string; caption: string | null }[];
  };
  campaigns: {
    id: string;
    title: string;
    annualRateBps: number | null;
    scheduleKind: ScheduleKind;
    mintDecimals: number;
    status: CampaignStatus;
    totalRaised: string;
    softCap: string;
    hardCap: string;
    fundingDeadline: number;
    lastDueTs: number;
  }[];
  /** Сколько займов заёмщик уже погасил: это и есть его история. */
  repaid: number;
  now: number;
}

// ── Облигации и корпоративные действия ─────────────────────────────────────

export type BondStatus =
  | 'active'
  | 'defaulted'
  | 'redeemed'
  /** Сбор не состоялся: взносы вернулись, бумаги сожжены без погашения. */
  | 'cancelled';

export const BOND_STATUS_TITLE: Record<BondStatus, string> = {
  active: 'В обращении',
  defaulted: 'Взыскание',
  redeemed: 'Погашена',
  cancelled: 'Сбор не состоялся',
};

/** Вид корпоративного действия: перечисление открытое, растёт вместе с рынком. */
export type ActionKind =
  'record' | 'coupon' | 'redemption' | 'vote' | 'default' | 'recovery';

/**
 * Виды действий. Названия нарочно не пересекаются со стадиями и с датами:
 * «Реестр без выплаты» — вид, «Реестр снят» — стадия; «Погашение бумаг» —
 * действие, «Срок погашения» — дата, «Погашена» — состояние выпуска.
 */
export const ACTION_KIND_TITLE: Record<ActionKind, string> = {
  record: 'Реестр без выплаты',
  coupon: 'Купон',
  redemption: 'Погашение бумаг',
  vote: 'Голосование держателей',
  default: 'Дефолт',
  recovery: 'Взыскание',
};

/**
 * Код события по ISO 15022 (поле CAEV): им депозитарии описывают корпоративные
 * действия десятки лет. У реестра без выплаты кода нет — это служебный срез
 * держателей, а не событие по бумаге, и подбирать ему код из стандарта хуже,
 * чем не показывать никакого.
 */
export const ACTION_EVENT_CODE: Partial<Record<ActionKind, string>> = {
  coupon: 'INTR',
  redemption: 'REDM',
  vote: 'BMET',
};

/** Обязательность действия для держателя, поле CAMV того же стандарта. */
export const ACTION_MANDATORY_CODE: Partial<Record<ActionKind, string>> = {
  coupon: 'MAND',
  redemption: 'MAND',
  record: 'MAND',
  vote: 'VOLU',
};

/** Расшифровки кодов: уходят в подсказку, чтобы код не требовал сноски. */
export const ACTION_CODE_MEANING: Record<string, string> = {
  INTR: 'Interest Payment — выплата процентов',
  REDM: 'Redemption — погашение',
  BMET: 'Bondholder Meeting — собрание держателей',
  MAND: 'Mandatory — обязательное, участие держателя не требуется',
  VOLU: 'Voluntary — добровольное, держатель решает сам',
};

export type ActionStatus = 'declared' | 'snapshot' | 'settled' | 'closed';

export const ACTION_STATUS_TITLE: Record<ActionStatus, string> = {
  declared: 'Объявлено',
  snapshot: 'Список составлен',
  settled: 'Исполнено',
  closed: 'Закрыто',
};

/**
 * У голосования «исполнено» значит не «деньги выплачены», а «итог записан
 * в сеть». Слово одно на два разных события, поэтому подпись зависит от вида.
 */
export const actionStatusTitle = (status: ActionStatus, kind: ActionKind) =>
  status === 'settled' && kind === 'vote'
    ? 'Итог записан'
    : ACTION_STATUS_TITLE[status];

/** Корпоративное действие так, как оно записано в сети. */
export interface CorporateAction {
  index: number;
  kind: ActionKind;
  /** Дата фиксации: на кого распространяется действие. */
  recordTs: number;
  paymentTs: number;
  /** Сумма на бумагу; у голосования — одобренный бюджет взыскания. */
  amountPerUnit: string;
  holders: number;
  units: string;
  totalAmount: string;
  /** Хеш опубликованного реестра держателей. */
  registerHash: string;
  settlement: string | null;
  settlementUrl?: string | null;
  /** Итог из сети: заполняется только при исполнении, до него нули. */
  votesFor: string;
  votesAgainst: string;
  status: ActionStatus;
  votes?: number;
}

/**
 * Подсчёт по бюллетеням платформы — настоящий текущий итог голосования. До
 * исполнения показывать нужно его, после — тот, что уже ушёл в сеть. Приходит
 * на экранах выпуска и держателя; в списке выпусков голоса не показываются,
 * поэтому там его и не считают.
 */
export interface LiveTally {
  liveFor: string;
  liveAgainst: string;
  liveTurnoutBps: number;
  liveQuorumReached: boolean;
  /** Какая явка нужна, чтобы решение считалось принятым. */
  quorumBps: number;
}

/** Строка списка выпусков у админа. */
/**
 * Выпуск на публичной странице проверки. Держателей тут нет: они приходят
 * отдельным запросом по снимку, и только теми полями, что идут в хеш.
 */
export interface PublicBondSummary {
  campaignId: string;
  title: string;
  mintDecimals: number;
  isin: string;
  status: BondStatus;
  faceValue: string;
  couponRateBps: number;
  couponsPerYear: number;
  maturityTs: number;
  issued: string;
  outstanding: string;
  actions: number;
}

export interface PublicBond extends Omit<PublicBondSummary, 'actions'> {
  mint: string;
  mintUrl: string;
  /** Журнал действий выпуска: тот же, что видит регистратор, без имён. */
  actions: CorporateAction[];
  /** Часы платформы: по ним на странице считаются даты. */
  now: number;
}

/** Канонический список по снимку — ровно то, что покрыто отпечатком. */
export interface PublicRegisterRow {
  holder: string;
  tokenAccount: string;
  units: string;
  amount: string;
}

export interface PublicRegister {
  recordTs: number;
  units: string;
  totalAmount: string;
  hash: string;
  holders: PublicRegisterRow[];
}

export interface BondSummary {
  campaignId: string;
  title: string;
  borrower: { id: string; name: string };
  mintDecimals: number;
  mint: string;
  faceValue: string;
  couponRateBps: number;
  couponsPerYear: number;
  maturityTs: number;
  maxSupply: string;
  issued: string;
  outstanding: string;
  /** Идентификатор по ISO 6166; пусто, пока не присвоен. */
  isin: string;
  status: BondStatus;
  /** Состояние займа в `dala_capital`: по нему виден несостоявшийся сбор. */
  dealState: string;
  actions: number;
  pending: CorporateAction | null;
  /** Часы платформы: по ним видно, пора ли делать следующий шаг. */
  now: number;
}

export interface BondPage {
  campaign: { id: string; title: string; mintDecimals: number };
  registry: Omit<
    BondSummary,
    | 'campaignId'
    | 'title'
    | 'borrower'
    | 'mintDecimals'
    | 'actions'
    | 'pending'
    | 'dealState'
  > & {
    address: string;
  };
  /** Сколько платится на одну бумагу — считается из условий выпуска. */
  couponPerUnit: string;
  redemptionPerUnit: string;
  mintUrl: string;
  status: CampaignStatus;
  /** Состояние займа в `dala_capital`: от него зависит, можно ли гасить бумаги. */
  dealState: string;
  /** Пусто — бумаги можно гасить; иначе почему нельзя. */
  redeemBlock: string | null;
  /** График займа: по нему подставляются даты корпоративных действий. */
  schedule: { index: number; dueTs: number; paid: boolean }[];
  holders: {
    holder: string;
    tokenAccount: string;
    units: string;
    url: string;
    /** Кто это по анкете; пусто — связь потерялась, и это видно на экране. */
    investor: InvestorBrief | null;
  }[];
  actions: (CorporateAction & LiveTally)[];
  now: number;
}

/** Держатель так, как его видит админ: реестр ведётся поимённо. */
export interface InvestorBrief {
  investorId: string;
  type: string;
  title: string;
  country: string | null;
}

/** Бумага в кабинете держателя. */
export interface MyBond {
  campaignId: string;
  title: string;
  borrower: { id: string; name: string };
  mintDecimals: number;
  mint: string;
  mintUrl: string;
  status: BondStatus;
  /** Идентификатор по ISO 6166; пусто, пока не присвоен. */
  isin: string;
  /** Состояние займа в `dala_capital`: по нему виден несостоявшийся сбор. */
  dealState: string;
  units: string;
  faceValue: string;
  couponRateBps: number;
  couponsPerYear: number;
  maturityTs: number;
  couponAmount: string;
  redemptionAmount: string;
  actions: (CorporateAction &
    LiveTally & {
      /** Бумаг у держателя на дату фиксации — по ним считается его право. */
      myUnits: string;
      myAmount: string;
      myVote: 'FOR' | 'AGAINST' | null;
      canVote: boolean;
    })[];
}

export interface VoteTally {
  forUnits: string;
  againstUnits: string;
  turnoutBps: number;
  quorumReached: boolean;
  passed: boolean;
}
