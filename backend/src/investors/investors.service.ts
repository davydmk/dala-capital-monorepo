import { readFile } from 'node:fs/promises';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvestorDocumentKind,
  InvestorType,
  KycAnswer,
  KycRejectType,
  KycStatus,
  Prisma,
  UserStatus,
  type Investor,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SolanaService } from '../solana/solana.service.js';
import { uuidToBytes } from '../solana/user-id.js';
import {
  DOCUMENT_MIME_TYPES,
  IMAGE_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  StorageService,
} from '../borrowers/storage.js';
import { BondsService } from '../bonds/bonds.service.js';
import { WalletCheckService } from '../borrowers/wallet-check.js';
import type { UploadedFile } from '../borrowers/borrowers.service.js';
import type {
  BeneficiaryDto,
  DecisionDto,
  ListInvestorsDto,
  UpdateInvestorDto,
} from './dto.js';
import { LEVEL_BY_TYPE, type KycProvider } from './kyc/kyc-provider.js';
import { ManualKycProvider } from './kyc/manual.provider.js';
import { allChecksPassed, checkInvestor, firstFailure } from './validation.js';

/** Контракт не даёт вернуть допуск двое суток после смены адреса вывода. */
export const ADDRESS_CHANGE_DELAY_MS = 48 * 60 * 60 * 1000;

/** Больше десяти бенефициаров в анкете — повод разбираться вне платформы. */
const MAX_BENEFICIARIES = 10;

const INCLUDE = {
  documents: { orderBy: { uploadedAt: 'desc' } },
  beneficiaries: { orderBy: { shareBps: 'desc' } },
  user: { select: { id: true, email: true, name: true, status: true } },
} satisfies Prisma.InvestorInclude;

type InvestorRecord = Prisma.InvestorGetPayload<{ include: typeof INCLUDE }>;

/** Статусы, в которых анкету ещё можно править. */
const EDITABLE = new Set<KycStatus>([
  KycStatus.NOT_STARTED,
  KycStatus.DRAFT,
  KycStatus.RETRY,
]);

/**
 * Что инвестор правит и после проверки. Проверенные данные заморожены, но
 * телефон — это способ связи, а не предмет проверки: он меняется свободно.
 */
const CONTACT_FIELDS = new Set(['phone']);

