import { Injectable, NotFoundException } from '@nestjs/common';
import { KycStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SolanaService } from '../solana/solana.service.js';
import { uuidToBytes } from '../solana/user-id.js';
import { campaignStatus, overdueNow, statusGroup } from './campaign-status.js';
import { InvestService } from './invest.service.js';
import { pendingPayout, shareBps } from './payout.js';
import {
  nextPaymentShare,
  portfolioTotals,
  withdrawnSoFar,
} from './portfolio.js';

/** Позиция без взносов и без движений: в портфеле её показывать незачем. */
const EMPTY = (invested: bigint, received: bigint, available: bigint) =>
  invested === 0n && received === 0n && available === 0n;

/**
 * Портфель инвестора: все его участия одним экраном и вывод по каждому.
 *
 * Список строим по адресам пополнения — кампаниям, где инвестор открывал
 * адрес. Это и есть «мои участия», и перебирать всю витрину не нужно.
 */
@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly solana: SolanaService,
    private readonly invest: InvestService,
  ) {}

  async list(userId: string) {
    const investor = await this.prisma.investor.findUnique({
      where: { userId },
    });
    if (!investor) {
      return { rows: [], totals: empty(), participationBlock: BLOCK.kyc };
    }

    const deposits = await this.prisma.campaignDeposit.findMany({
      where: { investorId: investor.id },
      include: {
        campaign: {
          select: {
            id: true,
            title: true,
            onchainId: true,
            mintDecimals: true,
            annualRateBps: true,
            scheduleKind: true,
            borrower: { select: { id: true, name: true, logoKey: true } },
          },
        },
        credits: { select: { amount: true } },
      },
      orderBy: { openedAt: 'desc' },
    });

    const published = deposits.filter((item) => item.campaign.onchainId);
    const ids = published.map((item) => BigInt(item.campaign.onchainId!));

    // Два обращения в сеть на весь портфель, а не два на каждое участие.
    const [deals, positions] = await Promise.all([
      this.solana.deals(ids),
      this.solana.positions(ids, uuidToBytes(investor.userId)),
    ]);

    const now = Math.floor(Date.now() / 1000);
    const rows = published
      .map((deposit) => {
        const key = String(deposit.campaign.onchainId);
        const deal = deals.get(key);
        if (!deal) return null;

        const position = positions.get(key);
        const principal = position?.principal ?? 0n;
        const credited = deposit.credits.reduce(
          (sum, credit) => sum + credit.amount,
          0n,
        );
        // Взнос берём из своих зачислений: возврат обнуляет позицию в
        // контракте, и без этого участие исчезло бы из портфеля.
        const invested = credited > principal ? credited : principal;

        const failed = deal.state === 'failed';
        const payout = position
          ? pendingPayout(position, deal)
          : {
              principal: 0n,
              interest: 0n,
              penalty: 0n,
              prepaymentFee: 0n,
              total: 0n,
            };
        const withdrawn = position
          ? withdrawnSoFar(position)
          : {
              principal: 0n,
              interest: 0n,
              penalty: 0n,
              prepaymentFee: 0n,
              total: 0n,
            };

        // У несостоявшегося сбора забирают взнос, а не выплату: чекпоинты
        // возврат не двигает, поэтому возвращённое считаем от вложенного.
        const available = failed ? principal : payout.total;
        const received = failed ? invested - principal : withdrawn.total;

        if (EMPTY(invested, received, available)) return null;

        const status = campaignStatus({
          dealState: deal.state,
          fundingDeadline: deal.fundingDeadline,
          overduePrincipal: overdueNow(deal, now),
          now,
        });

        return {
          id: deposit.campaign.id,
          title: deposit.campaign.title,
          borrower: deposit.campaign.borrower,
          status,
          mintDecimals: deposit.campaign.mintDecimals,
          annualRateBps: deposit.campaign.annualRateBps,
          scheduleKind: deposit.campaign.scheduleKind,
          invested,
          received,
          available,
          /** Доля в кампании: у возвращённого взноса её уже нет. */
          shareBps: shareBps(principal, deal.totalRaised),
          /** Что именно забирают: выплату или взнос несостоявшегося сбора. */
          refund: failed,
          payout,
          next: nextPaymentShare(deal, principal, now),
          fundingDeadline: deal.fundingDeadline,
          lastDueTs: deal.lastDueTs,
          finished: statusGroup(status) === 'finished',
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    return {
      rows,
      totals: portfolioTotals(rows),
      /** Пусто, когда забирать можно; иначе — почему пока нельзя. */
      participationBlock: block(investor),
      /** Часы платформы: время на странице считается по ним, а не по браузеру. */
      now,
    };
  }

  /** Забирает причитающееся по одному участию и возвращает портфель заново. */
  async claim(userId: string, campaignId: string) {
    const deposit = await this.prisma.campaignDeposit.findFirst({
      where: { campaignId, investor: { userId } },
      select: { id: true },
    });
    if (!deposit) throw new NotFoundException('Участия в кампании нет');

    await this.invest.claimToWallet(userId, campaignId);
    return this.list(userId);
  }
}

const BLOCK = {
  kyc: 'Забрать деньги можно после того, как проверка личности пройдена',
  account: 'Ваш аккаунт в контракте ещё создаётся. Загляните чуть позже',
  address: 'В анкете не указан адрес для вывода',
};

/** Почему инвестору пока нельзя забирать. Пусто — значит можно. */
function block(investor: {
  status: KycStatus;
  onchainAccount: string | null;
  withdrawalAddress: string | null;
}): string | null {
  if (investor.status !== KycStatus.APPROVED) return BLOCK.kyc;
  if (!investor.onchainAccount) return BLOCK.account;
  if (!investor.withdrawalAddress) return BLOCK.address;
  return null;
}

const empty = () => ({
  invested: 0n,
  received: 0n,
  available: 0n,
  activeCount: 0,
});
