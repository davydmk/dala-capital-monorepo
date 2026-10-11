import { Controller, Get } from '@nestjs/common';
import { CampaignState, KycStatus, Role } from '@prisma/client';
import { Roles } from '../auth/auth.guard.js';
import {
  amountDue,
  daysPastDue,
  defaultDebt,
  recoveryOutstanding,
} from '../borrowers/debt.js';
import { campaignStatus, overdueNow } from '../investors/campaign-status.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SolanaService } from '../solana/solana.service.js';

/** Суммы в контракте — u64; в JSON отдаём строками, иначе точность теряется. */
function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  ) as T;
}

/** Окно, за которое считается собранное: в секундах, как время в сделке. */
const DAYS_30 = 30 * 24 * 60 * 60;

/**
 * Дашборд админа. Состояние кампаний живёт в контракте, поэтому считается из
 * сети — но одним запросом на все кампании, а не по одному на каждую.
 */
@Controller('admin')
@Roles(Role.ADMIN)
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly solana: SolanaService,
  ) {}

  @Get('dashboard')
  async dashboard() {
    const [campaigns, pendingKyc] = await Promise.all([
      this.prisma.campaign.findMany({
        where: { state: CampaignState.PUBLISHED, onchainId: { not: null } },
        select: {
          id: true,
          title: true,
          onchainId: true,
          mintDecimals: true,
          defaultThresholdDays: true,
          borrower: { select: { id: true, name: true } },
        },
      }),
      this.prisma.investor.count({ where: { status: KycStatus.PENDING } }),
    ]);

    const deals = await this.solana.deals(
      campaigns.map((campaign) => BigInt(campaign.onchainId!)),
    );
    const now = Math.floor(Date.now() / 1000);
    // Момент закрытия сбора теперь лежит в самой сделке. Раньше его брали из
    // журнала платформы — то есть считали по её же записям о себе.
    const since = now - DAYS_30;

    let funding = 0;
    let raised = 0n;
    const overdue = [];

    for (const campaign of campaigns) {
      const deal = deals.get(String(campaign.onchainId));
      if (!deal) continue;

      const status = campaignStatus({
        dealState: deal.state,
        fundingDeadline: deal.fundingDeadline,
        overduePrincipal: overdueNow(deal, now),
        now,
      });
      if (status === 'FUNDING') funding += 1;
      if (deal.fundingClosedTs >= since) raised += deal.totalRaised;

      if (status === 'OVERDUE' || status === 'DEFAULT') {
        overdue.push({
          id: campaign.id,
          title: campaign.title,
          borrower: campaign.borrower,
          status,
          mintDecimals: campaign.mintDecimals,
          daysPastDue: daysPastDue(deal, now),
          defaultThresholdDays: campaign.defaultThresholdDays,
          // В дефолте долг лежит в других полях, и расходы на взыскание
          // заёмщик тоже обязан возместить.
          due:
            deal.state === 'default'
              ? defaultDebt(deal, now).total + recoveryOutstanding(deal)
              : amountDue(deal, now).total,
        });
      }
    }

    overdue.sort((a, b) => b.daysPastDue - a.daysPastDue);
    return serialize({
      funding,
      /** Собрано по сборам, закрытым за последние 30 дней. */
      raised,
      overdueCount: overdue.length,
      pendingKyc,
      overdue,
    });
  }
}
