import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/auth.guard.js';
import { AuthService } from '../auth/auth.service.js';
import { setSessionCookie } from '../auth/session-cookie.js';
import { BorrowersService } from './borrowers.service.js';
import { AcceptInviteDto } from './dto.js';

/**
 * Приглашение в кабинет заёмщика. Маршруты открыты: человек ещё не вошёл.
 * Защита — в самом токене: 32 случайных байта, срок неделя, одноразовый.
 */
@Controller('invite')
export class InvitesController {
  constructor(
    private readonly borrowers: BorrowersService,
    private readonly auth: AuthService,
  ) {}

  @Public()
  @Get(':token')
  read(@Param('token') token: string) {
    return this.borrowers.readInvite(token);
  }

  @Public()
  @Post(':token')
  @HttpCode(200)
  async accept(
    @Param('token') token: string,
    @Body() dto: AcceptInviteDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.borrowers.acceptInvite(token, dto.password);
    // Сразу пускаем в кабинет: повторно вводить пароль незачем.
    await setSessionCookie(response, user, this.auth);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    };
  }
}
