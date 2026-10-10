import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Role, VoteChoice } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { Roles } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { SessionPayload } from '../auth/auth.service.js';
import { BondsService } from './bonds.service.js';
import type { ActionKind } from './bond-program.service.js';

/** Суммы в контракте — u64; в JSON отдаём строками, иначе точность теряется. */
function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  ) as T;
}

const KINDS = [
  'record',
  'coupon',
  'redemption',
  'vote',
  'default',
  'recovery',
] as const;

class DeclareDto {
  @IsString()
  @IsEnum(KINDS, { message: 'Неизвестный вид действия' })
  kind!: ActionKind;

  /** Дата фиксации и дата исполнения в unix-секундах. */
  @IsInt() @Min(0) recordTs!: number;
  @IsInt() @Min(0) paymentTs!: number;

  /** Сумма на бумагу; для купона и погашения считается из условий выпуска. */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{1,20}$/, { message: 'Сумма должна быть целым числом' })
  amountPerUnit?: string;
}

class SettleDto {
  /** Подпись расчётной транзакции из `dala_capital`. */
  @IsOptional() @IsString() settlement?: string;
}

class VoteDto {
  @IsEnum(VoteChoice) choice!: VoteChoice;
}

/** Облигации и корпоративные действия: сторона платформы. */
@Controller('bonds')
@Roles(Role.ADMIN)
export class BondsController {
  constructor(private readonly bonds: BondsService) {}

  @Get()
  async list() {
    return serialize(await this.bonds.list());
  }

  @Get(':campaignId')
  async bond(@Param('campaignId', ParseUUIDPipe) campaignId: string) {
    return serialize(await this.bonds.bond(campaignId));
  }

  /** Опубликованный реестр держателей: по нему любой пересчитает хеш. */
  @Get(':campaignId/register/:index')
  async register(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    return serialize(await this.bonds.register(campaignId, index));
  }

  /** Выпуск бумаги вручную — на случай, если при публикации он не прошёл. */
  @Post(':campaignId/issue')
  @HttpCode(200)
  async issue(@Param('campaignId', ParseUUIDPipe) campaignId: string) {
    const signature = await this.bonds.issueForCampaign(campaignId);
    return serialize({ signature, ...(await this.bonds.bond(campaignId)) });
  }

  @Post(':campaignId/actions')
  @HttpCode(200)
  async declare(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() dto: DeclareDto,
  ) {
    const result = await this.bonds.declare(
      campaignId,
      dto.kind,
      dto.recordTs,
      dto.paymentTs,
      dto.amountPerUnit ? BigInt(dto.amountPerUnit) : undefined,
    );
    return serialize({ ...result, ...(await this.bonds.bond(campaignId)) });
  }

  /** Снимает реестр на дату фиксации и отправляет его хеш в сеть. */
  @Post(':campaignId/actions/:index/snapshot')
  @HttpCode(200)
  async snapshot(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    // Итог снимка кладём отдельным полем: у выпуска есть свой `holders`,
    // и слить их в один объект значило бы потерять одно из двух.
    const snapshot = await this.bonds.snapshot(campaignId, index);
    return serialize({ snapshot, ...(await this.bonds.bond(campaignId)) });
  }

  @Post(':campaignId/actions/:index/settle')
  @HttpCode(200)
  async settle(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: SettleDto,
  ) {
    const result = await this.bonds.settle(campaignId, index, dto.settlement);
    return serialize({ ...result, ...(await this.bonds.bond(campaignId)) });
  }

  @Post(':campaignId/actions/:index/close')
  @HttpCode(200)
  async close(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    await this.bonds.close(campaignId, index);
    return serialize(await this.bonds.bond(campaignId));
  }

  /** Гасит бумаги всех держателей: заём закрыт, бумага больше не нужна. */
  @Post(':campaignId/redeem')
  @HttpCode(200)
  async redeem(@Param('campaignId', ParseUUIDPipe) campaignId: string) {
    const burned = await this.bonds.redeemAll(campaignId);
    return serialize({ burned, ...(await this.bonds.bond(campaignId)) });
  }
}

/** Бумаги инвестора и его голос. */
@Controller('investors/me/bonds')
@Roles(Role.INVESTOR)
export class InvestorBondsController {
  constructor(private readonly bonds: BondsService) {}

  @Get()
  async mine(@CurrentUser() session: SessionPayload) {
    return serialize(await this.bonds.myBonds(session.sub));
  }

  @Post(':campaignId/actions/:index/vote')
  @HttpCode(200)
  async vote(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: VoteDto,
    @CurrentUser() session: SessionPayload,
  ) {
    const tally = await this.bonds.vote(
      session.sub,
      campaignId,
      index,
      dto.choice,
    );
    return serialize({ tally, ...(await this.bonds.myBonds(session.sub)) });
  }
}
