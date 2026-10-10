import { Module } from '@nestjs/common';
import { BondsModule } from '../bonds/bonds.module.js';
import { StorageService } from '../borrowers/storage.js';
import { WalletCheckService } from '../borrowers/wallet-check.js';
import { CountriesController } from './countries.controller.js';
import { EventsService } from './events.service.js';
import { InvestController } from './invest.controller.js';
import { InvestService } from './invest.service.js';
import { InvestorsController } from './investors.controller.js';
import { InvestorsService } from './investors.service.js';
import { ManualKycProvider } from './kyc/manual.provider.js';
import { InvestorMeController } from './me.controller.js';
import { PortfolioController } from './portfolio.controller.js';
import { PortfolioService } from './portfolio.service.js';

@Module({
  // BondsModule — ради выпуска бумаг в момент взноса.
  imports: [BondsModule],
  // Порядок важен: иначе /investors/me попадёт в обработчик /investors/:id.
  controllers: [
    CountriesController,
    InvestController,
    PortfolioController,
    InvestorMeController,
    InvestorsController,
  ],
  providers: [
    InvestorsService,
    InvestService,
    PortfolioService,
    EventsService,
    StorageService,
    WalletCheckService,
    ManualKycProvider,
  ],
  exports: [InvestorsService, EventsService, PortfolioService],
})
export class InvestorsModule {}
