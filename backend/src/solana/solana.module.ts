import { Global, Module } from '@nestjs/common';
import { PlatformController } from './platform.controller.js';
import { SolanaService } from './solana.service.js';

@Global()
@Module({
  controllers: [PlatformController],
  providers: [SolanaService],
  exports: [SolanaService],
})
export class SolanaModule {}
