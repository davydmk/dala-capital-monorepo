import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { BorrowerStatus, CreditRating, DocumentKind } from '@prisma/client';
import { isValidBin, isValidSolanaAddress } from './validation.js';

@ValidatorConstraint({ name: 'bin' })
class BinConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && isValidBin(value);
  }
  defaultMessage() {
    return 'БИН — 12 цифр; проверьте контрольную цифру, скорее всего опечатка';
  }
}

@ValidatorConstraint({ name: 'solanaAddress' })
class SolanaAddressConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && isValidSolanaAddress(value);
  }
  defaultMessage() {
    return 'Некорректный адрес Solana';
  }
}

/** Поля карточки, которые можно задать и при создании, и при правке. */
class BorrowerFields {
  @IsOptional() @IsString() @Length(2, 200) name?: string;
  @IsOptional() @IsString() @Length(0, 2000) description?: string;
  @IsOptional() @IsString() @Length(0, 200) industry?: string;
  @IsOptional() @IsString() @Length(0, 300) address?: string;
  @IsOptional() @IsString() @Length(0, 200) website?: string;
  @IsOptional() @IsISO8601() foundedAt?: string;
  /// Выручка в целых долларах: на карточке центы не нужны.
  @IsOptional() @IsInt() @Min(0) annualRevenueUsd?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) employees?: number;
  @IsOptional() @IsString() @Length(0, 200) contactName?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsString() @Length(0, 50) contactPhone?: string;
  @IsOptional() @IsEnum(CreditRating) rating?: CreditRating;
  @IsOptional() @IsString() @Length(0, 2000) riskNote?: string;
}

export class CreateBorrowerDto extends BorrowerFields {
  @IsString() @Length(2, 200) declare name: string;

  @Validate(BinConstraint) bin!: string;
}

export class UpdateBorrowerDto extends BorrowerFields {
  /// БИН меняется редко, но опечатку в нём исправить нужно.
  @IsOptional() @Validate(BinConstraint) bin?: string;

  @IsOptional() @IsEnum(BorrowerStatus) status?: BorrowerStatus;
}

export class ListBorrowersDto {
  /// Поиск по названию и БИН.
  @IsOptional() @IsString() @Length(0, 200) query?: string;

  @IsOptional() @IsEnum(BorrowerStatus) status?: BorrowerStatus;

  /// По умолчанию архивные скрыты. В строке запроса значение приходит текстом.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeArchived?: boolean;
}

export class CreateInviteDto {
  @IsEmail({}, { message: 'Некорректная почта' }) email!: string;
}

export class AcceptInviteDto {
  @IsString()
  @Length(10, 128, { message: 'Пароль от 10 до 128 символов' })
  password!: string;
}

export class CreateWalletDto {
  @IsString() @Length(1, 100) label!: string;

  @Validate(SolanaAddressConstraint) address!: string;

  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateWalletDto {
  @IsOptional() @IsString() @Length(1, 100) label?: string;

  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UploadPhotoDto {
  @IsOptional() @IsString() @Length(0, 200) caption?: string;
}

export class UpdatePhotoDto {
  @IsOptional() @IsString() @Length(0, 200) caption?: string;

  @IsOptional() @IsInt() @Min(0) @Max(100) sortOrder?: number;
}

export class UploadDocumentDto {
  @IsOptional() @IsEnum(DocumentKind) kind?: DocumentKind;
}
