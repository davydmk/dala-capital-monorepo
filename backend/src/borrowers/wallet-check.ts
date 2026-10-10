import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Классическая токен-программа и Token-2022: их счета кошельком быть не могут. */
const TOKEN_PROGRAMS = [
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
];

export type WalletCheck =
  | { ok: true }
  | { ok: false; reason: string }
  | { ok: 'unknown'; reason: string };

/**
 * Проверяет, что адрес — обычный кошелёк, а не токен-счёт.
 * Контракт отвергнет токен-счёт при создании кампании, но узнать об этом лучше сразу:
 * на карточке видно, куда уйдут деньги займа.
 */
@Injectable()
export class WalletCheckService {
  private readonly logger = new Logger(WalletCheckService.name);
  private readonly rpcUrl: string;

  constructor(config: ConfigService) {
    this.rpcUrl =
      config.get<string>('SOLANA_RPC_URL') ?? 'https://api.devnet.solana.com';
  }

  async check(address: string): Promise<WalletCheck> {
    let owner: string | undefined;
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccountInfo',
          params: [address, { encoding: 'base64', commitment: 'confirmed' }],
        }),
        signal: AbortSignal.timeout(5_000),
      });
      const body = (await response.json()) as {
        result?: { value?: { owner?: string } | null };
      };
      owner = body.result?.value?.owner;
    } catch (error) {
      // Сеть недоступна — не мешаем сохранить карточку, но и не обещаем, что адрес верный.
      this.logger.warn(
        `Проверка адреса ${address} не удалась: ${String(error)}`,
      );
      return { ok: 'unknown', reason: 'Проверить адрес в сети не удалось' };
    }

    if (owner && TOKEN_PROGRAMS.includes(owner)) {
      return {
        ok: false,
        reason:
          'Это токен-счёт, а не кошелёк. Укажите адрес кошелька: контракт создаст токен-счёт сам',
      };
    }
    // Пустого аккаунта достаточно: кошелёк может ещё не иметь операций.
    return { ok: true };
  }
}
