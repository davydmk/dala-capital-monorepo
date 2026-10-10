import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { Roles } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { SessionPayload } from '../auth/auth.service.js';
import type { UploadedFile } from '../borrowers/borrowers.service.js';
import { MAX_DOCUMENT_BYTES } from '../borrowers/storage.js';
import {
  BeneficiaryDto,
  UpdateInvestorDto,
  UploadInvestorDocumentDto,
  WithdrawalAddressDto,
} from './dto.js';
import { SolanaService } from '../solana/solana.service.js';
import { InvestorsService } from './investors.service.js';
import { checkInvestor } from './validation.js';

type InvestorRecord = Awaited<ReturnType<InvestorsService['me']>>;

/**
 * Своя анкета инвестора. Проверку статуса ACTIVE здесь не ставим: анкету
 * заполняет как раз тот, кто ещё не допущен.
 */
@Controller('investors/me')
@Roles(Role.INVESTOR)
export class InvestorMeController {
  constructor(
    private readonly investors: InvestorsService,
    private readonly solana: SolanaService,
  ) {}

  /** Анкета без внутренних полей платформы: их инвестору видеть незачем. */
  private forInvestor(investor: InvestorRecord) {
    const { moderationComment: _hidden, ...rest } = investor;
    return {
      investor: rest,
      checks: checkInvestor(investor),
      // Ссылку собираем здесь: фронту не нужно знать, какая сейчас сеть.
      accountUrl: investor.onchainAccount
        ? this.solana.explorerAddress(investor.onchainAccount)
        : null,
    };
  }

  @Get()
  async me(@CurrentUser() session: SessionPayload) {
    return this.forInvestor(await this.investors.me(session.sub));
  }

  @Put()
  async update(
    @Body() dto: UpdateInvestorDto,
    @CurrentUser() session: SessionPayload,
  ) {
    return this.forInvestor(await this.investors.updateMe(session.sub, dto));
  }

  @Post('submit')
  @HttpCode(200)
  async submit(@CurrentUser() session: SessionPayload) {
    return this.forInvestor(await this.investors.submit(session.sub));
  }

  @Post('withdrawal-address')
  @HttpCode(200)
  async requestAddress(
    @Body() dto: WithdrawalAddressDto,
    @CurrentUser() session: SessionPayload,
  ) {
    return this.forInvestor(
      await this.investors.requestWithdrawalAddress(session.sub, dto.address),
    );
  }

  // ── Документы ────────────────────────────────────────────────────────────

  @Post('documents')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES + 1 } }),
  )
  async addDocument(
    @UploadedFileParam() file: UploadedFile,
    @Body() dto: UploadInvestorDocumentDto,
    @CurrentUser() session: SessionPayload,
  ) {
    const investor = await this.investors.me(session.sub);
    return this.investors.addDocument(investor.id, file, dto.kind);
  }

  @Get('documents/:documentId')
  async download(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() session: SessionPayload,
    @Res() response: Response,
  ) {
    const investor = await this.investors.me(session.sub);
    const { document, content } = await this.investors.readDocument(
      investor.id,
      documentId,
    );
    response.setHeader('Content-Type', document.mimeType);
    response.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    );
    response.send(content);
  }

  @Delete('documents/:documentId')
  @HttpCode(204)
  async removeDocument(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() session: SessionPayload,
  ) {
    const investor = await this.investors.me(session.sub);
    await this.investors.removeDocument(investor.id, documentId);
  }

  // ── Бенефициары ──────────────────────────────────────────────────────────

  @Post('beneficiaries')
  async addBeneficiary(
    @Body() dto: BeneficiaryDto,
    @CurrentUser() session: SessionPayload,
  ) {
    const investor = await this.investors.me(session.sub);
    return this.investors.addBeneficiary(investor.id, dto);
  }

  @Delete('beneficiaries/:beneficiaryId')
  @HttpCode(204)
  async removeBeneficiary(
    @Param('beneficiaryId', ParseUUIDPipe) beneficiaryId: string,
    @CurrentUser() session: SessionPayload,
  ) {
    const investor = await this.investors.me(session.sub);
    await this.investors.removeBeneficiary(investor.id, beneficiaryId);
  }
}
