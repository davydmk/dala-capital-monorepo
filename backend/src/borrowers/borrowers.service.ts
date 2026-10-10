import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import {
  BorrowerStatus,
  DocumentKind,
  Prisma,
  Role,
  UserStatus,
  type Borrower,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateBorrowerDto,
  CreateInviteDto,
  CreateWalletDto,
  ListBorrowersDto,
  UpdateBorrowerDto,
  UpdatePhotoDto,
  UpdateWalletDto,
} from './dto.js';
import {
  DOCUMENT_MIME_TYPES,
  IMAGE_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_LOGO_BYTES,
  MAX_PHOTO_BYTES,
  StorageService,
} from './storage.js';
import { WalletCheckService } from './wallet-check.js';

/** Поля, изменения которых попадают в журнал. Остальные реквизиты — шум. */
const TRACKED_FIELDS = ['status', 'rating', 'userId'] as const;

/** Ссылка-приглашение живёт неделю: этого хватает, чтобы передать её и открыть. */
const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** Больше восьми снимков карусель превращает в свалку. */
const MAX_PHOTOS = 8;

/** В базе храним только хеш токена: по нему нельзя восстановить ссылку. */
const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Без этих полей кампанию по заёмщику не собрать. */
const REQUIRED_FOR_APPROVAL = ['name', 'bin'] as const;

/**
 * multer отдаёт имя файла в latin1, поэтому кириллица приходит искажённой.
 * Возвращаем её обратно в UTF-8.
 */
