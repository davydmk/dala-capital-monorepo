import { Module } from '@nestjs/common';
import { BondsModule } from '../bonds/bonds.module.js';
import { InvestorsModule } from '../investors/investors.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

/**
 * Задачи по ролям. Модуль берёт готовые расчёты у других — портфель у
 * инвесторов, действия у облигаций, — и ничего не хранит сам: состояние
 * займов живёт в контракте, своя копия тут же начала бы с ним расходиться.
 */
@Module({
  imports: [InvestorsModule, BondsModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
