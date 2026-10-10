import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/auth.guard.js';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** Проверка живости: используется мониторингом и docker healthcheck. */
  @Public()
  @Get('health')
  health() {
    return this.appService.health();
  }
}
