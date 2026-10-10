import {
  IsEmail,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Некорректная почта' })
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Введите пароль' })
  password!: string;
}

export class RegisterDto {
  @IsEmail({}, { message: 'Некорректная почта' })
  email!: string;

  /** 10 символов — нижняя граница для пароля без второго фактора. */
  @IsString()
  @Length(10, 128, { message: 'Пароль от 10 до 128 символов' })
  password!: string;

  @IsString()
  @Length(2, 120, { message: 'Имя от 2 до 120 символов' })
  @MaxLength(120)
  name!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'Введите текущий пароль' })
  currentPassword!: string;

  @IsString()
  @Length(10, 128, { message: 'Пароль от 10 до 128 символов' })
  newPassword!: string;
}

export class UpdateProfileDto {
  @IsString()
  @Length(2, 120, { message: 'Имя от 2 до 120 символов' })
  name!: string;
}