function decodeFileName(name: string): string {
  return Buffer.from(name, 'latin1').toString('utf8').slice(0, 200);
}

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class BorrowersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly walletCheck: WalletCheckService,
  ) {}

  // ── Карточка ─────────────────────────────────────────────────────────────

  async list(filter: ListBorrowersDto) {
    const where: Prisma.BorrowerWhereInput = {};
    if (filter.status) {
      where.status = filter.status;
    } else if (!filter.includeArchived) {
      where.status = { not: BorrowerStatus.ARCHIVED };
    }
    if (filter.query) {
      const query = filter.query.trim();
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { bin: { contains: query } },
      ];
    }

    return this.prisma.borrower.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        wallets: { orderBy: { createdAt: 'asc' } },
        _count: { select: { documents: true, photos: true } },
      },
    });
  }

  async get(id: string) {
    const borrower = await this.prisma.borrower.findUnique({
      where: { id },
      include: {
        documents: { orderBy: { uploadedAt: 'desc' } },
        wallets: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
        photos: { orderBy: { sortOrder: 'asc' } },
        user: { select: { id: true, email: true, status: true } },
        // Действующее приглашение: сама ссылка не восстанавливается, но видно,
        // что доступ уже выдан и до какого числа он действует.
        invites: {
          where: { usedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, email: true, expiresAt: true, createdAt: true },
        },
      },
    });
    if (!borrower) throw new NotFoundException('Заёмщик не найден');
    return borrower;
  }

  async create(dto: CreateBorrowerDto) {
    await this.assertBinIsFree(dto.bin);

    const borrower = await this.prisma.borrower.create({
      data: { ...this.toData(dto), name: dto.name, bin: dto.bin },
    });
    return { borrower };
  }

  async update(id: string, dto: UpdateBorrowerDto, actorUserId: string) {
    const current = await this.prisma.borrower.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Заёмщик не найден');
    if (dto.bin && dto.bin !== current.bin) await this.assertBinIsFree(dto.bin);

    const next = { ...current, ...this.toData(dto) } as Borrower;
    if (dto.status === BorrowerStatus.APPROVED)
      await this.assertReadyForApproval(next);

    const borrower = await this.prisma.borrower.update({
      where: { id },
      data: { ...this.toData(dto), ...(dto.bin ? { bin: dto.bin } : {}) },
    });
    await this.recordChanges(current, borrower, actorUserId);
    return { borrower };
  }

  // ── Кошельки ─────────────────────────────────────────────────────────────

  /**
   * Кошельков может быть несколько: по разным кампаниям заёмщик может получать
   * деньги на разные адреса. В мастере кампании подставляется помеченный по умолчанию.
   */
  async addWallet(id: string, dto: CreateWalletDto, actorUserId: string) {
    await this.get(id);
    const address = dto.address.trim();

    const check = await this.walletCheck.check(address);
    if (check.ok === false) throw new BadRequestException(check.reason);

    const existing = await this.prisma.borrowerWallet.findFirst({
      where: { borrowerId: id, address },
    });
    if (existing)
      throw new ConflictException('Такой адрес у заёмщика уже есть');

    const count = await this.prisma.borrowerWallet.count({
      where: { borrowerId: id },
    });
    // Первый адрес автоматически становится основным.
    const isDefault = dto.isDefault ?? count === 0;
    if (isDefault) await this.clearDefaultWallet(id);

    const wallet = await this.prisma.borrowerWallet.create({
      data: { borrowerId: id, label: dto.label.trim(), address, isDefault },
    });
    await this.logEvent(
      id,
      actorUserId,
      'wallet',
      null,
      `${wallet.label}: ${address}`,
    );
    return { wallet, check };
  }

  async updateWallet(
    id: string,
    walletId: string,
    dto: UpdateWalletDto,
    actorUserId: string,
  ) {
    const wallet = await this.prisma.borrowerWallet.findFirst({
      where: { id: walletId, borrowerId: id },
    });
    if (!wallet) throw new NotFoundException('Кошелёк не найден');

    // Прежний основной запоминаем до сброса: в журнал нужен именно он.
    const previousDefault = dto.isDefault
      ? await this.prisma.borrowerWallet.findFirst({
          where: { borrowerId: id, isDefault: true },
        })
      : null;

    if (dto.isDefault) await this.clearDefaultWallet(id);
    const updated = await this.prisma.borrowerWallet.update({
      where: { id: walletId },
      data: {
        ...(dto.label ? { label: dto.label.trim() } : {}),
        ...(dto.isDefault === undefined ? {} : { isDefault: dto.isDefault }),
      },
    });
    if (dto.isDefault && !wallet.isDefault) {
      await this.logEvent(
        id,
        actorUserId,
        'defaultWallet',
        previousDefault?.address ?? null,
        updated.address,
      );
    }
    return updated;
  }

  async removeWallet(id: string, walletId: string, actorUserId: string) {
    const borrower = await this.prisma.borrower.findUnique({
      where: { id },
      include: { wallets: true },
    });
    if (!borrower) throw new NotFoundException('Заёмщик не найден');

    const wallet = borrower.wallets.find((item) => item.id === walletId);
    if (!wallet) throw new NotFoundException('Кошелёк не найден');
    // Допущенный заёмщик без адреса не сможет получить заём.
    if (
      borrower.wallets.length === 1 &&
      borrower.status === BorrowerStatus.APPROVED
    ) {
      throw new BadRequestException(
        'Это последний кошелёк допущенного заёмщика: без адреса кампанию не собрать',
      );
    }

    await this.prisma.borrowerWallet.delete({ where: { id: walletId } });
    await this.logEvent(
      id,
      actorUserId,
      'wallet',
      `${wallet.label}: ${wallet.address}`,
      null,
    );

    // Основной удалили — назначаем следующий, чтобы мастер кампании не остался без адреса.
    if (wallet.isDefault) {
      const next = await this.prisma.borrowerWallet.findFirst({
        where: { borrowerId: id },
        orderBy: { createdAt: 'asc' },
      });
      if (next) {
        await this.prisma.borrowerWallet.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }
  }

  private async clearDefaultWallet(borrowerId: string) {
    await this.prisma.borrowerWallet.updateMany({
      where: { borrowerId, isDefault: true },
      data: { isDefault: false },
    });
  }

  history(id: string) {
    return this.prisma.borrowerEvent.findMany({
      where: { borrowerId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ── Приглашение в кабинет ────────────────────────────────────────────────

  /**
   * Выдаёт одноразовую ссылку: пароль задаёт сам заёмщик.
   * В базе лежит только хеш токена, поэтому утечка базы не даёт войти,
   * а платформа пароля не знает.
   */
  async createInvite(id: string, dto: CreateInviteDto, actorUserId: string) {
    const borrower = await this.prisma.borrower.findUnique({ where: { id } });
    if (!borrower) throw new NotFoundException('Заёмщик не найден');
    if (borrower.userId) throw new ConflictException('Кабинет уже создан');

    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('Пользователь с такой почтой уже есть');
    }

    // Прошлое приглашение отзываем: действующей остаётся одна ссылка.
    await this.prisma.borrowerInvite.deleteMany({
      where: { borrowerId: id, usedAt: null },
    });

    const token = randomBytes(32).toString('base64url');
    const invite = await this.prisma.borrowerInvite.create({
      data: {
        borrowerId: id,
        email,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_LIFETIME_MS),
        createdBy: actorUserId,
      },
    });

    return { token, email, expiresAt: invite.expiresAt };
  }

  /** Отзывает действующее приглашение: ссылка перестаёт работать сразу. */
  async revokeInvite(id: string) {
    const { count } = await this.prisma.borrowerInvite.deleteMany({
      where: { borrowerId: id, usedAt: null },
    });
    if (count === 0)
      throw new NotFoundException('Действующего приглашения нет');
  }

  /** Данные для экрана приглашения: без входа, поэтому отдаём только название и почту. */
  async readInvite(token: string) {
    const invite = await this.prisma.borrowerInvite.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { borrower: { select: { name: true } } },
    });
    if (!invite || invite.usedAt) {
      throw new NotFoundException(
        'Ссылка недействительна или уже использована',
      );
    }
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException(
        'Срок действия ссылки истёк, попросите новую',
      );
    }
    return { company: invite.borrower.name, email: invite.email };
  }

  /** Заёмщик задаёт пароль и получает кабинет. Возвращает пользователя для входа. */
  async acceptInvite(token: string, password: string) {
    const tokenHash = hashToken(token);
    const invite = await this.prisma.borrowerInvite.findUnique({
      where: { tokenHash },
      include: { borrower: true },
    });
    if (!invite || invite.usedAt) {
      throw new NotFoundException(
        'Ссылка недействительна или уже использована',
      );
    }
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException(
        'Срок действия ссылки истёк, попросите новую',
      );
    }
    if (invite.borrower.userId)
      throw new ConflictException('Кабинет уже создан');

    const passwordHash = await hash(password);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: invite.email,
          name: invite.borrower.name,
          passwordHash,
          role: Role.BORROWER,
          // Заёмщика привёл админ, отдельная проверка ему не нужна.
          status: UserStatus.ACTIVE,
        },
      });
      await tx.borrower.update({
        where: { id: invite.borrowerId },
        data: { userId: created.id },
      });
      // Отметка «использовано» в той же транзакции: ссылка срабатывает один раз.
      await tx.borrowerInvite.update({
        where: { tokenHash },
        data: { usedAt: new Date() },
      });
      return created;
    });

    await this.logEvent(
      invite.borrowerId,
      invite.createdBy,
      'userId',
      null,
      user.id,
    );
    return user;
  }

  // ── Фотографии предприятия ───────────────────────────────────────────────

  async addPhoto(id: string, file: UploadedFile, caption?: string) {
    await this.get(id);
    this.assertFile(file, IMAGE_MIME_TYPES, MAX_PHOTO_BYTES);

    const count = await this.prisma.borrowerPhoto.count({
      where: { borrowerId: id },
    });
    if (count >= MAX_PHOTOS) {
      throw new BadRequestException(`Больше ${MAX_PHOTOS} фотографий не нужно`);
    }

    const storageKey = await this.storage.save(
      'borrowers',
      id,
      file.mimetype,
      file.buffer,
    );
    return this.prisma.borrowerPhoto.create({
      data: {
        borrowerId: id,
        storageKey,
        caption: caption?.slice(0, 200),
        sortOrder: count,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });
  }

  async updatePhoto(id: string, photoId: string, dto: UpdatePhotoDto) {
    const photo = await this.prisma.borrowerPhoto.findFirst({
      where: { id: photoId, borrowerId: id },
    });
    if (!photo) throw new NotFoundException('Фотография не найдена');

    return this.prisma.borrowerPhoto.update({
      where: { id: photoId },
      data: {
        ...(dto.caption === undefined
          ? {}
          : { caption: dto.caption.slice(0, 200) }),
        ...(dto.sortOrder === undefined ? {} : { sortOrder: dto.sortOrder }),
      },
    });
  }

  async readPhoto(id: string, photoId: string) {
    const photo = await this.prisma.borrowerPhoto.findFirst({
      where: { id: photoId, borrowerId: id },
    });
    if (!photo) throw new NotFoundException('Фотография не найдена');
    const content = await readFile(
      this.storage.absolutePath(photo.storageKey),
    ).catch(() => {
      throw new NotFoundException('Файл недоступен');
    });
    return { photo, content };
  }

  async removePhoto(id: string, photoId: string) {
    const photo = await this.prisma.borrowerPhoto.findFirst({
      where: { id: photoId, borrowerId: id },
    });
    if (!photo) throw new NotFoundException('Фотография не найдена');

    await this.prisma.borrowerPhoto.delete({ where: { id: photoId } });
    await this.storage.remove(photo.storageKey);
  }

  /** Логотип отдаём любому вошедшему: он понадобится инвестору на витрине. */
  async readLogo(id: string) {
    const borrower = await this.prisma.borrower.findUnique({ where: { id } });
    if (!borrower?.logoKey) throw new NotFoundException('Логотип не загружен');
    const content = await readFile(
      this.storage.absolutePath(borrower.logoKey),
    ).catch(() => {
      throw new NotFoundException('Файл недоступен');
    });
    return {
      content,
      mimeType: borrower.logoKey.endsWith('.png') ? 'image/png' : 'image/jpeg',
    };
  }

  // ── Файлы ────────────────────────────────────────────────────────────────

  async addDocument(
    id: string,
    file: UploadedFile,
    kind: DocumentKind = DocumentKind.OTHER,
  ) {
    await this.get(id);
    this.assertFile(file, DOCUMENT_MIME_TYPES, MAX_DOCUMENT_BYTES);

    const storageKey = await this.storage.save(
      'borrowers',
      id,
      file.mimetype,
      file.buffer,
    );
    return this.prisma.borrowerDocument.create({
      data: {
        borrowerId: id,
        kind,
        fileName: decodeFileName(file.originalname),
        storageKey,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });
  }

  async readDocument(id: string, documentId: string) {
    const document = await this.prisma.borrowerDocument.findFirst({
      where: { id: documentId, borrowerId: id },
    });
    if (!document) throw new NotFoundException('Документ не найден');

    const content = await readFile(
      this.storage.absolutePath(document.storageKey),
    ).catch(() => {
      throw new NotFoundException('Файл недоступен');
    });
    return { document, content };
  }

  async removeDocument(id: string, documentId: string) {
    const { document } = await this.readDocument(id, documentId).catch(
      async (error) => {
        // Файла может не быть на диске, запись всё равно нужно удалить.
        const document = await this.prisma.borrowerDocument.findFirst({
          where: { id: documentId, borrowerId: id },
        });
        if (!document) throw error;
        return { document, content: Buffer.alloc(0) };
      },
    );

    await this.prisma.borrowerDocument.delete({ where: { id: document.id } });
    await this.storage.remove(document.storageKey);
  }

  async setLogo(id: string, file: UploadedFile) {
    const borrower = await this.get(id);
    this.assertFile(file, IMAGE_MIME_TYPES, MAX_LOGO_BYTES);

    const logoKey = await this.storage.save(
      'borrowers',
      id,
      file.mimetype,
      file.buffer,
    );
    if (borrower.logoKey) await this.storage.remove(borrower.logoKey);
    return this.prisma.borrower.update({ where: { id }, data: { logoKey } });
  }

  // ── Вспомогательное ──────────────────────────────────────────────────────

  /** Поля карточки без ключей: `name` и `bin` подставляются отдельно. */
  private toData(
    dto: UpdateBorrowerDto | CreateBorrowerDto,
  ): Partial<Prisma.BorrowerUncheckedCreateInput> {
    const { bin: _bin, ...rest } = dto as UpdateBorrowerDto;
    // Класс-трансформер создаёт объект со всеми полями DTO, незаполненные приходят
    // как undefined. Их нужно выбросить, иначе они затрут сохранённые значения.
    const data: Partial<Prisma.BorrowerUncheckedCreateInput> =
      Object.fromEntries(
        Object.entries(rest).filter(([, value]) => value !== undefined),
      );
    if (rest.foundedAt) data.foundedAt = new Date(rest.foundedAt);
    if (rest.annualRevenueUsd !== undefined)
      data.annualRevenueUsd = BigInt(rest.annualRevenueUsd);
    return data;
  }

  private async assertBinIsFree(bin: string) {
    if (await this.prisma.borrower.findUnique({ where: { bin } })) {
      throw new ConflictException('Заёмщик с таким БИН уже заведён');
    }
  }

  private async assertReadyForApproval(borrower: Borrower) {
    const missing = REQUIRED_FOR_APPROVAL.filter((field) => !borrower[field]);
    const wallets = await this.prisma.borrowerWallet.count({
      where: { borrowerId: borrower.id },
    });
    if (missing.length > 0 || wallets === 0) {
      throw new BadRequestException(
        'Чтобы допустить заёмщика к кампаниям, заполните название и БИН и добавьте хотя бы один кошелёк',
      );
    }
  }

  /** Одна запись в журнал: для того, что не является полем карточки. */
  private async logEvent(
    borrowerId: string,
    actorUserId: string | null,
    field: string,
    oldValue: string | null,
    newValue: string | null,
  ) {
    await this.prisma.borrowerEvent.create({
      data: { borrowerId, actorUserId, field, oldValue, newValue },
    });
  }

  private async recordChanges(
    before: Borrower,
    after: Borrower,
    actorUserId: string,
  ) {
    const events = TRACKED_FIELDS.filter(
      (field) => before[field] !== after[field],
    ).map((field) => ({
      borrowerId: after.id,
      actorUserId,
      field,
      oldValue: before[field] === null ? null : String(before[field]),
      newValue: after[field] === null ? null : String(after[field]),
    }));
    if (events.length > 0)
      await this.prisma.borrowerEvent.createMany({ data: events });
  }

  private assertFile(
    file: UploadedFile | undefined,
    mimeTypes: string[],
    maxBytes: number,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    if (!mimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Такой тип файла не принимается. Допустимы: ${mimeTypes.join(', ')}`,
      );
    }
    if (file.size > maxBytes) {
      throw new BadRequestException(
        `Файл больше ${Math.round(maxBytes / 1024 / 1024)} МБ`,
      );
    }
  }
}
