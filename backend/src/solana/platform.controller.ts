import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { CampaignState, Role } from '@prisma/client';
import { IsString, Length } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { Roles } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { SessionPayload } from '../auth/auth.service.js';
import { SolanaService } from './solana.service.js';

class MintDto {
  @IsString() @Length(32, 44) mint!: string;
}

/** Ниже этого остатка ключ скоро перестанет подписывать операции. */
const LOW_SOL = 0.05;

/**
 * Ключи названы по тому, что они делают на рынке ценных бумаг: реестр ведёт
 * регистратор, платит платёжный агент, размещает выпуск эмиссионный агент —
 * это разные лица, и у нас разделение такое же. Техническое имя ключа
 * остаётся рядом: по нему сверяются с контрактом.
 */
const ROLE_TITLE: Record<string, string> = {
  whitelist: 'Регистратор',
  admin: 'Эмиссионный агент',
  operator: 'Платёжный агент',
  treasury: 'Казна',
};

/**
 * Каким ключом уходит каждое действие журнала. Словарь живёт здесь, рядом с
 * ролями: подписант задан инструкцией контракта, и угадывать его во фронте
 * значило бы держать вторую версию правды.
 *
 * `setWithdrawalAddress` подписывает admin, а не whitelist authority — так
 * устроен контракт, и в журнале стоит та роль, что подписала на самом деле.
 */
const ACTION_ROLE: Record<string, string> = {
  createUser: 'whitelist',
  setWhitelist: 'whitelist',
  allowMint: 'admin',
  removeMint: 'admin',
  publishCampaign: 'admin',
  cancelCampaign: 'admin',
  markDefault: 'admin',
  recordRecoveryCost: 'admin',
  setWithdrawalAddress: 'admin',
  closeFunding: 'operator',
  recoveryPayment: 'operator',
};

/** Настройки платформы в контракте: роли, казна, токены, балансы ключей. */
@Controller('platform')
@Roles(Role.ADMIN)
export class PlatformController {
  constructor(
    private readonly solana: SolanaService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async state() {
    const platform = await this.solana.platform();

    // Балансы читаем параллельно: четыре запроса в сеть подряд заметно медленнее.
    const [roles, tokens] = await Promise.all([
      Promise.all(
        (
          [
            [
              'whitelist',
              platform.whitelistAuthority,
              'Ведёт реестр держателей и допуск к выводам',
            ],
            [
              'admin',
              platform.admin,
              'Размещает выпуск и объявляет корпоративные действия',
            ],
            ['operator', platform.operator, 'Проводит расчёты и зачисления'],
            [
              'treasury',
              platform.treasury,
              'Принимает комиссии; SOL ему не нужен',
            ],
          ] as const
        ).map(async ([key, address, purpose]) => {
          const sol = await this.solana.solBalance(address).catch(() => null);
          return {
            key,
            /** Название роли; `key` рядом — чтобы сверить с контрактом. */
            title: ROLE_TITLE[key] ?? key,
            address,
            purpose,
            sol,
            // Казне SOL не нужен: она только принимает токены.
            low: key !== 'treasury' && sol !== null && sol < LOW_SOL,
            url: this.solana.explorerAddress(address),
          };
        }),
      ),
      Promise.all(
        platform.allowedMints.map(async (mint) => {
          const info = await this.solana.tokenInfo(mint).catch(() => null);
          const balance = await this.solana
            .treasuryBalance(platform.treasury, mint)
            .catch(() => null);
          const campaigns = await this.prisma.campaign.count({
            where: { mint },
          });
          return {
            address: mint,
            decimals: info?.decimals ?? null,
            isToken2022: info?.isToken2022 ?? false,
            hasExtensions: info?.hasExtensions ?? false,
            treasuryAmount: balance?.amount ?? null,
            campaigns,
            url: this.solana.explorerAddress(mint),
          };
        }),
      ),
    ]);

    return {
      cluster: this.solana.cluster,
      programId: this.solana.programAddress,
      programUrl: this.solana.explorerAddress(this.solana.programAddress),
      campaignCount: platform.campaignCount.toString(),
      defaultMint: this.solana.defaultMintAddress,
      roles,
      tokens,
    };
  }

  /** Проверка адреса до разрешения: что это токен и сколько у него знаков. */
  @Get('token')
  async token(@Query('mint') mint: string) {
    if (!mint) throw new BadRequestException('Укажите адрес токена');
    try {
      return await this.solana.tokenInfo(mint);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Не удалось прочитать токен',
      );
    }
  }

  @Post('tokens')
  @HttpCode(200)
  async allowMint(
    @Body() dto: MintDto,
    @CurrentUser() session: SessionPayload,
  ) {
    // Проверяем до отправки: транзакция стоит SOL, а ошибка контракта необъяснима.
    await this.token(dto.mint);
    const signature = await this.solana.allowMint(dto.mint);
    await this.log(session.sub, 'allowMint', dto.mint, signature);
    return { signature, url: this.solana.explorerTx(signature) };
  }

  @Delete('tokens')
  @HttpCode(200)
  async removeMint(
    @Body() dto: MintDto,
    @CurrentUser() session: SessionPayload,
  ) {
    // Контракт сверяет список разрешённых только при создании кампании:
    // действующие займы после удаления продолжают платить и закрываться как
    // платили. Мешает одно — идущий сбор: инвесторы в него ещё переводят
    // деньги, и остаться без токена в списке посреди сбора неприятно.
    const published = await this.prisma.campaign.findMany({
      where: {
        mint: dto.mint,
        state: CampaignState.PUBLISHED,
        onchainId: { not: null },
      },
      select: { onchainId: true },
    });
    const deals = await this.solana.deals(
      published.map((campaign) => BigInt(campaign.onchainId!)),
    );
    const now = Math.floor(Date.now() / 1000);
    const funding = [...deals.values()].filter(
      // Открытый сбор — тот, у которого ещё не прошёл дедлайн: после него
      // взносы контракт всё равно не примет, даже если оператор не закрыл его.
      (deal) => deal.state === 'funding' && now < deal.fundingDeadline,
    ).length;
    if (funding > 0) {
      throw new BadRequestException(
        `В этом токене идёт сбор (${funding}). Дождитесь дедлайна: инвесторы ещё переводят деньги`,
      );
    }
    const signature = await this.solana.removeMint(dto.mint);
    await this.log(session.sub, 'removeMint', dto.mint, signature);
    return { signature, url: this.solana.explorerTx(signature) };
  }

  @Get('log')
  async log_(@Query('limit') limit?: string) {
    const entries = await this.prisma.adminAction.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit ?? 50), 200),
      include: { actor: { select: { email: true } } },
    });
    // Кто нажал — в `actor`, чем подписано — в `role`. Это разные вещи:
    // сотрудник один, а ключи у операций разные.
    return entries.map((entry) => ({
      ...entry,
      role: ACTION_ROLE[entry.action] ?? null,
      roleTitle: ROLE_TITLE[ACTION_ROLE[entry.action] ?? ''] ?? null,
    }));
  }

  private log(
    actorId: string,
    action: string,
    target: string,
    signature?: string,
  ) {
    return this.prisma.adminAction.create({
      data: { actorId, action, target, signature },
    });
  }
}
