import type {
  ActionKind,
  AdminDashboard,
  BondPage,
  BondSummary,
  MyBond,
  VoteTally,
  BorrowerDetails,
  BorrowerDocument,
  BorrowerEvent,
  BorrowerInput,
  BorrowerListItem,
  BorrowerPhoto,
  BorrowerProfile,
  BorrowerShowcase,
  BorrowerWallet,
  BorrowerSaveResult,
  BorrowerStatus,
  Campaign,
  CampaignCheck,
  CampaignInput,
  CampaignListItem,
  CampaignState,
  DocumentKind,
  OnchainDeal,
  AdminAction,
  PlatformState,
  Task,
  TokenInfo,
  SchedulePreview,
  InviteResult,
  User,
  WalletSaveResult,
  BeneficiaryInput,
  Country,
  DecisionAction,
  CampaignCard,
  CampaignEvent,
  CampaignPage,
  DepositState,
  Investor,
  InvestorBeneficiary,
  InvestorCard,
  InvestorDocumentKind,
  InvestorEvent,
  InvestorFile,
  InvestorInput,
  InvestorList,
  InvestorProfile,
  KycStatus,
  LoanCard,
  LoanPage,
  PartialPrepayQuote,
  Portfolio,
} from './types';

/** Ошибка от API с человеческим текстом для показа под формой. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Достаёт текст ошибки: Nest кладёт в message строку или список строк валидации. */
function messageFrom(body: unknown, status: number): string {
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.join('. ');
  if (typeof message === 'string') return message;
  return status >= 500
    ? 'Сервис недоступен, попробуйте позже'
    : 'Что-то пошло не так';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Для FormData заголовок Content-Type ставит сам браузер вместе с границей блоков.
  const isFormData = init.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      // Кука сессии — httpOnly, поэтому её всегда шлём вместе с запросом.
      credentials: 'include',
      headers: isFormData
        ? init.headers
        : { 'Content-Type': 'application/json', ...init.headers },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('Нет связи с сервером', 0);
  }

  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(messageFrom(body, response.status), response.status);
  return body as T;
}

