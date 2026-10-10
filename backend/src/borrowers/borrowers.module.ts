import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InvestorsModule } from '../investors/investors.module.js';
import { BorrowersController } from './borrowers.controller.js';
import { InvitesController } from './invites.controller.js';
import { LoansController } from './loans.controller.js';
import { BorrowersService } from './borrowers.service.js';
import { LoansService } from './loans.service.js';
import { StorageService } from './storage.js';
import { WalletCheckService } from './wallet-check.js';

@Module({
  // AuthModule — ради AuthService: приём приглашения сразу ставит куку сессии.
  // InvestorsModule — ради EventsService: погашение дочитывает историю кампании.
  imports: [AuthModule, InvestorsModule],
  // LoansController идёт первым: иначе /borrowers/me попадёт в /borrowers/:id.
  controllers: [LoansController, BorrowersController, InvitesController],
  providers: [
    BorrowersService,
    LoansService,
    StorageService,
    WalletCheckService,
  ],
  exports: [BorrowersService],
})
export class BorrowersModule {}
