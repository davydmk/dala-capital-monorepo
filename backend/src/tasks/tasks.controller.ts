import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { SessionPayload } from '../auth/auth.service.js';
import { TasksService, type Task } from './tasks.service.js';

/**
 * Что требует внимания у того, кто спрашивает. Роль берётся из сессии, а не
 * из параметра: список задач — это и есть права, чужой отдавать нельзя.
 */
@Controller('tasks')
@Roles(Role.ADMIN, Role.INVESTOR, Role.BORROWER)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@CurrentUser() session: SessionPayload): Promise<Task[]> {
    return this.tasks.list(session.sub, session.role);
  }
}
