import {
  IdDocType,
  InvestorDocumentKind,
  InvestorType,
  KycStatus,
  SourceOfFunds,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { isValidSolanaAddress } from '../borrowers/validation.js';
import { isKnownCountry } from './countries.js';

/**
 * Анкета сохраняется по шагам, поэтому пустое значение — обычное дело:
 * это «ещё не заполнено», а не ошибка. Значение очищает поле в базе.
 */
const isEmpty = (value: unknown) =>
  value === '' || value === null || value === undefined;

@ValidatorConstraint({ name: 'country' })
class CountryConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return (
      isEmpty(value) || (typeof value === 'string' && isKnownCountry(value))
    );
  }
  defaultMessage() {
    return 'Выберите страну из списка';
  }
}

@ValidatorConstraint({ name: 'isoDate' })
class DateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return (
      isEmpty(value) ||
      (typeof value === 'string' && !Number.isNaN(Date.parse(value)))
    );
  }
  defaultMessage() {
    return 'Некорректная дата';
  }
}

@ValidatorConstraint({ name: 'solanaAddress' })
class SolanaAddressConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return (
      isEmpty(value) ||
      (typeof value === 'string' && isValidSolanaAddress(value))
    );
  }
  defaultMessage() {
    return 'Некорректный адрес Solana';
  }
}

/**
 * Анкета сохраняется по шагам, поэтому обязательных полей здесь нет: пустая
 * анкета — это черновик. Полноту проверяет checkInvestor перед отправкой.
 */
export class UpdateInvestorDto {
  @IsOptional() @IsEnum(InvestorType) type?: InvestorType;

  /// Докуда дошёл мастер.
  @IsOptional() @IsInt() @Min(1) @Max(5) step?: number;

  // Личные данные; для компании это данные подписанта.
  @IsOptional() @IsString() @Length(0, 100) firstName?: string;
  @IsOptional() @IsString() @Length(0, 100) lastName?: string;
  @IsOptional() @IsString() @Length(0, 100) middleName?: string;
  @IsOptional() @Validate(DateConstraint) dob?: string;
  @IsOptional() @IsString() @Length(0, 200) placeOfBirth?: string;
  @IsOptional() @Validate(CountryConstraint) countryOfBirth?: string;
  @IsOptional() @Validate(CountryConstraint) nationality?: string;
  @IsOptional() @Validate(CountryConstraint) country?: string;
  @IsOptional() @IsString() @Length(0, 300) addressLine?: string;
  @IsOptional() @IsString() @Length(0, 100) city?: string;
  @IsOptional() @IsString() @Length(0, 20) postCode?: string;
  @IsOptional() @IsString() @Length(0, 50) phone?: string;
  @IsOptional() @IsString() @Length(0, 100) position?: string;

  @IsOptional() @IsEnum(IdDocType) idDocType?: IdDocType;
  @IsOptional() @IsString() @Length(0, 50) idDocNumber?: string;
  @IsOptional() @Validate(CountryConstraint) idDocCountry?: string;
  @IsOptional() @Validate(DateConstraint) idDocValidUntil?: string;

  // Компания.
  @IsOptional() @IsString() @Length(0, 200) companyName?: string;
  @IsOptional() @IsString() @Length(0, 50) registrationNumber?: string;
  @IsOptional() @Validate(DateConstraint) incorporatedOn?: string;
  @IsOptional() @Validate(CountryConstraint) companyCountry?: string;
  @IsOptional() @IsString() @Length(0, 300) legalAddress?: string;
  @IsOptional() @IsString() @Length(0, 200) website?: string;

  // Декларации.
  @IsOptional() @IsEnum(SourceOfFunds) sourceOfFunds?: SourceOfFunds;
  @IsOptional() @IsString() @Length(0, 1000) sourceOfFundsNote?: string;
  @IsOptional() @IsBoolean() isPep?: boolean;
  @IsOptional() @IsString() @Length(0, 1000) pepDetails?: string;
  @IsOptional() @IsBoolean() acceptTerms?: boolean;
  @IsOptional() @IsBoolean() acceptRisk?: boolean;

  /// Адрес вывода задаётся здесь только до одобрения; потом — через заявку.
  @IsOptional() @Validate(SolanaAddressConstraint) withdrawalAddress?: string;
}

export class BeneficiaryDto {
  @IsString() @Length(2, 200) fullName!: string;

  /// Длина отсекает пустое значение: у бенефициара страна обязательна.
  @IsString() @Length(3, 3) @Validate(CountryConstraint) country!: string;

  /// Доля в сотых долях процента: 2500 — это 25%.
  @IsInt() @Min(1) @Max(10_000) shareBps!: number;

  @IsOptional() @IsString() @Length(0, 100) position?: string;

  @IsOptional() @IsBoolean() isPep?: boolean;
}

export class UploadInvestorDocumentDto {
  @IsOptional() @IsEnum(InvestorDocumentKind) kind?: InvestorDocumentKind;
}

export class WithdrawalAddressDto {
  @IsString()
  @Length(32, 44)
  @Validate(SolanaAddressConstraint)
  address!: string;
}

/** Решение админа по анкете. */
export class DecisionDto {
  @IsIn(['approve', 'retry', 'reject', 'hold'], {
    message: 'Возможные действия: approve, retry, reject, hold',
  })
  action!: 'approve' | 'retry' | 'reject' | 'hold';

  /// Что инвестору исправить; при отказе и доработке обязателен.
  @IsOptional() @IsString() @Length(0, 2000) clientComment?: string;

  /// Заметка для платформы: что проверяли и на чём основано решение.
  @IsOptional() @IsString() @Length(0, 2000) moderationComment?: string;
}

export class ListInvestorsDto {
  @IsOptional() @IsEnum(KycStatus) status?: KycStatus;

  /// Поиск по почте, имени и названию компании.
  @IsOptional() @IsString() @Length(0, 200) query?: string;
}

export class WhitelistDto {
  @IsBoolean() enabled!: boolean;
}
