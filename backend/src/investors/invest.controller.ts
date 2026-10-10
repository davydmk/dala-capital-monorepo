import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsBoolean, IsOptional } from 'class-validator';
import { Roles } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { SessionPayload } from '../auth/auth.service.js';
import { InvestService } from './invest.service.js';

class CreditDto {
  /// true — инвестор сам нажал «Я перевёл», а не сработал опрос экрана.
  @IsOptional() @IsBoolean() claimed?: boolean;
}

/** Суммы в контракте — u64; в JSON отдаём строками, иначе точность теряется. */
function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  ) as T;
}

/** Участие инвестора в кампаниях: выбор, адрес пополнения, зачисление. */
@Controller('investors/me')
@Roles(Role.INVESTOR)
export class InvestController {
  constructor(private readonly invest: InvestService) {}

  /** Публичная карточка заёмщика со всеми его кампаниями. */
  @Get('borrowers/:id')
  async borrower(@Param('id', ParseUUIDPipe) id: string) {
    return serialize(await this.invest.borrower(id));
  }

  @Get('campaigns')
  async campaigns(@CurrentUser() session: SessionPayload) {
    return serialize(await this.invest.campaigns(session.sub));
  }

  @Get('campaigns/:id')
  async page(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(await this.invest.page(session.sub, id));
  }

  /** История операций; refresh=1 сначала дочитывает новое из сети. */
  @Get('campaigns/:id/history')
  async history(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('refresh') refresh?: string,
  ) {
    return serialize(await this.invest.history(id, refresh === '1'));
  }

  @Post('campaigns/:id/claim')
  @HttpCode(200)
  async claim(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(await this.invest.claim(session.sub, id));
  }

  @Get('campaigns/:id/deposit')
  async state(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(await this.invest.state(session.sub, id));
  }

  @Post('campaigns/:id/deposit')
  @HttpCode(200)
  async open(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(await this.invest.open(session.sub, id));
  }

  @Post('campaigns/:id/deposit/credit')
  @HttpCode(200)
  async credit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreditDto,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(
      await this.invest.credit(session.sub, id, dto.claimed ?? false),
    );
  }

  @Post('campaigns/:id/deposit/withdraw')
  @HttpCode(200)
  async withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(await this.invest.withdraw(session.sub, id));
  }
}
