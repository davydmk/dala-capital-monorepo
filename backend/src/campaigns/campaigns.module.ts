import { Module } from '@nestjs/common';
import { BondsModule } from '../bonds/bonds.module.js';
import { InvestorsModule } from '../investors/investors.module.js';
import { CampaignsController } from './campaigns.controller.js';
import { DashboardController } from './dashboard.controller.js';
import { CampaignsService } from './campaigns.service.js';

@Module({
  // InvestorsModule — ради EventsService: закрытие сбора дочитывает историю кампании.
  imports: [InvestorsModule, BondsModule],
  controllers: [DashboardController, CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
