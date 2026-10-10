import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { SessionPayload } from '../auth/auth.service.js';
import { PortfolioService } from './portfolio.service.js';

/** Суммы в контракте — u64; в JSON отдаём строками, иначе точность теряется. */
function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  ) as T;
}

/** Портфель инвестора: участия, итоги и вывод средств. */
@Controller('investors/me/portfolio')
@Roles(Role.INVESTOR)
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get()
  async list(@CurrentUser() session: SessionPayload) {
    return serialize(await this.portfolio.list(session.sub));
  }

  @Post(':id/claim')
  @HttpCode(200)
  async claim(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(await this.portfolio.claim(session.sub, id));
  }
}