@Injectable()
export class InvestorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly walletCheck: WalletCheckService,
    private readonly solana: SolanaService,
    private readonly bonds: BondsService,
    // Провайдер подменяется здесь: сейчас проверку делает админ платформы.
    @Inject(ManualKycProvider) private readonly provider: KycProvider,
  ) {}

  // ── Кабинет инвестора ────────────────────────────────────────────────────

  /** Анкета заводится при первом заходе: отдельной кнопки «начать» не нужно. */
  async me(userId: string): Promise<InvestorRecord> {
    const existing = await this.prisma.investor.findUnique({
      where: { userId },
      include: INCLUDE,
    });
    if (existing) return existing;

    return this.prisma.investor.create({
      data: { userId, provider: this.provider.name },
      include: INCLUDE,
    });
  }

  async updateMe(userId: string, dto: UpdateInvestorDto) {
    const current = await this.me(userId);
    const frozen = !EDITABLE.has(current.status);

    let data = this.toData(dto);
    if (frozen) {
      data = Object.fromEntries(
        Object.entries(data).filter(([key]) => CONTACT_FIELDS.has(key)),
      );
      // Из анкеты после проверки правится только телефон; всё прочее — отказ.
      if (Object.keys(data).length === 0) this.assertEditable(current);
    }

    if (!frozen && dto.withdrawalAddress) {
      // Адрес проверяем сразу: узнать о токен-счёте на проверке анкеты поздно.
      const check = await this.walletCheck.check(dto.withdrawalAddress);
      if (check.ok === false) throw new BadRequestException(check.reason);
      data.withdrawalCheckedAt = new Date();
      data.withdrawalCheckResult = check.ok === true ? 'ok' : 'unknown';
    }

    return this.prisma.investor.update({
      where: { id: current.id },
      data,
      include: INCLUDE,
    });
  }

  /** Отправка на проверку: полноту анкеты сверяем тем же списком, что видит инвестор. */
  async submit(userId: string) {
    const investor = await this.me(userId);
    this.assertEditable(investor);

    const checks = checkInvestor(investor);
    if (!allChecksPassed(checks)) {
      throw new BadRequestException(
        firstFailure(checks)?.hint ?? 'Анкета заполнена не полностью',
      );
    }

    const applicant = await this.provider.createApplicant(investor);
    const review = await this.provider.submit(investor);

    const updated = await this.prisma.investor.update({
      where: { id: investor.id },
      data: {
        status: review.status,
        submittedAt: new Date(),
        step: 5,
        applicantId: applicant.applicantId,
        levelName: applicant.levelName ?? LEVEL_BY_TYPE[investor.type],
        // Прошлое решение больше не актуально: инвестор исправил и отправил снова.
        reviewAnswer: null,
        reviewRejectType: null,
        rejectLabels: [],
        clientComment: null,
        reviewedAt: null,
      },
      include: INCLUDE,
    });
    await this.logEvent(
      investor.id,
      userId,
      'status',
      investor.status,
      updated.status,
    );
    return updated;
  }

  /**
   * Заявка на смену адреса вывода. Сам инвестор ничего не подписывает,
   * поэтому адрес меняет админ — и контракт после этого держит выводы 48 часов.
   */
  async requestWithdrawalAddress(userId: string, address: string) {
    const investor = await this.me(userId);
    if (investor.status !== KycStatus.APPROVED) {
      throw new BadRequestException(
        'До одобрения адрес меняется прямо в анкете',
      );
    }
    if (address === investor.withdrawalAddress) {
      throw new BadRequestException('Это текущий адрес вывода');
    }

    const check = await this.walletCheck.check(address);
    if (check.ok === false) throw new BadRequestException(check.reason);

    return this.prisma.investor.update({
      where: { id: investor.id },
      data: {
        pendingWithdrawalAddress: address,
        pendingRequestedAt: new Date(),
      },
      include: INCLUDE,
    });
  }

  // ── Документы и бенефициары ──────────────────────────────────────────────

  async addDocument(
    investorId: string,
    file: UploadedFile,
    kind: InvestorDocumentKind = InvestorDocumentKind.OTHER,
  ) {
    const investor = await this.byId(investorId);
    this.assertEditable(investor);
    // Селфи бывает только снимком, остальное можно прислать и в PDF.
    const types =
      kind === InvestorDocumentKind.SELFIE
        ? IMAGE_MIME_TYPES
        : DOCUMENT_MIME_TYPES;
    this.assertFile(file, types, MAX_DOCUMENT_BYTES);

    // Документ каждого вида нужен один: новый заменяет прежний.
    if (kind !== InvestorDocumentKind.OTHER) {
      const previous = await this.prisma.investorDocument.findFirst({
        where: { investorId, kind },
      });
      if (previous) await this.removeDocument(investorId, previous.id);
    }

    const storageKey = await this.storage.save(
      'investors',
      investorId,
      file.mimetype,
      file.buffer,
    );
    return this.prisma.investorDocument.create({
      data: {
        investorId,
        kind,
        fileName: decodeFileName(file.originalname),
        storageKey,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });
  }

  async readDocument(investorId: string, documentId: string) {
    const document = await this.prisma.investorDocument.findFirst({
      where: { id: documentId, investorId },
    });
    if (!document?.storageKey) {
      throw new NotFoundException('Документ не найден');
    }

    const content = await readFile(
      this.storage.absolutePath(document.storageKey),
    ).catch(() => {
      throw new NotFoundException('Файл недоступен');
    });
    return { document, content };
  }

  async removeDocument(investorId: string, documentId: string) {
    const document = await this.prisma.investorDocument.findFirst({
      where: { id: documentId, investorId },
    });
    if (!document) throw new NotFoundException('Документ не найден');

    await this.prisma.investorDocument.delete({ where: { id: document.id } });
    if (document.storageKey) await this.storage.remove(document.storageKey);
  }

  async addBeneficiary(investorId: string, dto: BeneficiaryDto) {
    const investor = await this.byId(investorId);
    this.assertEditable(investor);
    if (investor.type !== InvestorType.COMPANY) {
      throw new BadRequestException('Бенефициары есть только у компании');
    }
    if (investor.beneficiaries.length >= MAX_BENEFICIARIES) {
      throw new BadRequestException(
        `Больше ${MAX_BENEFICIARIES} бенефициаров в анкету не помещается`,
      );
    }

    return this.prisma.investorBeneficiary.create({
      data: {
        investorId,
        fullName: dto.fullName.trim(),
        country: dto.country,
        shareBps: dto.shareBps,
        position: dto.position,
        isPep: dto.isPep ?? false,
      },
    });
  }

  async removeBeneficiary(investorId: string, beneficiaryId: string) {
    const beneficiary = await this.prisma.investorBeneficiary.findFirst({
      where: { id: beneficiaryId, investorId },
    });
    if (!beneficiary) throw new NotFoundException('Бенефициар не найден');
    await this.prisma.investorBeneficiary.delete({
      where: { id: beneficiaryId },
    });
  }

  // ── Админ ────────────────────────────────────────────────────────────────

  async list(filter: ListInvestorsDto) {
    const where: Prisma.InvestorWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.query) {
      const query = filter.query.trim();
      where.OR = [
        { companyName: { contains: query, mode: 'insensitive' } },
        { lastName: { contains: query, mode: 'insensitive' } },
        { user: { email: { contains: query, mode: 'insensitive' } } },
      ];
    }

    const [investors, pending] = await Promise.all([
      this.prisma.investor.findMany({
        where,
        orderBy: [{ submittedAt: 'asc' }, { createdAt: 'desc' }],
        include: {
          user: { select: { id: true, email: true, status: true } },
          _count: { select: { documents: true } },
        },
      }),
      this.prisma.investor.count({ where: { status: KycStatus.PENDING } }),
    ]);
    return { investors, pending };
  }

  async byId(id: string): Promise<InvestorRecord> {
    const investor = await this.prisma.investor.findUnique({
      where: { id },
      include: INCLUDE,
    });
    if (!investor) throw new NotFoundException('Инвестор не найден');
    return investor;
  }

  history(id: string) {
    return this.prisma.investorEvent.findMany({
      where: { investorId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Решение по анкете. Пишется в те же поля, которые при подключении внешнего
   * сервиса заполнит его вебхук, — админка после этого не меняется.
   */
  async decide(id: string, dto: DecisionDto, actorId: string) {
    const investor = await this.byId(id);
    // Повторная проверка допущенного инвестора возможна: у него мог истечь
    // документ или смениться фамилия. Нельзя только одобрить одобренного.
    const approved = investor.status === KycStatus.APPROVED;
    if (approved && dto.action === 'approve') {
      throw new ConflictException('Инвестор уже допущен');
    }
    // Решение, которое закрывает доступ, всегда нужно объяснить — в том числе
    // «отложить», если оно отправляет допущенного инвестора на перепроверку.
    const needsComment =
      dto.action === 'retry' || dto.action === 'reject' || approved;
    if (needsComment && !dto.clientComment) {
      throw new BadRequestException(
        'Напишите инвестору, что исправить: без этого он не поймёт причину',
      );
    }
    if (dto.action === 'approve') {
      const checks = checkInvestor(investor);
      if (!allChecksPassed(checks)) {
        throw new BadRequestException(
          `Анкета неполная: ${firstFailure(checks)?.title}`,
        );
      }
    }

    const decision = {
      approve: {
        status: KycStatus.APPROVED,
        reviewAnswer: KycAnswer.GREEN,
        reviewRejectType: null,
      },
      retry: {
        status: KycStatus.RETRY,
        reviewAnswer: KycAnswer.RED,
        reviewRejectType: KycRejectType.RETRY,
      },
      reject: {
        status: KycStatus.REJECTED,
        reviewAnswer: KycAnswer.RED,
        reviewRejectType: KycRejectType.FINAL,
      },
      hold: {
        status: KycStatus.ON_HOLD,
        reviewAnswer: null,
        reviewRejectType: null,
      },
    }[dto.action];

    // Пока данные не подтверждены заново, деньги с платформы уходить не должны.
    // Снимаем допуск до записи решения: если транзакция не пройдёт, статус
    // останется прежним и база с сетью не разойдутся.
    const revoke =
      approved && investor.onchainAccount && investor.whitelistStatus;
    if (revoke) {
      const signature = await this.solana.setWhitelistStatus(
        uuidToBytes(investor.userId),
        false,
      );
      await this.log(actorId, 'setWhitelist', investor.id, signature);
      await this.logEvent(id, actorId, 'whitelist', 'true', 'false');
    }

    const updated = await this.prisma.investor.update({
      where: { id },
      data: {
        ...decision,
        ...(revoke ? { whitelistStatus: false } : {}),
        clientComment: dto.clientComment ?? null,
        moderationComment: dto.moderationComment ?? null,
        reviewedAt: new Date(),
      },
      include: INCLUDE,
    });

    // Кабинет открывается только допущенному; окончательный отказ закрывает вход.
    const userStatus =
      dto.action === 'approve'
        ? UserStatus.ACTIVE
        : dto.action === 'reject'
          ? UserStatus.BLOCKED
          : UserStatus.PENDING;
    await this.prisma.user.update({
      where: { id: investor.userId },
      data: { status: userStatus },
    });

    await this.logEvent(id, actorId, 'status', investor.status, updated.status);
    return updated;
  }

  /**
   * Заводит инвестора в контракте и открывает допуск.
   * Повторный вызов безопасен: сначала читаем аккаунт из сети, и если он есть —
   * не создаём второй, а подтягиваем состояние. Так лечится обрыв на середине.
   */
  async syncOnchain(id: string, actorId: string) {
    const investor = await this.byId(id);
    if (investor.status !== KycStatus.APPROVED) {
      throw new BadRequestException('Сначала одобрите анкету');
    }
    if (!investor.withdrawalAddress) {
      throw new BadRequestException(
        'Без адреса вывода контракт аккаунт не создаст',
      );
    }

    const userId = uuidToBytes(investor.userId);
    let account = await this.solana.userAccount(userId);
    let signature: string | null = null;

    if (!account) {
      signature = await this.solana.createUser(
        userId,
        investor.type,
        investor.withdrawalAddress,
        true,
      );
      account = await this.solana.userAccount(userId);
      await this.log(actorId, 'createUser', investor.id, signature);
      await this.logEvent(
        id,
        actorId,
        'onchainAccount',
        null,
        account?.address ?? null,
      );
    }

    const updated = await this.applyOnchain(investor, account, signature);
    return { investor: updated, account, signature };
  }

  /** Снимает или возвращает допуск к выводам. */
  async setWhitelist(id: string, enabled: boolean, actorId: string) {
    const investor = await this.byId(id);
    if (!investor.onchainAccount) {
      throw new BadRequestException('Аккаунт в контракте ещё не создан');
    }
    const blockedUntil = investor.whitelistBlockedUntil;
    if (enabled && blockedUntil && blockedUntil > new Date()) {
      throw new BadRequestException(
        `После смены адреса вывода контракт держит выводы закрытыми до ${blockedUntil.toISOString()}`,
      );
    }

    const userId = uuidToBytes(investor.userId);
    const signature = await this.solana.setWhitelistStatus(userId, enabled);
    await this.log(actorId, 'setWhitelist', investor.id, signature);
    await this.logEvent(
      id,
      actorId,
      'whitelist',
      String(investor.whitelistStatus),
      String(enabled),
    );

    const account = await this.solana.userAccount(userId);
    return this.applyOnchain(investor, account, signature);
  }

  /** Подтверждение заявки инвестора на смену адреса вывода. */
  async confirmWithdrawalAddress(id: string, actorId: string) {
    const investor = await this.byId(id);
    const address = investor.pendingWithdrawalAddress;
    if (!address) throw new BadRequestException('Заявки на смену адреса нет');
    if (!investor.onchainAccount) {
      throw new BadRequestException('Аккаунт в контракте ещё не создан');
    }

    const userId = uuidToBytes(investor.userId);
    const signature = await this.solana.setWithdrawalAddress(userId, address);
    await this.log(actorId, 'setWithdrawalAddress', investor.id, signature);
    await this.logEvent(
      id,
      actorId,
      'withdrawalAddress',
      investor.withdrawalAddress,
      address,
    );

    // Бумаги именные и лежат на адресе вывода: со сменой адреса они переезжают
    // туда же, иначе право требования осталось бы на счёте, который инвестор
    // больше не считает своим.
    await this.bonds.moveBonds(investor.withdrawalAddress, address);

    const account = await this.solana.userAccount(userId);
    return this.prisma.investor.update({
      where: { id },
      data: {
        withdrawalAddress: address,
        pendingWithdrawalAddress: null,
        pendingRequestedAt: null,
        // Контракт снял допуск сам; вернуть его можно через 48 часов.
        whitelistStatus: account?.whitelistStatus ?? false,
        whitelistBlockedUntil: this.blockedUntil(account),
      },
      include: INCLUDE,
    });
  }

  // ── Вспомогательное ──────────────────────────────────────────────────────

  /** Переносит состояние аккаунта из сети в базу: сеть — источник правды. */
  private applyOnchain(
    investor: Investor,
    account: Awaited<ReturnType<SolanaService['userAccount']>>,
    signature: string | null,
  ) {
    return this.prisma.investor.update({
      where: { id: investor.id },
      data: {
        onchainAccount: account?.address ?? null,
        onchainCreatedAt:
          investor.onchainCreatedAt ?? (account ? new Date() : null),
        ...(signature ? { onchainSignature: signature } : {}),
        whitelistStatus: account?.whitelistStatus ?? false,
        whitelistBlockedUntil: this.blockedUntil(account),
      },
      include: INCLUDE,
    });
  }

  private blockedUntil(
    account: Awaited<ReturnType<SolanaService['userAccount']>>,
  ): Date | null {
    if (!account || account.withdrawalAddressChangedAt === 0) return null;
    return new Date(
      account.withdrawalAddressChangedAt * 1000 + ADDRESS_CHANGE_DELAY_MS,
    );
  }

  private assertEditable(investor: Investor) {
    if (EDITABLE.has(investor.status)) return;
    throw new ConflictException(
      investor.status === KycStatus.PENDING
        ? 'Анкета на проверке: дождитесь решения'
        : 'Анкету больше нельзя менять',
    );
  }

  /**
   * Поля анкеты без ключей. Класс-трансформер создаёт объект со всеми полями DTO,
   * незаполненные приходят как undefined — их нужно выбросить, иначе они затрут
   * сохранённое.
   */
  private toData(dto: UpdateInvestorDto): Prisma.InvestorUncheckedUpdateInput {
    const {
      acceptTerms,
      acceptRisk,
      dob,
      idDocValidUntil,
      incorporatedOn,
      ...rest
    } = dto;
    const data: Prisma.InvestorUncheckedUpdateInput = Object.fromEntries(
      Object.entries(rest)
        .filter(([, value]) => value !== undefined)
        // Пустая строка из формы — это «поле очистили», а не «не передали».
        .map(([key, value]) => [key, value === '' ? null : value]),
    );

    const date = (value: string) => (value ? new Date(value) : null);
    if (dob !== undefined) data.dob = date(dob);
    if (idDocValidUntil !== undefined)
      data.idDocValidUntil = date(idDocValidUntil);
    if (incorporatedOn !== undefined)
      data.incorporatedOn = date(incorporatedOn);
    // Согласие снимается тоже: галочку можно передумать ставить до отправки.
    if (acceptTerms !== undefined)
      data.termsAcceptedAt = acceptTerms ? new Date() : null;
    if (acceptRisk !== undefined)
      data.riskAcceptedAt = acceptRisk ? new Date() : null;
    return data;
  }

  private async logEvent(
    investorId: string,
    actorUserId: string | null,
    field: string,
    oldValue: string | null,
    newValue: string | null,
  ) {
    await this.prisma.investorEvent.create({
      data: { investorId, actorUserId, field, oldValue, newValue },
    });
  }

  /** Журнал действий админа в контракте — общий с настройками платформы. */
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

/** multer отдаёт имя файла в latin1: кириллицу нужно вернуть в UTF-8. */
function decodeFileName(name: string): string {
  return Buffer.from(name, 'latin1').toString('utf8').slice(0, 200);
}