export const api = {
  me: () => request<User>('/auth/me'),
  login: (email: string, password: string) =>
    request<User>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (input: { name: string; email: string; password: string }) =>
    request<User>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  /** Меняется только имя: почта — это логин. */
  updateName: (name: string) =>
    request<User>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  /** Справочник стран: нужен и в анкете инвестора, и в карточке админа. */
  countries: () => request<Country[]>('/countries'),

  invite: {
    read: (token: string) =>
      request<{ company: string; email: string }>(`/invite/${token}`),
    accept: (token: string, password: string) =>
      request<User>(`/invite/${token}`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
  },

  borrowers: {
    list: (
      params: {
        query?: string;
        status?: BorrowerStatus;
        includeArchived?: boolean;
      } = {},
    ) => {
      const search = new URLSearchParams();
      if (params.query) search.set('query', params.query);
      if (params.status) search.set('status', params.status);
      if (params.includeArchived) search.set('includeArchived', 'true');
      const suffix = search.size > 0 ? `?${search}` : '';
      return request<BorrowerListItem[]>(`/borrowers${suffix}`);
    },
    get: (id: string) => request<BorrowerDetails>(`/borrowers/${id}`),
    create: (input: BorrowerInput) =>
      request<BorrowerSaveResult>('/borrowers', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (id: string, input: BorrowerInput) =>
      request<BorrowerSaveResult>(`/borrowers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    history: (id: string) =>
      request<BorrowerEvent[]>(`/borrowers/${id}/history`),
    invite: (id: string, email: string) =>
      request<InviteResult>(`/borrowers/${id}/invite`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),

    revokeInvite: (id: string) =>
      request<void>(`/borrowers/${id}/invite`, { method: 'DELETE' }),

    addWallet: (id: string, input: { label: string; address: string }) =>
      request<WalletSaveResult>(`/borrowers/${id}/wallets`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    updateWallet: (
      id: string,
      walletId: string,
      input: { label?: string; isDefault?: boolean },
    ) =>
      request<BorrowerWallet>(`/borrowers/${id}/wallets/${walletId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    removeWallet: (id: string, walletId: string) =>
      request<void>(`/borrowers/${id}/wallets/${walletId}`, {
        method: 'DELETE',
      }),

    addPhoto: (id: string, file: File, caption: string) => {
      const form = new FormData();
      form.append('file', file);
      if (caption) form.append('caption', caption);
      return request<BorrowerPhoto>(`/borrowers/${id}/photos`, {
        method: 'POST',
        body: form,
      });
    },
    updatePhoto: (
      id: string,
      photoId: string,
      input: { caption?: string; sortOrder?: number },
    ) =>
      request<BorrowerPhoto>(`/borrowers/${id}/photos/${photoId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    removePhoto: (id: string, photoId: string) =>
      request<void>(`/borrowers/${id}/photos/${photoId}`, { method: 'DELETE' }),
    photoUrl: (id: string, photoId: string) =>
      `/api/borrowers/${id}/photos/${photoId}`,

    setLogo: (id: string, file: File) => {
      const form = new FormData();
      form.append('file', file);
      return request<BorrowerDetails>(`/borrowers/${id}/logo`, {
        method: 'POST',
        body: form,
      });
    },
    logoUrl: (id: string) => `/api/borrowers/${id}/logo`,
    addDocument: (id: string, file: File, kind: DocumentKind) => {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);
      return request<BorrowerDocument>(`/borrowers/${id}/documents`, {
        method: 'POST',
        body: form,
      });
    },
    documentUrl: (id: string, documentId: string) =>
      `/api/borrowers/${id}/documents/${documentId}`,
    removeDocument: (id: string, documentId: string) =>
      request<void>(`/borrowers/${id}/documents/${documentId}`, {
        method: 'DELETE',
      }),
  },

  /** Что требует внимания у того, кто спрашивает: роль берётся из сессии. */
  tasks: {
    list: () => request<Task[]>('/tasks'),
  },

  platform: {
    state: () => request<PlatformState>('/platform'),
    /** Проверка адреса до разрешения: токен ли это и сколько у него знаков. */
    token: (mint: string) => request<TokenInfo>(`/platform/token?mint=${mint}`),
    allowMint: (mint: string) =>
      request<{ signature: string; url: string }>('/platform/tokens', {
        method: 'POST',
        body: JSON.stringify({ mint }),
      }),
    removeMint: (mint: string) =>
      request<{ signature: string; url: string }>('/platform/tokens', {
        method: 'DELETE',
        body: JSON.stringify({ mint }),
      }),
    log: () => request<AdminAction[]>('/platform/log'),
  },

  campaigns: {
    list: (params: { state?: CampaignState; borrowerId?: string } = {}) => {
      const search = new URLSearchParams();
      if (params.state) search.set('state', params.state);
      if (params.borrowerId) search.set('borrowerId', params.borrowerId);
      const suffix = search.size > 0 ? `?${search}` : '';
      return request<CampaignListItem[]>(`/campaigns${suffix}`);
    },
    get: (id: string) => request<Campaign>(`/campaigns/${id}`),
    create: (input: { borrowerId: string; title: string }) =>
      request<Campaign>('/campaigns', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (id: string, input: CampaignInput) =>
      request<Campaign>(`/campaigns/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    remove: (id: string) =>
      request<void>(`/campaigns/${id}`, { method: 'DELETE' }),
    /** Считает график с учётом ещё не сохранённых правок. */
    preview: (id: string, input: CampaignInput = {}) =>
      request<SchedulePreview>(`/campaigns/${id}/preview`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    checks: (id: string) => request<CampaignCheck[]>(`/campaigns/${id}/checks`),
    csvUrl: (id: string) => `/api/campaigns/${id}/schedule.csv`,
    publish: (id: string) =>
      request<Campaign>(`/campaigns/${id}/publish`, { method: 'POST' }),
    onchain: (id: string) =>
      request<OnchainDeal | null>(`/campaigns/${id}/onchain`),
    /** Дефолт: порог проверяет и контракт, и бэкенд. */
    markDefault: (id: string) =>
      request<OnchainDeal>(`/campaigns/${id}/default`, { method: 'POST' }),
    recoveryCost: (id: string, amount: string) =>
      request<OnchainDeal>(`/campaigns/${id}/recovery-cost`, {
        method: 'POST',
        body: JSON.stringify({ amount }),
      }),
    recoveryPayment: (id: string) =>
      request<OnchainDeal>(`/campaigns/${id}/recovery-payment`, {
        method: 'POST',
      }),
    cancel: (id: string) =>
      request<OnchainDeal>(`/campaigns/${id}/cancel`, { method: 'POST' }),
    /** Закрытие сбора: деньги уходят заёмщику или кампания становится несостоявшейся. */
    close: (id: string) =>
      request<OnchainDeal>(`/campaigns/${id}/close`, { method: 'POST' }),
    setBorrowerWallet: (id: string, walletId: string) =>
      request<OnchainDeal>(`/campaigns/${id}/borrower-wallet`, {
        method: 'POST',
        body: JSON.stringify({ walletId }),
      }),
  },

  /** Кабинет заёмщика: свои займы, состояние долга и погашение. */
  loans: {
    list: () => request<LoanCard[]>('/borrowers/me/loans'),
    get: (id: string) => request<LoanPage>(`/borrowers/me/loans/${id}`),
    /** «Я перевёл»: проводит причитающееся, излишек остаётся на адресе. */
    repay: (id: string) =>
      request<LoanPage>(`/borrowers/me/loans/${id}/repay`, { method: 'POST' }),
    /** Зачитывает излишек в счёт будущих платежей. */
    advance: (id: string) =>
      request<LoanPage>(`/borrowers/me/loans/${id}/advance`, {
        method: 'POST',
      }),
    /** Забирает переплату с адреса погашения после закрытия займа. */
    excess: (id: string) =>
      request<LoanPage>(`/borrowers/me/loans/${id}/excess`, {
        method: 'POST',
      }),
    profile: () => request<BorrowerProfile>('/borrowers/me/profile'),

    /** Предпросмотр частичного досрочного погашения: сумма и новый график. */
    prepayQuote: (id: string, amount: string) =>
      request<PartialPrepayQuote>(`/borrowers/me/loans/${id}/prepay/quote`, {
        method: 'POST',
        body: JSON.stringify({ amount }),
      }),
    prepayFull: (id: string) =>
      request<LoanPage>(`/borrowers/me/loans/${id}/prepay/full`, {
        method: 'POST',
      }),
    prepayPartial: (id: string, amount: string) =>
      request<LoanPage>(`/borrowers/me/loans/${id}/prepay/partial`, {
        method: 'POST',
        body: JSON.stringify({ amount }),
      }),
  },

  /** Своя анкета инвестора. */
  kyc: {
    me: () => request<InvestorProfile>('/investors/me'),
    update: (input: InvestorInput) =>
      request<InvestorProfile>('/investors/me', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    submit: () =>
      request<InvestorProfile>('/investors/me/submit', { method: 'POST' }),
    requestAddress: (address: string) =>
      request<InvestorProfile>('/investors/me/withdrawal-address', {
        method: 'POST',
        body: JSON.stringify({ address }),
      }),
    addDocument: (file: File, kind: InvestorDocumentKind) => {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);
      return request<InvestorFile>('/investors/me/documents', {
        method: 'POST',
        body: form,
      });
    },
    documentUrl: (documentId: string) =>
      `/api/investors/me/documents/${documentId}`,
    removeDocument: (documentId: string) =>
      request<void>(`/investors/me/documents/${documentId}`, {
        method: 'DELETE',
      }),
    addBeneficiary: (input: BeneficiaryInput) =>
      request<InvestorBeneficiary>('/investors/me/beneficiaries', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    removeBeneficiary: (id: string) =>
      request<void>(`/investors/me/beneficiaries/${id}`, { method: 'DELETE' }),
  },

  /** Участие инвестора в кампаниях: выбор, адрес пополнения, зачисление. */
  invest: {
    campaigns: () => request<CampaignCard[]>('/investors/me/campaigns'),
    page: (campaignId: string) =>
      request<CampaignPage>(`/investors/me/campaigns/${campaignId}`),
    history: (campaignId: string, refresh = false) =>
      request<CampaignEvent[]>(
        `/investors/me/campaigns/${campaignId}/history${refresh ? '?refresh=1' : ''}`,
      ),
    claim: (campaignId: string) =>
      request<CampaignPage>(`/investors/me/campaigns/${campaignId}/claim`, {
        method: 'POST',
      }),
    deposit: (campaignId: string) =>
      request<DepositState>(`/investors/me/campaigns/${campaignId}/deposit`),
    open: (campaignId: string) =>
      request<DepositState>(`/investors/me/campaigns/${campaignId}/deposit`, {
        method: 'POST',
      }),
    /** claimed — инвестор сам нажал «Я перевёл», а не сработал опрос экрана. */
    credit: (campaignId: string, claimed = false) =>
      request<DepositState>(
        `/investors/me/campaigns/${campaignId}/deposit/credit`,
        { method: 'POST', body: JSON.stringify({ claimed }) },
      ),
    withdraw: (campaignId: string) =>
      request<DepositState>(
        `/investors/me/campaigns/${campaignId}/deposit/withdraw`,
        { method: 'POST' },
      ),
    /** Публичная карточка заёмщика со всеми его кампаниями. */
    borrower: (borrowerId: string) =>
      request<BorrowerShowcase>(`/investors/me/borrowers/${borrowerId}`),
  },

  /** Облигации и корпоративные действия: сторона платформы. */
  bonds: {
    list: () => request<BondSummary[]>('/bonds'),
    get: (campaignId: string) => request<BondPage>(`/bonds/${campaignId}`),
    /** Опубликованный реестр держателей: по нему проверяется хеш из сети. */
    registerUrl: (campaignId: string, index: number) =>
      `/api/bonds/${campaignId}/register/${index}`,
    /** Тот же список держателей таблицей — как отчёт регистратора. */
    registerCsvUrl: (campaignId: string, index: number) =>
      `/api/bonds/${campaignId}/register/${index}/csv`,
    /**
     * Выписка с удостоверяющими данными держателей. Это персональные данные,
     * поэтому выгрузка отдельным действием и пишется в журнал админа.
     */
    registerFullCsvUrl: (campaignId: string, index: number) =>
      `/api/bonds/${campaignId}/register/${index}/csv?full=1`,
    /** Журнал корпоративных действий выпуска таблицей. */
    journalCsvUrl: (campaignId: string) =>
      `/api/bonds/${campaignId}/journal/csv`,
    /** Уведомление о корпоративном действии в раскладке ISO 15022. */
    noticeUrl: (campaignId: string, index: number) =>
      `/api/bonds/${campaignId}/actions/${index}/notice`,
    issue: (campaignId: string) =>
      request<BondPage>(`/bonds/${campaignId}/issue`, { method: 'POST' }),
    declare: (
      campaignId: string,
      input: {
        kind: ActionKind;
        recordTs: number;
        paymentTs: number;
        amountPerUnit?: string;
      },
    ) =>
      request<BondPage>(`/bonds/${campaignId}/actions`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    snapshot: (campaignId: string, index: number) =>
      request<BondPage>(`/bonds/${campaignId}/actions/${index}/snapshot`, {
        method: 'POST',
      }),
    settle: (campaignId: string, index: number, settlement?: string) =>
      request<BondPage>(`/bonds/${campaignId}/actions/${index}/settle`, {
        method: 'POST',
        body: JSON.stringify({ settlement }),
      }),
    close: (campaignId: string, index: number) =>
      request<BondPage>(`/bonds/${campaignId}/actions/${index}/close`, {
        method: 'POST',
      }),
    redeem: (campaignId: string) =>
      request<BondPage>(`/bonds/${campaignId}/redeem`, { method: 'POST' }),
  },

  /** Бумаги держателя и его голос. */
  myBonds: {
    list: () => request<{ rows: MyBond[]; now: number }>('/investors/me/bonds'),
    vote: (campaignId: string, index: number, choice: 'FOR' | 'AGAINST') =>
      request<{ tally: VoteTally; rows: MyBond[]; now: number }>(
        `/investors/me/bonds/${campaignId}/actions/${index}/vote`,
        { method: 'POST', body: JSON.stringify({ choice }) },
      ),
  },

  /** Дашборд админа: кампании, просрочки, заявки на проверку. */
  admin: {
    dashboard: () => request<AdminDashboard>('/admin/dashboard'),
  },

  /** Портфель инвестора: участия, итоги и вывод средств. */
  portfolio: {
    list: () => request<Portfolio>('/investors/me/portfolio'),
    claim: (campaignId: string) =>
      request<Portfolio>(`/investors/me/portfolio/${campaignId}/claim`, {
        method: 'POST',
      }),
  },

  /** Проверка инвесторов админом. */
  investors: {
    list: (params: { status?: KycStatus; query?: string } = {}) => {
      const search = new URLSearchParams();
      if (params.status) search.set('status', params.status);
      if (params.query) search.set('query', params.query);
      const suffix = search.size > 0 ? `?${search}` : '';
      return request<InvestorList>(`/investors${suffix}`);
    },
    get: (id: string) => request<InvestorCard>(`/investors/${id}`),
    /** Что инвестор держит: участия в кампаниях и бумаги по выпускам. */
    holdings: (id: string) =>
      request<{ portfolio: Portfolio; bonds: { rows: MyBond[]; now: number } }>(
        `/investors/${id}/holdings`,
      ),
    history: (id: string) =>
      request<InvestorEvent[]>(`/investors/${id}/history`),
    documentUrl: (id: string, documentId: string) =>
      `/api/investors/${id}/documents/${documentId}`,
    decide: (
      id: string,
      input: {
        action: DecisionAction;
        clientComment?: string;
        moderationComment?: string;
      },
    ) =>
      request<Investor>(`/investors/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onchain: (id: string) =>
      request<{
        investor: Investor;
        signature: string | null;
        url: string | null;
      }>(`/investors/${id}/onchain`, { method: 'POST' }),
    whitelist: (id: string, enabled: boolean) =>
      request<Investor>(`/investors/${id}/whitelist`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      }),
    confirmAddress: (id: string) =>
      request<Investor>(`/investors/${id}/withdrawal-address`, {
        method: 'POST',
      }),
  },
};
