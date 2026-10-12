import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { Roles } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { SessionPayload } from '../auth/auth.service.js';
import { SolanaService } from '../solana/solana.service.js';
import { DecisionDto, ListInvestorsDto, WhitelistDto } from './dto.js';
import { InvestorsService } from './investors.service.js';
import { PortfolioService } from './portfolio.service.js';
import { BondsService } from '../bonds/bonds.service.js';
import { checkInvestor } from './validation.js';

/** Суммы в контракте — u64; в JSON отдаём строками, иначе точность теряется. */
function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  ) as T;
}

/** Проверка анкеты админом. */
@Controller('investors')
@Roles(Role.ADMIN)
export class InvestorsController {
  constructor(
    private readonly investors: InvestorsService,
    private readonly solana: SolanaService,
    private readonly portfolio: PortfolioService,
    private readonly bonds: BondsService,
  ) {}

  @Get()
  list(@Query() filter: ListInvestorsDto) {
    return this.investors.list(filter);
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const investor = await this.investors.byId(id);
    return {
      investor,
      checks: checkInvestor(investor),
      accountUrl: investor.onchainAccount
        ? this.solana.explorerAddress(investor.onchainAccount)
        : null,
    };
  }

  /**
   * Что инвестор держит: участия в кампаниях и бумаги по выпускам. Считается
   * тем же кодом, что и его собственный кабинет, — у админа просто другой
   * вход. Без этого карточка инвестора рассказывает только про анкету.
   */
  @Get(':id/holdings')
  async holdings(@Param('id', ParseUUIDPipe) id: string) {
    const userId = await this.investors.userIdOf(id);
    const [portfolio, bonds] = await Promise.all([
      this.portfolio.list(userId),
      this.bonds.myBonds(userId),
    ]);
    return serialize({ portfolio, bonds });
  }

  @Get(':id/history')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.investors.history(id);
  }

  @Get(':id/documents/:documentId')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res() response: Response,
  ) {
    const { document, content } = await this.investors.readDocument(
      id,
      documentId,
    );
    response.setHeader('Content-Type', document.mimeType);
    response.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    );
    response.send(content);
  }

  @Post(':id/decision')
  @HttpCode(200)
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionDto,
    @CurrentUser() session: SessionPayload,
  ) {
    return this.investors.decide(id, dto, session.sub);
  }

  /** Создаёт аккаунт в контракте и открывает допуск; повторный вызов безопасен. */
  @Post(':id/onchain')
  @HttpCode(200)
  async onchain(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionPayload,
  ) {
    const result = await this.investors.syncOnchain(id, session.sub);
    return {
      ...result,
      url: result.signature
        ? this.solana.explorerTx(result.signature)
        : result.account
          ? this.solana.explorerAddress(result.account.address)
          : null,
    };
  }

  @Post(':id/whitelist')
  @HttpCode(200)
  setWhitelist(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WhitelistDto,
    @CurrentUser() session: SessionPayload,
  ) {
    return this.investors.setWhitelist(id, dto.enabled, session.sub);
  }

  @Post(':id/withdrawal-address')
  @HttpCode(200)
  confirmAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionPayload,
  ) {
    return this.investors.confirmWithdrawalAddress(id, session.sub);
  }
}
