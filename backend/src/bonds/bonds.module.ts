import { Module } from '@nestjs/common';
import { BondProgramService } from './bond-program.service.js';
import {
  BondsController,
  InvestorBondsController,
} from './bonds.controller.js';
import { BondsService } from './bonds.service.js';

/**
 * Облигации и корпоративные действия. Модуль ни от кого не зависит, а его
 * зовут из публикации кампании, зачисления взноса и возврата — так связь
 * остаётся односторонней и кольца не возникает.
 */
@Module({
  controllers: [InvestorBondsController, BondsController],
  providers: [BondProgramService, BondsService],
  exports: [BondsService, BondProgramService],
})
export class BondsModule {}
