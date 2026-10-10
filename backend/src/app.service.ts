import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  health(): { status: 'ok'; time: string } {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
