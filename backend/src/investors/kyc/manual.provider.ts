import { Injectable } from '@nestjs/common';
import { KycStatus } from '@prisma/client';
import type {
  InvestorForReview,
  KycProvider,
  KycReview,
} from './kyc-provider.js';

/**
 * Проверка админом платформы. Заявка просто встаёт в очередь, решение выносит
 * человек через админку — оно пишется в те же поля, что потом запишет вебхук
 * внешнего сервиса.
 */
@Injectable()
export class ManualKycProvider implements KycProvider {
  readonly name = 'MANUAL' as const;

  createApplicant() {
    // Заявка живёт у нас: заводить её на стороне провайдера нечего.
    return Promise.resolve({ applicantId: null, levelName: null });
  }

  submit(): Promise<KycReview> {
    return Promise.resolve({ status: KycStatus.PENDING, rejectLabels: [] });
  }

  review(investor: InvestorForReview): Promise<KycReview> {
    return Promise.resolve({ status: investor.status, rejectLabels: [] });
  }
}
