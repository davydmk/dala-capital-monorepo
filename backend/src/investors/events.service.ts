import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SolanaService } from '../solana/solana.service.js';

/**
 * История кампании из блокчейна. События контракта лежат во внутренних
 * инструкциях, и на публичном RPC каждая транзакция — отдельный запрос:
 * читать всю историю при каждом открытии страницы слишком долго. Поэтому
 * читаем один раз и складываем к себе, а потом дочитываем только новое.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly solana: SolanaService,
  ) {}

  /**
   * События по кампании, от новых к старым. Их число растёт с каждым взносом,
   * поэтому отдаём последние: всю историю целиком видно в обозревателе.
   */
  list(campaignId: string, take = 20) {
    return this.prisma.campaignEvent.findMany({
      where: { campaignId },
      orderBy: [{ slot: 'desc' }, { index: 'desc' }],
      take,
    });
  }

  /**
   * Дочитывает то, чего у нас ещё нет, и возвращает число новых записей.
   * Отправной точкой служит последняя известная подпись: `getSignaturesForAddress`
   * с ней вернёт только транзакции, случившиеся позже.
   */
  async sync(campaignId: string, onchainId: bigint): Promise<number> {
    const newest = await this.prisma.campaignEvent.findFirst({
      where: { campaignId },
      orderBy: [{ slot: 'desc' }, { index: 'desc' }],
      select: { signature: true },
    });

    const events = await this.solana
      .campaignEvents(onchainId, newest?.signature)
      .catch((error: unknown) => {
        // Сеть могла не ответить — показываем то, что уже собрано.
        this.logger.warn(`История кампании ${campaignId}: ${String(error)}`);
        return [];
      });
    if (events.length === 0) return 0;

    const { count } = await this.prisma.campaignEvent.createMany({
      data: events.map((event) => ({
        campaignId,
        signature: event.signature,
        slot: BigInt(event.slot),
        blockTime: event.blockTime ? new Date(event.blockTime * 1000) : null,
        index: event.index,
        name: event.name,
        payload: event.payload as Prisma.InputJsonValue,
      })),
      // Одна и та же транзакция может прийти дважды: пропускаем, а не падаем.
      skipDuplicates: true,
    });
    return count;
  }
}
