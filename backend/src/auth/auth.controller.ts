import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  AuthService,
  type PublicUser,
  type SessionPayload,
} from './auth.service.js';
import { Public, SESSION_COOKIE } from './auth.guard.js';
import { clearSessionCookie, sessionCookieOptions } from './session-cookie.js';
import { CurrentUser } from './current-user.decorator.js';
import {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  UpdateProfileDto,
} from './dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Регистрация открыта только инвесторам; статус — «на проверке» до KYC. */
  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<PublicUser> {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicUser> {
    const { token, user } = await this.auth.login(dto.email, dto.password);
    response.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    return user;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) response: Response): void {
    clearSessionCookie(response);
  }

  /** Кто я. Фронт зовёт при загрузке, чтобы понять, куда вести пользователя. */
  @Get('me')
  me(@CurrentUser() session: SessionPayload): Promise<PublicUser> {
    return this.auth.currentUser(session.sub);
  }

  /** Меняется только имя: почта — это логин, и подтвердить её смену нечем. */
  @Patch('me')
  rename(
    @Body() dto: UpdateProfileDto,
    @CurrentUser() session: SessionPayload,
  ): Promise<PublicUser> {
    return this.auth.rename(session.sub, dto.name);
  }

  /**
   * Смена пароля. Открытые сеансы на других устройствах при этом не закрываются:
   * сессия живёт в подписанной куке, отзывать её пока нечем.
   */
  @Post('password')
  @HttpCode(204)
  password(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() session: SessionPayload,
  ): Promise<void> {
    return this.auth.changePassword(
      session.sub,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
