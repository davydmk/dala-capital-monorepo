import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { CampaignState, ScheduleKind, ScheduleStep } from '@prisma/client';
import { MAX_PERIODS } from './validation.js';

export { ALLOWED_PERIODS_PER_YEAR, MAX_PERIODS } from './validation.js';

export class CreateCampaignDto {
  @IsUUID() borrowerId!: string;

  @IsString() @Length(2, 200) title!: string;
}

/** Правка черновика: все поля необязательны, мастер сохраняет шаг за шагом. */
export class UpdateCampaignDto {
  @IsOptional() @IsUUID() borrowerId?: string;
  @IsOptional() @IsUUID() walletId?: string;
  @IsOptional() @IsString() @Length(2, 200) title?: string;
  @IsOptional() @IsString() @Length(0, 2000) purpose?: string;
  @IsOptional() @IsString() @Length(0, 2000) collateral?: string;
  @IsOptional() @IsString() @Length(32, 44) mint?: string;
  @IsOptional() @IsInt() @Min(0) @Max(18) mintDecimals?: number;

  @IsOptional() @IsEnum(ScheduleKind) scheduleKind?: ScheduleKind;
  @IsOptional() @IsEnum(ScheduleStep) scheduleStep?: ScheduleStep;

  /// Суммы приходят строкой: в JSON нет BigInt, а центы терять нельзя.
  @IsOptional() @IsString() softCap?: string;
  @IsOptional() @IsString() hardCap?: string;
  @IsOptional() @IsString() minTicket?: string;
  /// Номинал бумаги у облигации; у кредита не используется.
  @IsOptional() @IsString() bondFaceValue?: string;
  /// Как бумага подпишется в кошельке и обозревателе. В метаданные минта
  /// влезает 32 символа названия — больше токен-программа не примет.
  @IsOptional() @IsString() @Length(1, 32) bondName?: string;
  @IsOptional() @IsString() @Length(1, 10) bondSymbol?: string;
  /// Идентификатор по ISO 6166: двенадцать знаков с контрольной цифрой.
  @IsOptional() @IsString() @Length(12, 12) bondIsin?: string;
  @IsOptional() @IsString() @Length(0, 200) bondUri?: string;
  @IsOptional() @IsString() maxTicket?: string;

  @IsOptional() @IsISO8601() fundingStart?: string;
  @IsOptional() @IsISO8601() fundingDeadline?: string;
  @IsOptional() @IsISO8601() firstDueAt?: string;

  @IsOptional() @IsInt() @Min(1) @Max(9_999) annualRateBps?: number;
  @IsOptional() @IsInt() periodsPerYear?: number;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_PERIODS) periodCount?: number;
  @IsOptional() @IsInt() @Min(0) @Max(9_999) penaltyRateBps?: number;
  @IsOptional() @IsInt() @Min(1) @Max(3_650) defaultThresholdDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(9_999) prepaymentFeeBps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(9_999) platformFeeBps?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) cancelGraceDays?: number;

  @IsOptional() @IsInt() @Min(1) @Max(5) step?: number;
}

export class ListCampaignsDto {
  @IsOptional() @IsEnum(CampaignState) state?: CampaignState;

  @IsOptional() @IsUUID() borrowerId?: string;
}

/** Предпросмотр можно запросить и для несохранённых значений. */
export class PreviewDto extends UpdateCampaignDto {
  @IsOptional() @Type(() => Number) @IsInt() decimals?: number;
}

/** Смена кошелька получения: адрес берём из списка заёмщика, а не из поля ввода. */
export class SetWalletDto {
  @IsUUID() walletId!: string;
}

/** Сумма приходит строкой: в JSON нет BigInt, а микроединицы терять нельзя. */
export class AmountDto {
  @IsString()
  @Matches(/^[0-9]{1,20}$/, { message: 'Сумма должна быть целым числом' })
  amount!: string;
}
