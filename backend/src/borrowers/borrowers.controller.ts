import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { BorrowersService, type UploadedFile } from './borrowers.service.js';
import {
  CreateBorrowerDto,
  CreateInviteDto,
  CreateWalletDto,
  ListBorrowersDto,
  UpdateBorrowerDto,
  UpdatePhotoDto,
  UpdateWalletDto,
  UploadDocumentDto,
  UploadPhotoDto,
} from './dto.js';
import { MAX_DOCUMENT_BYTES, MAX_PHOTO_BYTES } from './storage.js';

/** BigInt не сериализуется в JSON, поэтому выручку отдаём числом. */
function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' ? Number(item) : item,
    ),
  ) as T;
}

@Controller('borrowers')
@Roles(Role.ADMIN)
export class BorrowersController {
  constructor(private readonly borrowers: BorrowersService) {}

  @Get()
  async list(@Query() filter: ListBorrowersDto) {
    return serialize(await this.borrowers.list(filter));
  }

  @Post()
  async create(@Body() dto: CreateBorrowerDto) {
    return serialize(await this.borrowers.create(dto));
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return serialize(await this.borrowers.get(id));
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBorrowerDto,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(await this.borrowers.update(id, dto, session.sub));
  }

  @Get(':id/history')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.borrowers.history(id);
  }

  /** Возвращает ссылку целиком: админу её нужно просто скопировать и отправить. */
  @Post(':id/invite')
  async invite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInviteDto,
    @CurrentUser() session: SessionPayload,
  ) {
    const invite = await this.borrowers.createInvite(id, dto, session.sub);
    return { ...invite, path: `/invite/${invite.token}` };
  }

  @Delete(':id/invite')
  @HttpCode(204)
  async revokeInvite(@Param('id', ParseUUIDPipe) id: string) {
    await this.borrowers.revokeInvite(id);
  }

  // ── Кошельки ─────────────────────────────────────────────────────────────

  @Post(':id/wallets')
  addWallet(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateWalletDto,
    @CurrentUser() session: SessionPayload,
  ) {
    return this.borrowers.addWallet(id, dto, session.sub);
  }

  @Patch(':id/wallets/:walletId')
  updateWallet(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Body() dto: UpdateWalletDto,
    @CurrentUser() session: SessionPayload,
  ) {
    return this.borrowers.updateWallet(id, walletId, dto, session.sub);
  }

  @Delete(':id/wallets/:walletId')
  @HttpCode(204)
  async removeWallet(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @CurrentUser() session: SessionPayload,
  ) {
    await this.borrowers.removeWallet(id, walletId, session.sub);
  }

  // ── Фотографии предприятия ───────────────────────────────────────────────

  @Post(':id/photos')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES + 1 } }),
  )
  addPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFileParam() file: UploadedFile,
    @Body() dto: UploadPhotoDto,
  ) {
    return this.borrowers.addPhoto(id, file, dto.caption);
  }

  @Patch(':id/photos/:photoId')
  updatePhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Body() dto: UpdatePhotoDto,
  ) {
    return this.borrowers.updatePhoto(id, photoId, dto);
  }

  /** Картинки открыты любому вошедшему: они понадобятся инвестору на витрине. */
  @Get(':id/photos/:photoId')
  @Roles(Role.ADMIN, Role.BORROWER, Role.INVESTOR)
  async photo(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Res() response: Response,
  ) {
    const { photo, content } = await this.borrowers.readPhoto(id, photoId);
    response.setHeader('Content-Type', photo.mimeType);
    response.send(content);
  }

  @Delete(':id/photos/:photoId')
  @HttpCode(204)
  async removePhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ) {
    await this.borrowers.removePhoto(id, photoId);
  }

  @Get(':id/logo')
  @Roles(Role.ADMIN, Role.BORROWER, Role.INVESTOR)
  async logo(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ) {
    const { content, mimeType } = await this.borrowers.readLogo(id);
    response.setHeader('Content-Type', mimeType);
    response.send(content);
  }

  // ── Файлы ────────────────────────────────────────────────────────────────

  @Post(':id/documents')
  // limits здесь — грубая отсечка, точные ограничения проверяет сервис с понятным текстом.
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES + 1 } }),
  )
  addDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFileParam() file: UploadedFile,
    @Body() dto: UploadDocumentDto,
  ) {
    return this.borrowers.addDocument(id, file, dto.kind);
  }

  @Get(':id/documents/:documentId')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res() response: Response,
  ) {
    const { document, content } = await this.borrowers.readDocument(
      id,
      documentId,
    );
    response.setHeader('Content-Type', document.mimeType);
    // filename* с кодировкой: имена файлов бывают на русском.
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    );
    response.send(content);
  }

  @Delete(':id/documents/:documentId')
  @HttpCode(204)
  async removeDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    await this.borrowers.removeDocument(id, documentId);
  }

  @Post(':id/logo')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES + 1 } }),
  )
  async setLogo(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFileParam() file: UploadedFile,
  ) {
    return serialize(await this.borrowers.setLogo(id, file));
  }
}
