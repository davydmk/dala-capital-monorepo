import { KycStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { mapSumsubReview } from './kyc-provider.js';

describe('перевод ответа Sumsub в статус анкеты', () => {
  it('пропускает только зелёный ответ', () => {
    const review = mapSumsubReview({
      reviewStatus: 'completed',
      reviewResult: { reviewAnswer: 'GREEN' },
    });
    expect(review.status).toBe(KycStatus.APPROVED);
    expect(review.answer).toBe('GREEN');
  });

  it('различает отказ с доработкой и окончательный', () => {
    expect(
      mapSumsubReview({
        reviewStatus: 'completed',
        reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'RETRY' },
      }).status,
    ).toBe(KycStatus.RETRY);

    expect(
      mapSumsubReview({
        reviewStatus: 'completed',
        reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'FINAL' },
      }).status,
    ).toBe(KycStatus.REJECTED);
  });

  it('завершённую проверку без ответа не считает пройденной', () => {
    expect(mapSumsubReview({ reviewStatus: 'completed' }).status).toBe(
      KycStatus.RETRY,
    );
  });

  it('все промежуточные состояния держит в ожидании', () => {
    for (const reviewStatus of ['pending', 'queued', 'prechecked']) {
      expect(mapSumsubReview({ reviewStatus }).status).toBe(KycStatus.PENDING);
    }
    expect(mapSumsubReview({ reviewStatus: 'onHold' }).status).toBe(
      KycStatus.ON_HOLD,
    );
    expect(mapSumsubReview({ reviewStatus: 'init' }).status).toBe(
      KycStatus.NOT_STARTED,
    );
  });

  it('неизвестный статус не пропускает вперёд', () => {
    expect(mapSumsubReview({ reviewStatus: 'что-то новое' }).status).toBe(
      KycStatus.PENDING,
    );
  });

  it('переносит причины отказа и комментарии', () => {
    const review = mapSumsubReview({
      reviewStatus: 'completed',
      reviewDate: '2026-09-22T10:00:00.000Z',
      reviewResult: {
        reviewAnswer: 'RED',
        reviewRejectType: 'RETRY',
        rejectLabels: ['UNSATISFACTORY_PHOTOS'],
        moderationComment: 'плохое качество снимка',
        clientComment: 'Переснимите документ',
      },
    });
    expect(review.rejectLabels).toEqual(['UNSATISFACTORY_PHOTOS']);
    expect(review.clientComment).toBe('Переснимите документ');
    expect(review.reviewedAt?.toISOString()).toBe('2026-09-22T10:00:00.000Z');
  });
});
