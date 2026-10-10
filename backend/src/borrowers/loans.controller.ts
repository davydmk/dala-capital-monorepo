import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { SessionPayload } from '../auth/auth.service.js';
import { LoansService } from './loans.service.js';

/** Суммы в контракте — u64; в JSON отдаём строками, иначе точность теряется. */
function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  ) as T;
}

/** Сумма приходит строкой: в JSON нет BigInt, а микроединицы терять нельзя. */
class PrepayDto {
  @IsString()
  @Matches(/^[0-9]{1,20}$/, { message: 'Сумма должна быть целым числом' })
  amount!: string;
}

/** Кабинет заёмщика: свои займы, состояние долга и погашение. */
@Controller('borrowers/me')
@Roles(Role.BORROWER)
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @Get('loans')
  async list(@CurrentUser() session: SessionPayload) {
    return serialize(await this.loans.list(session.sub));
  }

  @Get('profile')
  async profile(@CurrentUser() session: SessionPayload) {
    return serialize(await this.loans.profile(session.sub));
  }

  @Get('loans/:id')
  async page(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(await this.loans.page(session.sub, id));
  }

  /** «Я перевёл»: проводит причитающееся обычным ключом. */
  @Post('loans/:id/repay')
  @HttpCode(200)
  async repay(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(await this.loans.repay(session.sub, id));
  }

  /** «Зачесть авансом»: излишек идёт в счёт будущих платежей, подписывает оператор. */
  @Post('loans/:id/advance')
  @HttpCode(200)
  async advance(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(await this.loans.advance(session.sub, id));
  }

  /** Предпросмотр частичного досрочного погашения: сумма к переводу и новый график. */
  @Post('loans/:id/prepay/quote')
  @HttpCode(200)
  async prepayQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrepayDto,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(
      await this.loans.prepayQuote(session.sub, id, BigInt(dto.amount)),
    );
  }

  @Post('loans/:id/prepay/full')
  @HttpCode(200)
  async prepayFull(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(await this.loans.prepayFull(session.sub, id));
  }

  @Post('loans/:id/prepay/partial')
  @HttpCode(200)
  async prepayPartial(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrepayDto,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(
      await this.loans.prepayPartial(session.sub, id, BigInt(dto.amount)),
    );
  }
}
