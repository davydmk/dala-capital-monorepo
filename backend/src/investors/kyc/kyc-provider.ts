import { KycStatus, type Investor } from '@prisma/client';

/**
 * Решение по анкете. Поля повторяют ответ Sumsub, поэтому вебхук ляжет в базу
 * без переходников: у нас те же статусы, тот же признак окончательности отказа
 * и те же комментарии — внутренний и для клиента.
 */
export interface KycReview {
  status: KycStatus;
  answer?: 'GREEN' | 'RED';
  rejectType?: 'RETRY' | 'FINAL';
  rejectLabels: string[];
  /** Для журнала платформы; инвестору не показывается. */
  moderationComment?: string;
  /** Что инвестору исправить. */
  clientComment?: string;
  reviewedAt?: Date;
}

export type InvestorForReview = Pick<Investor, 'id' | 'type' | 'status'>;

/**
 * Кто проверяет инвестора. Сейчас реализация одна — проверка админом;
 * подключение Sumsub сведётся ко второй реализации и вебхуку.
 */
export interface KycProvider {
  readonly name: 'MANUAL' | 'SUMSUB';
  /** Заводит заявку у провайдера. В ручном режиме заводить нечего. */
  createApplicant(
    investor: InvestorForReview,
  ): Promise<{ applicantId: string | null; levelName: string | null }>;
  /** Отправляет анкету на проверку и возвращает её новое состояние. */
  submit(investor: InvestorForReview): Promise<KycReview>;
  /** Текущее решение провайдера. */
  review(investor: InvestorForReview): Promise<KycReview>;
}

/** Уровни проверки: названия совпадают с теми, что настраиваются в Sumsub. */
export const LEVEL_BY_TYPE = {
  INDIVIDUAL: 'basic-kyc-level',
  COMPANY: 'kyb-level',
} as const;

/** Ответ Sumsub: та его часть, из которой складывается решение. */
export interface SumsubReview {
  reviewStatus: string;
  reviewResult?: {
    reviewAnswer?: string;
    reviewRejectType?: string;
    rejectLabels?: string[];
    moderationComment?: string;
    clientComment?: string;
  };
  reviewDate?: string;
}

/**
 * Перевод ответа Sumsub в наш статус. Написано заранее и покрыто тестами:
 * это единственное место, где при подключении сервиса можно ошибиться молча
 * и допустить к деньгам того, кого проверка не пропустила.
 */
export function mapSumsubReview(payload: SumsubReview): KycReview {
  const result = payload.reviewResult ?? {};
  const answer =
    result.reviewAnswer === 'GREEN' || result.reviewAnswer === 'RED'
      ? result.reviewAnswer
      : undefined;
  const rejectType =
    result.reviewRejectType === 'RETRY' || result.reviewRejectType === 'FINAL'
      ? result.reviewRejectType
      : undefined;

  const common: Omit<KycReview, 'status'> = {
    answer,
    rejectType,
    rejectLabels: result.rejectLabels ?? [],
    moderationComment: result.moderationComment,
    clientComment: result.clientComment,
    reviewedAt: payload.reviewDate ? new Date(payload.reviewDate) : undefined,
  };

  switch (payload.reviewStatus) {
    case 'init':
      return { ...common, status: KycStatus.NOT_STARTED };
    case 'pending':
    case 'queued':
    case 'prechecked':
      return { ...common, status: KycStatus.PENDING };
    case 'onHold':
      return { ...common, status: KycStatus.ON_HOLD };
    case 'completed':
      if (answer === 'GREEN') return { ...common, status: KycStatus.APPROVED };
      // Без ответа считаем анкету непринятой: пропускать вперёд опаснее,
      // чем попросить инвестора отправить её ещё раз.
      return {
        ...common,
        status: rejectType === 'FINAL' ? KycStatus.REJECTED : KycStatus.RETRY,
      };
    default:
      return { ...common, status: KycStatus.PENDING };
  }
}
