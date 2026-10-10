import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { BondsModule } from './bonds/bonds.module.js';
import { BorrowersModule } from './borrowers/borrowers.module.js';
import { CampaignsModule } from './campaigns/campaigns.module.js';
import { InvestorsModule } from './investors/investors.module.js';
import { SolanaModule } from './solana/solana.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SolanaModule,
    AuthModule,
    BondsModule,
    BorrowersModule,
    CampaignsModule,
    InvestorsModule,
    TasksModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
