import { readFileSync } from 'node:fs';
import * as anchor from '@coral-xyz/anchor';
import { AnchorProvider, BN, Program, Wallet, utils } from '@coral-xyz/anchor';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  type TransactionSignature,
} from '@solana/web3.js';
import idl from './idl/dala_capital.json' with { type: 'json' };

const bs58 = utils.bytes.bs58;
import type { DalaCapital } from './idl/dala_capital.js';

const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

/** Сделка так, как её отдаёт Anchor: тип выводим из клиента, а не дублируем. */
type DealAccount = Awaited<
  ReturnType<Program<DalaCapital>['account']['deal']['fetch']>
>;

type PositionAccount = Awaited<
  ReturnType<Program<DalaCapital>['account']['position']['fetch']>
>;

/** Префикс инструкции-события `emit_cpi!`. */
const EVENT_IX_TAG = Buffer.from([
  0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d,
]);

/** Событие контракта, как оно ложится в нашу историю кампании. */
export interface OnchainEvent {
  signature: string;
  slot: number;
  blockTime: number | null;
  /** Порядок события внутри транзакции. */
  index: number;
  name: string;
  payload: Record<string, unknown>;
}

/**
 * Anchor отдаёт числа как BN, а ключи как PublicKey. В базу кладём строками.
 * Обходим значение сами: `JSON.stringify` сперва зовёт у BN его `toJSON`,
 * а тот отдаёт шестнадцатеричную запись — 2 000 000 превратились бы в «1e8480».
 */
function plain(value: unknown): Record<string, unknown> {
  const convert = (item: unknown): unknown => {
    if (item === null || item === undefined) return item;
    if (typeof item === 'bigint') return item.toString();
    if (BN.isBN(item)) return (item as BN).toString(10);
    if (item instanceof PublicKey) return item.toBase58();
    if (Array.isArray(item)) return item.map(convert);
    if (typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).map(([key, nested]) => [
          key,
          convert(nested),
        ]),
      );
    }
    return item;
  };
  return convert(value) as Record<string, unknown>;
}

/** Контракт принимает график частями: в одну транзакцию влезает 20 платежей. */
export const PERIODS_PER_TX = 20;

export interface CampaignParams {
  softCap: bigint;
  hardCap: bigint;
  minTicket: bigint;
  maxTicket: bigint;
  fundingStart: number;
  fundingDeadline: number;
  scheduleKind: 'ANNUITY' | 'COUPON';
  annualRateBps: number;
  periodsPerYear: number;
  penaltyRateBps: number;
  defaultThresholdDays: number;
  prepaymentFeeBps: number;
  platformFeeBps: number;
  cancelGraceDays: number;
  borrowerWallet: string;
  /** Расчётный токен кампании: у разных кампаний он может быть разным. */
  mint: string;
}

/** Платёж так, как он загружается в контракт при публикации: дата и доля тела. */
export interface PeriodInput {
  dueTs: number;
  principalFraction: bigint;
}

/** Платёж так, как он лежит в сделке: к дате и доле добавлены суммы и оплата. */
export interface OnchainPeriod {
  dueTs: number;
  principalFraction: bigint;
  /** Тело и проценты платежа. Ноль, пока сбор не закрыт: их считает `build_schedule`. */
  principalAmount: bigint;
  interestAmount: bigint;
  principalPaid: bigint;
  interestPaid: bigint;
}

/** Позиция инвестора в кампании со всеми чекпоинтами распределения. */
export interface OnchainPosition {
  address: string;
  principal: bigint;
  checkpointPrincipal: bigint;
  checkpointInterest: bigint;
  checkpointPenalty: bigint;
  checkpointPrepaymentFee: bigint;
}

/** Аккаунт инвестора в контракте. */
export interface OnchainUser {
  address: string;
  entityType: 'INDIVIDUAL' | 'COMPANY';
  withdrawalAddress: string;
  whitelistStatus: boolean;
  /** 0 — адрес ни разу не меняли; иначе от этого момента идут 48 часов запрета. */
  withdrawalAddressChangedAt: number;
}

/** То, что интерфейсу нужно знать о сделке в сети. */
export interface OnchainDeal {
  state: string;
  totalRaised: bigint;
  periodCount: number;
  scheduleFinalized: boolean;
  borrowerWallet: string;
  fundingStart: number;
  fundingDeadline: number;
  mint: string;
  softCap: bigint;
  hardCap: bigint;
  minTicket: bigint;
  /** 0 — ограничения на размер взноса нет. */
  maxTicket: bigint;
  /** Дата последнего платежа: по ней видно, когда заём закончится. */
  lastDueTs: number;
  /** Просроченное тело: пока оно не ноль, заём обслуживается с опозданием. */
  overduePrincipal: bigint;
  /** Номер следующего платежа по графику, с нуля. */
  nextPeriod: number;
  /** Даты платежей берём из контракта, а не пересчитываем. */
  periods: OnchainPeriod[];
  /** Неоплаченные проценты наступивших платежей. */
  overdueScheduledInterest: bigint;
  /** Проценты, начисленные на просроченное тело. */
  extraInterest: bigint;
  penalty: bigint;
  /** Весь неоплаченный остаток тела после дефолта. */
  defaultPrincipal: bigint;
  /** Неоплаченные проценты после дефолта, включая начисляемые. */
  defaultInterest: bigint;
  /** Расходы платформы на взыскание и сколько из них уже возмещено. */
  recoveryCosts: bigint;
  recoveryReimbursed: bigint;
  /**
   * Остатки от деления при начислении: контракт не теряет копейки между
   * начислениями, и зеркало на бэкенде должно считать так же.
   */
  interestCarry: bigint;
  penaltyCarry: bigint;
  /**
   * Момент, по состоянию на который верны поля долга. Дальше долг растёт,
   * но контракт этого не знает до следующей денежной транзакции.
   */
  lastAccrualTs: number;
  annualRateBps: number;
  penaltyRateBps: number;
  periodsPerYear: number;
  platformFeeBps: number;
  defaultThresholdDays: number;
  /** `annuity` или `coupon`: купону контракт досрочное погашение запрещает. */
  scheduleType: string;
  prepaymentFeeBps: number;
  /** Адрес погашения: на него заёмщик переводит деньги. */
  repayAccount: string;
  /**
   * Аккумуляторы распределения: из них и чекпоинтов позиции считается,
   * сколько инвестору причитается. Масштаб — SCALE (1e12).
   */
  accPrincipal: bigint;
  accInterest: bigint;
  accPenalty: bigint;
  accPrepaymentFee: bigint;
}

/**
 * Работа с контрактом от имени платформы. Ключ admin лежит на сервере:
 * решение принято сознательно ради простоты MVP, на mainnet его заменит мультисиг.
 */
@Injectable()
export class SolanaService implements OnModuleInit {
  private readonly logger = new Logger(SolanaService.name);
  private readonly connection: Connection;
  private readonly admin: Keypair;
  /** Токен по умолчанию: подставляется в новую кампанию, но не ограничивает выбор. */
  private readonly defaultMint: PublicKey;
  /** Ключ whitelist authority: только он заводит инвесторов и ведёт допуск. */
  private readonly whitelist: Keypair;
  /** Ключ оператора: открывает адреса пополнения, зачисляет взносы, платит ренту. */
  private readonly operator: Keypair;
  readonly cluster: string;
  private program!: Program<DalaCapital>;

  constructor(config: ConfigService) {
    this.connection = new Connection(
      config.get<string>('SOLANA_RPC_URL') ?? 'https://api.devnet.solana.com',
      'confirmed',
    );
    this.cluster = config.get<string>('SOLANA_CLUSTER') ?? 'devnet';
    this.defaultMint = new PublicKey(
      config.getOrThrow<string>('SOLANA_USDC_MINT'),
    );
    this.admin = SolanaService.readKeypair(
      config.getOrThrow<string>('SOLANA_ADMIN_KEYPAIR'),
    );
    this.whitelist = SolanaService.readKeypair(
      config.getOrThrow<string>('SOLANA_WHITELIST_KEYPAIR'),
    );
    this.operator = SolanaService.readKeypair(
      config.getOrThrow<string>('SOLANA_OPERATOR_KEYPAIR'),
    );
  }

  private static readKeypair(file: string): Keypair {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(file, 'utf8')) as number[]),
    );
  }

  onModuleInit() {
    const provider = new AnchorProvider(
      this.connection,
      new Wallet(this.admin),
      {
        commitment: 'confirmed',
      },
    );
    this.program = new Program<DalaCapital>(
      idl as anchor.Idl as DalaCapital,
      provider,
    );
    this.logger.log(
      `Контракт ${this.program.programId.toBase58()} (${this.cluster}), ` +
        `admin ${this.admin.publicKey.toBase58()}, ` +
        `whitelist ${this.whitelist.publicKey.toBase58()}, ` +
        `operator ${this.operator.publicKey.toBase58()}`,
    );
  }

  // ── Адреса ───────────────────────────────────────────────────────────────

  get platformPda(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('platform')],
      this.program.programId,
    )[0];
  }

  dealPda(campaignId: bigint): PublicKey {
    const id = Buffer.alloc(8);
    id.writeBigUInt64LE(campaignId);
    return PublicKey.findProgramAddressSync(
      [Buffer.from('deal'), this.platformPda.toBuffer(), id],
      this.program.programId,
    )[0];
  }

  /** Аккаунт инвестора: 16 байт user_id — это UUID пользователя в базе. */
  userPda(userId: Uint8Array): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('user'), this.platformPda.toBuffer(), Buffer.from(userId)],
      this.program.programId,
    )[0];
  }

  /**
   * Владелец адреса пополнения. Данных не хранит, но именно его адрес
   * показывают инвестору: биржи и кошельки переводят на владельца, а токен-счёт
   * выводят сами. Адрес off-curve, поэтому ATA считаем вручную.
   */
  depositOwnerPda(deal: PublicKey, userId: Uint8Array): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('deposit'), deal.toBuffer(), Buffer.from(userId)],
      this.program.programId,
    )[0];
  }

  positionPda(deal: PublicKey, userId: Uint8Array): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('pos'), deal.toBuffer(), Buffer.from(userId)],
      this.program.programId,
    )[0];
  }

  /** Волт кампании: там лежат собранные деньги и то, чем гасят заём. */
  vaultAddress(campaignId: bigint, mint: string): PublicKey {
    return this.ata(this.dealPda(campaignId), new PublicKey(mint));
  }

  /** Токен-счёт, на который придут деньги инвестора. */
  depositTokenAddress(
    campaignId: bigint,
    userId: Uint8Array,
    mint: string,
  ): PublicKey {
    const deal = this.dealPda(campaignId);
    return this.ata(this.depositOwnerPda(deal, userId), new PublicKey(mint));
  }

  /**
   * Адрес погашения кампании: токен-счёт, с которого контракт забирает деньги
   * заёмщика. Создаётся вместе с кампанией, так что существует всегда.
   */
  repayAddress(campaignId: bigint, mint: string): PublicKey {
    const deal = this.dealPda(campaignId);
    return this.ata(this.repayOwnerPda(deal), new PublicKey(mint));
  }

  repayOwnerPda(deal: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('repay'), deal.toBuffer()],
      this.program.programId,
    )[0];
  }

  private ata(owner: PublicKey, mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )[0];
  }

  private eventAuthority(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('__event_authority')],
      this.program.programId,
    )[0];
  }

  // ── Чтение ───────────────────────────────────────────────────────────────

  async platform() {
    const state = await this.program.account.platform.fetch(this.platformPda);
    return {
      admin: state.admin.toBase58(),
      operator: state.operator.toBase58(),
      whitelistAuthority: state.whitelistAuthority.toBase58(),
      treasury: state.treasury.toBase58(),
      campaignCount: BigInt(state.campaignCount.toString()),
      allowedMints: state.allowedMints.map((item) => item.toBase58()),
    };
  }

  async isMintAllowed(mint: string): Promise<boolean> {
    const platform = await this.platform();
    return platform.allowedMints.includes(mint);
  }

  /** Сделка из сети или null, если кампании с таким номером ещё нет. */
  async deal(campaignId: bigint): Promise<OnchainDeal | null> {
    const account = await this.program.account.deal.fetchNullable(
      this.dealPda(campaignId),
    );
    return account ? this.toDeal(account) : null;
  }

  /**
   * Сделки пачкой: на витрине их столько же, сколько кампаний, и отдельный
   * запрос на каждую превратился бы в десятки обращений к RPC.
   */
  async deals(campaignIds: bigint[]): Promise<Map<string, OnchainDeal>> {
    const found = new Map<string, OnchainDeal>();
    if (campaignIds.length === 0) return found;

    // fetchMultiple ходит в сеть одним getMultipleAccounts и сам разбирает данные.
    const accounts = await this.program.account.deal.fetchMultiple(
      campaignIds.map((id) => this.dealPda(id)),
    );
    accounts.forEach((account, index) => {
      if (!account) return;
      found.set(campaignIds[index].toString(), this.toDeal(account));
    });
    return found;
  }

  /** Позиции инвестора в нескольких кампаниях — тоже одним запросом. */
  async positions(
    campaignIds: bigint[],
    userId: Uint8Array,
  ): Promise<Map<string, OnchainPosition>> {
    const found = new Map<string, OnchainPosition>();
    if (campaignIds.length === 0) return found;

    const addresses = campaignIds.map((id) =>
      this.positionPda(this.dealPda(id), userId),
    );
    const accounts =
      await this.program.account.position.fetchMultiple(addresses);
    accounts.forEach((account, index) => {
      if (!account) return;
      found.set(
        campaignIds[index].toString(),
        this.toPosition(addresses[index], account),
      );
    });
    return found;
  }

  private toDeal(account: DealAccount): OnchainDeal {
    const periods = account.periods;
    return {
      state: Object.keys(account.state)[0],
      totalRaised: BigInt(account.totalRaised.toString()),
      periodCount: periods.length,
      scheduleFinalized: account.scheduleFinalized,
      borrowerWallet: account.borrowerWallet.toBase58(),
      fundingStart: Number(account.fundingStart.toString()),
      fundingDeadline: Number(account.fundingDeadline.toString()),
      mint: account.mint.toBase58(),
      softCap: BigInt(account.softCap.toString()),
      hardCap: BigInt(account.hardCap.toString()),
      minTicket: BigInt(account.minTicket.toString()),
      maxTicket: BigInt(account.maxTicket.toString()),
      lastDueTs: periods.length
        ? Number(periods[periods.length - 1].dueTs.toString())
        : 0,
      overduePrincipal: BigInt(account.overduePrincipal.toString()),
      nextPeriod: account.nextPeriod,
      periods: periods.map((period) => ({
        dueTs: Number(period.dueTs.toString()),
        principalFraction: BigInt(period.principalFraction.toString()),
        principalAmount: BigInt(period.principalAmount.toString()),
        interestAmount: BigInt(period.interestAmount.toString()),
        principalPaid: BigInt(period.principalPaid.toString()),
        interestPaid: BigInt(period.interestPaid.toString()),
      })),
      overdueScheduledInterest: BigInt(
        account.overdueScheduledInterest.toString(),
      ),
      extraInterest: BigInt(account.extraInterest.toString()),
      penalty: BigInt(account.penalty.toString()),
      defaultPrincipal: BigInt(account.defaultPrincipal.toString()),
      defaultInterest: BigInt(account.defaultInterest.toString()),
      recoveryCosts: BigInt(account.recoveryCosts.toString()),
      recoveryReimbursed: BigInt(account.recoveryReimbursed.toString()),
      interestCarry: BigInt(account.interestCarry.toString()),
      penaltyCarry: BigInt(account.penaltyCarry.toString()),
      lastAccrualTs: Number(account.lastAccrualTs.toString()),
      annualRateBps: account.annualRateBps,
      penaltyRateBps: account.penaltyRateBps,
      periodsPerYear: account.periodsPerYear,
      platformFeeBps: account.platformFeeBps,
      defaultThresholdDays: account.defaultThresholdDays,
      scheduleType: Object.keys(account.scheduleType)[0],
      prepaymentFeeBps: account.prepaymentFeeBps,
      repayAccount: account.repayAccount.toBase58(),
      accPrincipal: BigInt(account.accPrincipal.toString()),
      accInterest: BigInt(account.accInterest.toString()),
      accPenalty: BigInt(account.accPenalty.toString()),
      accPrepaymentFee: BigInt(account.accPrepaymentFee.toString()),
    };
  }

  private toPosition(
    address: PublicKey,
    account: PositionAccount,
  ): OnchainPosition {
    return {
      address: address.toBase58(),
      principal: BigInt(account.principal.toString()),
      checkpointPrincipal: BigInt(account.checkpointPrincipal.toString()),
      checkpointInterest: BigInt(account.checkpointInterest.toString()),
      checkpointPenalty: BigInt(account.checkpointPenalty.toString()),
      checkpointPrepaymentFee: BigInt(
        account.checkpointPrepaymentFee.toString(),
      ),
    };
  }

  /** Свободный номер кампании: счётчик платформы плюс проверка, что адрес не занят. */
  async nextCampaignId(): Promise<bigint> {
    const { campaignCount } = await this.platform();
    let candidate = campaignCount + 1n;
    while (await this.deal(candidate)) candidate += 1n;
    return candidate;
  }

  // ── Инвесторы ────────────────────────────────────────────────────────────

  /** Аккаунт инвестора из сети или null, если его ещё не заводили. */
  async userAccount(userId: Uint8Array): Promise<OnchainUser | null> {
    const address = this.userPda(userId);
    const account =
      await this.program.account.userAccount.fetchNullable(address);
    if (!account) return null;
    return {
      address: address.toBase58(),
      entityType:
        Object.keys(account.entityType)[0] === 'legal'
          ? 'COMPANY'
          : 'INDIVIDUAL',
      withdrawalAddress: account.withdrawalAddress.toBase58(),
      whitelistStatus: account.whitelistStatus,
      withdrawalAddressChangedAt: Number(
        account.withdrawalAddressChangedAt.toString(),
      ),
    };
  }

  /**
   * Заводит инвестора. Подписывает whitelist authority — контракт других
   * не принимает. Адрес вывода обязателен: с пустым инструкция отказывает.
   */
  async createUser(
    userId: Uint8Array,
    entityType: 'INDIVIDUAL' | 'COMPANY',
    withdrawalAddress: string,
    whitelisted: boolean,
  ): Promise<TransactionSignature> {
    return this.program.methods
      .createUser(
        [...userId],
        entityType === 'COMPANY' ? { legal: {} } : { individual: {} },
        new PublicKey(withdrawalAddress),
        whitelisted,
      )
      .accountsStrict({
        whitelistAuthority: this.whitelist.publicKey,
        platform: this.platformPda,
        user: this.userPda(userId),
        systemProgram: SystemProgram.programId,
        eventAuthority: this.eventAuthority(),
        program: this.program.programId,
      })
      .signers([this.whitelist])
      .rpc();
  }

  /** Снимает и возвращает допуск к выводам. */
  async setWhitelistStatus(
    userId: Uint8Array,
    enabled: boolean,
  ): Promise<TransactionSignature> {
    return this.program.methods
      .setWhitelistStatus([...userId], enabled)
      .accountsStrict({
        whitelistAuthority: this.whitelist.publicKey,
        platform: this.platformPda,
        user: this.userPda(userId),
        eventAuthority: this.eventAuthority(),
        program: this.program.programId,
      })
      .signers([this.whitelist])
      .rpc();
  }

  /**
   * Меняет адрес вывода. Подписывает admin, а не whitelist authority.
   * Контракт сам снимает допуск и не даёт вернуть его 48 часов — это защита
   * от подмены адреса при захвате доступа.
   */
  async setWithdrawalAddress(
    userId: Uint8Array,
    withdrawalAddress: string,
  ): Promise<TransactionSignature> {
    return this.program.methods
      .setWithdrawalAddress([...userId], new PublicKey(withdrawalAddress))
      .accountsStrict({
        admin: this.admin.publicKey,
        platform: this.platformPda,
        user: this.userPda(userId),
        eventAuthority: this.eventAuthority(),
        program: this.program.programId,
      })
      .rpc();
  }

  // ── Взносы ───────────────────────────────────────────────────────────────

  /**
   * Открывает инвестору адрес пополнения в кампании. Ренту за токен-счёт платит
   * оператор. Инструкция идемпотентна: повторный вызов ничего не ломает.
   */
  async openDeposit(
    campaignId: bigint,
    userId: Uint8Array,
    mintAddress: string,
  ): Promise<TransactionSignature> {
    const deal = this.dealPda(campaignId);
    const owner = this.depositOwnerPda(deal, userId);
    const mint = new PublicKey(mintAddress);

    return this.program.methods
      .openDeposit(new BN(campaignId.toString()), [...userId])
      .accountsStrict({
        operator: this.operator.publicKey,
        platform: this.platformPda,
        deal,
        user: this.userPda(userId),
        depositOwner: owner,
        mint,
        depositToken: this.ata(owner, mint),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        eventAuthority: this.eventAuthority(),
        program: this.program.programId,
      })
      .signers([this.operator])
      .rpc();
  }

  /**
   * Зачисляет то, что лежит на адресе пополнения. Сколько именно — решает
   * контракт: `min(баланс, hard_cap − собрано, max_ticket − вложено)`.
   * Остаток остаётся на адресе, забрать его может только сам инвестор.
   */
  async invest(
    campaignId: bigint,
    userId: Uint8Array,
    mintAddress: string,
  ): Promise<TransactionSignature> {
    const deal = this.dealPda(campaignId);
    const owner = this.depositOwnerPda(deal, userId);
    const mint = new PublicKey(mintAddress);

    return this.program.methods
      .invest(new BN(campaignId.toString()), [...userId])
      .accountsStrict({
        operator: this.operator.publicKey,
        platform: this.platformPda,
        deal,
        user: this.userPda(userId),
        position: this.positionPda(deal, userId),
        depositOwner: owner,
        depositToken: this.ata(owner, mint),
        vault: this.ata(deal, mint),
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        eventAuthority: this.eventAuthority(),
        program: this.program.programId,
      })
      .signers([this.operator])
      .rpc();
  }

  /** Возвращает инвестору остаток с адреса пополнения на его адрес вывода. */
  async withdrawDeposit(
    campaignId: bigint,
    userId: Uint8Array,
    mintAddress: string,
    withdrawalAddress: string,
  ): Promise<TransactionSignature> {
    const deal = this.dealPda(campaignId);
    const owner = this.depositOwnerPda(deal, userId);
    const mint = new PublicKey(mintAddress);
    const withdrawal = new PublicKey(withdrawalAddress);

    return this.program.methods
      .withdrawDeposit(new BN(campaignId.toString()), [...userId])
      .accountsStrict({
        operator: this.operator.publicKey,
        platform: this.platformPda,
        deal,
        user: this.userPda(userId),
        depositOwner: owner,
        depositToken: this.ata(owner, mint),
        withdrawalOwner: withdrawal,
        destination: this.ata(withdrawal, mint),
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        eventAuthority: this.eventAuthority(),
        program: this.program.programId,
      })
      .signers([this.operator])
      .rpc();
  }

  /** Позиция инвестора в кампании. Её может ещё не быть — это не ошибка. */
  async position(
    campaignId: bigint,
    userId: Uint8Array,
  ): Promise<OnchainPosition | null> {
    const address = this.positionPda(this.dealPda(campaignId), userId);
    const account = await this.program.account.position.fetchNullable(address);
    return account ? this.toPosition(address, account) : null;
  }

  /**
   * Все позиции кампании. Фильтр по полю `deal` в позиции: дискриминатор
   * занимает 8 байт, дальше сразу адрес сделки. Это и есть состав инвесторов,
   * каким его видно в блокчейне, — без имён и без нашей базы.
   */
  async campaignPositions(campaignId: bigint): Promise<OnchainPosition[]> {
    const deal = this.dealPda(campaignId);
    const accounts = await this.program.account.position.all([
      { memcmp: { offset: 8, bytes: deal.toBase58() } },
    ]);
    return accounts
      .map((item) => this.toPosition(item.publicKey, item.account))
      .filter((position) => position.principal > 0n)
      .sort((a, b) => (a.principal < b.principal ? 1 : -1));
  }

  /** Остаток на токен-счёте. Счёта может не быть — это не ошибка. */
  async tokenBalance(address: PublicKey | string): Promise<bigint> {
    const balance = await this.connection
      .getTokenAccountBalance(new PublicKey(address))
      .catch(() => null);
    return balance ? BigInt(balance.value.amount) : 0n;
  }

  /**
   * Кто последним перевёл деньги на счёт. Нужно для проверки происхождения
   * средств. Работает по последним подписям и разбирает переводы; если разобрать
   * не удалось, возвращает null — зачисление из-за этого не задерживаем.
   */
  async lastSender(address: PublicKey | string): Promise<string | null> {
    const account = new PublicKey(address);
    try {
      const signatures = await this.connection.getSignaturesForAddress(
        account,
        {
          limit: 5,
        },
      );
      for (const { signature } of signatures) {
        const tx = await this.connection.getParsedTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        });
        const instructions =
          tx?.transaction.message.instructions.filter(
            (item) => 'parsed' in item,
          ) ?? [];
        for (const item of instructions) {
          const parsed = (
            item as {
              parsed?: { type?: string; info?: Record<string, string> };
            }
          ).parsed;
          const type = parsed?.type;
          if (type !== 'transfer' && type !== 'transferChecked') continue;
          if (parsed?.info?.destination !== account.toBase58()) continue;
          return parsed.info.authority ?? parsed.info.source ?? null;
        }
      }
    } catch (error) {
      this.logger.warn(
        `Отправителя для ${account.toBase58()} не найти: ${String(error)}`,
      );
    }
    return null;
  }

  /**
   * Забирает инвестору то, что ему причитается: тело, проценты, пеню и
   * комиссию за досрочное погашение. Контракт сдвигает чекпоинты позиции
   * до перевода, поэтому повторный вызов ничего не задваивает.
   */
  async withdrawPayout(
    campaignId: bigint,
    userId: Uint8Array,
    mintAddress: string,
    withdrawalAddress: string,
  ): Promise<TransactionSignature> {
    return this.program.methods
      .withdrawPayout(new BN(campaignId.toString()), [...userId])
      .accountsStrict(
        this.withdrawAccounts(
          campaignId,
          userId,
          mintAddress,
          withdrawalAddress,
        ),
      )
      .signers([this.operator])
      .rpc();
  }

  /** Возврат взноса, когда сбор не состоялся. */
  async withdrawRefund(
    campaignId: bigint,
    userId: Uint8Array,
    mintAddress: string,
    withdrawalAddress: string,
  ): Promise<TransactionSignature> {
    return this.program.methods
      .withdrawRefund(new BN(campaignId.toString()), [...userId])
      .accountsStrict(
        this.withdrawAccounts(
          campaignId,
          userId,
          mintAddress,
          withdrawalAddress,
        ),
      )
      .signers([this.operator])
      .rpc();
  }

  /** Общий набор аккаунтов: выплата и возврат берут деньги из волта кампании. */
  private withdrawAccounts(
    campaignId: bigint,
    userId: Uint8Array,
    mintAddress: string,
    withdrawalAddress: string,
  ) {
    const deal = this.dealPda(campaignId);
    const mint = new PublicKey(mintAddress);
    const withdrawal = new PublicKey(withdrawalAddress);
    return {
      operator: this.operator.publicKey,
      platform: this.platformPda,
      deal,
      user: this.userPda(userId),
      position: this.positionPda(deal, userId),
      withdrawalOwner: withdrawal,
      destination: this.ata(withdrawal, mint),
      vault: this.ata(deal, mint),
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      eventAuthority: this.eventAuthority(),
      program: this.program.programId,
    };
  }

  // ── Закрытие сбора и погашение ───────────────────────────────────────────

  /**
   * Закрывает сбор после дедлайна. Подписывает оператор: сумма займа уходит
   * заёмщику одной транзакцией и обратно не возвращается, поэтому контракт
   * требует ключ, которым платформа подтверждает адрес получения.
   *
   * Если минимум не собран или график не зафиксирован — кампания становится
   * `Failed`, деньги остаются в волте, и инвесторы забирают их сами.
   */
  async closeFunding(
    campaignId: bigint,
    mintAddress: string,
    borrowerWallet: string,
  ): Promise<TransactionSignature> {
    const deal = this.dealPda(campaignId);
    const mint = new PublicKey(mintAddress);
    const borrower = new PublicKey(borrowerWallet);
    const { treasury } = await this.platform();

    return this.program.methods
      .closeFunding(new BN(campaignId.toString()))
      .accountsStrict({
        operator: this.operator.publicKey,
        platform: this.platformPda,
        deal,
        vault: this.ata(deal, mint),
        mint,
        borrowerWallet: borrower,
        payoutDestination: this.ata(borrower, mint),
        treasuryToken: this.ata(new PublicKey(treasury), mint),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        eventAuthority: this.eventAuthority(),
        program: this.program.programId,
      })
      .signers([this.operator])
      .rpc();
  }

  /**
   * Меняет кошелёк получения, пока кампания в сборе — в том числе после
   * дедлайна, до закрытия. Для случаев «заёмщик потерял доступ к кошельку»
   * и «биржа сменила депозитный адрес».
   */
  setBorrowerWallet(
    campaignId: bigint,
    wallet: string,
  ): Promise<TransactionSignature> {
    return this.program.methods
      .setBorrowerWallet(new BN(campaignId.toString()))
      .accountsStrict({
        admin: this.admin.publicKey,
        platform: this.platformPda,
        deal: this.dealPda(campaignId),
        borrowerWallet: new PublicKey(wallet),
        eventAuthority: this.eventAuthority(),
        program: this.program.programId,
      })
      .rpc();
  }

  /**
   * Забирает деньги с адреса погашения и распределяет их инвесторам.
   *
   * Подписант решает, сколько контракт возьмёт: обычный ключ проводит только
   * уже причитающееся, оператор — ещё и аванс в счёт ненаступивших платежей.
   * Поэтому по умолчанию подписывает admin, и излишек остаётся ждать на адресе,
   * а оператора зовём только когда заёмщик сам просит зачесть аванс.
   */
  async processRepayment(
    campaignId: bigint,
    mintAddress: string,
    { asOperator = false }: { asOperator?: boolean } = {},
  ): Promise<TransactionSignature> {
    const deal = this.dealPda(campaignId);
    const mint = new PublicKey(mintAddress);
    const repayOwner = this.repayOwnerPda(deal);
    const caller = asOperator ? this.operator : this.admin;
    const { treasury } = await this.platform();

    const call = this.program.methods
      .processRepayment(new BN(campaignId.toString()))
      .accountsStrict({
        caller: caller.publicKey,
        platform: this.platformPda,
        deal,
        repayOwner,
        repayToken: this.ata(repayOwner, mint),
        vault: this.ata(deal, mint),
        treasuryToken: this.ata(new PublicKey(treasury), mint),
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        eventAuthority: this.eventAuthority(),
        program: this.program.programId,
      });
    return asOperator ? call.signers([this.operator]).rpc() : call.rpc();
  }

  /**
   * Досрочное погашение. Обе инструкции подписывает оператор и обе тянут с
   * адреса погашения **ровно** посчитанную сумму: частично исполненное
   * досрочное погашение не имеет смысла, поэтому при нехватке денег контракт
   * отказывает целиком, а излишек остаётся ждать на адресе.
   */
  async prepayFull(
    campaignId: bigint,
    mintAddress: string,
  ): Promise<TransactionSignature> {
    return this.program.methods
      .prepayFull(new BN(campaignId.toString()))
      .accountsStrict(this.prepayAccounts(campaignId, mintAddress))
      .signers([this.operator])
      .rpc();
  }

  /** Частичное: гасится `amount` тела, график оставшихся платежей пересчитывается. */
  async prepayPartial(
    campaignId: bigint,
    mintAddress: string,
    amount: bigint,
  ): Promise<TransactionSignature> {
    return this.program.methods
      .prepayPartial(new BN(campaignId.toString()), new BN(amount.toString()))
      .accountsStrict(this.prepayAccounts(campaignId, mintAddress))
      .signers([this.operator])
      .rpc();
  }

  /** Счёт казны здесь не нужен: комиссия за досрочное достаётся инвесторам. */
  private prepayAccounts(campaignId: bigint, mintAddress: string) {
    const deal = this.dealPda(campaignId);
    const mint = new PublicKey(mintAddress);
    const repayOwner = this.repayOwnerPda(deal);
    return {
      operator: this.operator.publicKey,
      platform: this.platformPda,
      deal,
      repayOwner,
      repayToken: this.ata(repayOwner, mint),
      vault: this.ata(deal, mint),
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      eventAuthority: this.eventAuthority(),
      program: this.program.programId,
    };
  }

  // ── Дефолт и взыскание ───────────────────────────────────────────────────

  /**
   * Объявляет дефолт. Контракт пускает сюда **кого угодно** и сам проверяет,
   * что просрочка достигла порога: это защита инвесторов от бездействия
   * платформы. Мы подписываем обычным ключом.
   */
  markDefault(campaignId: bigint): Promise<TransactionSignature> {
    return this.program.methods
      .markDefault(new BN(campaignId.toString()))
      .accountsStrict({
        caller: this.admin.publicKey,
        platform: this.platformPda,
        deal: this.dealPda(campaignId),
        eventAuthority: this.eventAuthority(),
        program: this.program.programId,
      })
      .rpc();
  }

  /**
   * Записывает расходы на взыскание. Вносится после того, как платформа их
   * фактически оплатила: поступления в дефолте возмещают их первыми, поэтому
   * запись должна опережать распределение.
   */
  recordRecoveryCost(
    campaignId: bigint,
    amount: bigint,
  ): Promise<TransactionSignature> {
    return this.program.methods
      .recordRecoveryCost(
        new BN(campaignId.toString()),
        new BN(amount.toString()),
      )
      .accountsStrict({
        admin: this.admin.publicKey,
        platform: this.platformPda,
        deal: this.dealPda(campaignId),
        eventAuthority: this.eventAuthority(),
        program: this.program.programId,
      })
      .rpc();
  }

  /**
   * Отменяет сбор. Контракт разрешает это до дедлайна в любой момент, а после
   * — только когда прошёл льготный срок и закрыть сбор так и не удалось:
   * иначе деньги инвесторов застряли бы в волте навсегда.
   */
  cancelCampaign(campaignId: bigint): Promise<TransactionSignature> {
    return this.program.methods
      .cancelCampaign(new BN(campaignId.toString()))
      .accountsStrict({
        admin: this.admin.publicKey,
        platform: this.platformPda,
        deal: this.dealPda(campaignId),
        eventAuthority: this.eventAuthority(),
        program: this.program.programId,
      })
      .rpc();
  }

  // ── События ──────────────────────────────────────────────────────────────

  /**
   * События кампании из сети. Контракт эмитит их через `emit_cpi!`, то есть
   * они лежат во внутренних инструкциях транзакции, а не в логах: данные
   * начинаются с метки EVENT_IX_TAG, дальше — обычная запись события.
   * Читаем только то, что новее известной подписи.
   */
  async campaignEvents(
    campaignId: bigint,
    until?: string,
    limit = 50,
  ): Promise<OnchainEvent[]> {
    const signatures = await this.connection.getSignaturesForAddress(
      this.dealPda(campaignId),
      { until, limit },
    );
    const out: OnchainEvent[] = [];

    // От старых к новым: так порядок в базе совпадает с порядком в сети.
    for (const entry of [...signatures].reverse()) {
      if (entry.err) continue;
      const tx = await this.connection.getTransaction(entry.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx?.meta) continue;

      const keys = tx.transaction.message
        .getAccountKeys({
          accountKeysFromLookups: tx.meta.loadedAddresses,
        })
        .staticAccountKeys.map((key) => key.toBase58());
      let index = 0;
      for (const group of tx.meta.innerInstructions ?? []) {
        for (const inner of group.instructions) {
          if (keys[inner.programIdIndex] !== this.programAddress) continue;
          const data = Buffer.from(bs58.decode(inner.data));
          if (data.length < 16 || !data.subarray(0, 8).equals(EVENT_IX_TAG)) {
            continue;
          }
          const event = this.program.coder.events.decode(
            data.subarray(8).toString('base64'),
          );
          if (!event) continue;
          out.push({
            signature: entry.signature,
            slot: entry.slot,
            blockTime: entry.blockTime ?? null,
            index: index++,
            // Anchor отдаёт имя с маленькой буквы; приводим к тому виду,
            // в каком событие названо в контракте.
            name: event.name[0].toUpperCase() + event.name.slice(1),
            payload: plain(event.data),
          });
        }
      }
    }
    return out;
  }

  // ── Публикация ───────────────────────────────────────────────────────────

  async createCampaign(
    campaignId: bigint,
    params: CampaignParams,
  ): Promise<TransactionSignature> {
    const deal = this.dealPda(campaignId);
    const repayOwner = this.repayOwnerPda(deal);
    const mint = new PublicKey(params.mint);

    return this.program.methods
      .createCampaign(new BN(campaignId.toString()), {
        softCap: new BN(params.softCap.toString()),
        hardCap: new BN(params.hardCap.toString()),
        minTicket: new BN(params.minTicket.toString()),
        maxTicket: new BN(params.maxTicket.toString()),
        fundingStart: new BN(params.fundingStart),
        fundingDeadline: new BN(params.fundingDeadline),
        scheduleType:
          params.scheduleKind === 'ANNUITY' ? { annuity: {} } : { coupon: {} },
        annualRateBps: params.annualRateBps,
        periodsPerYear: params.periodsPerYear,
        penaltyRateBps: params.penaltyRateBps,
        defaultThresholdDays: params.defaultThresholdDays,
        prepaymentFeeBps: params.prepaymentFeeBps,
        platformFeeBps: params.platformFeeBps,
        cancelGraceDays: params.cancelGraceDays,
      })
      .accountsStrict({
        admin: this.admin.publicKey,
        platform: this.platformPda,
        deal,
        mint,
        borrowerWallet: new PublicKey(params.borrowerWallet),
        repayOwner,
        vault: this.ata(deal, mint),
        repayToken: this.ata(repayOwner, mint),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        eventAuthority: this.eventAuthority(),
        program: this.program.programId,
      })
      .rpc();
  }

  async addPeriods(
    campaignId: bigint,
    periods: PeriodInput[],
  ): Promise<TransactionSignature> {
    return this.program.methods
      .addSchedulePeriods(
        new BN(campaignId.toString()),
        periods.map((period) => ({
          dueTs: new BN(period.dueTs),
          principalFraction: new BN(period.principalFraction.toString()),
        })),
      )
      .accountsStrict({
        admin: this.admin.publicKey,
        platform: this.platformPda,
        deal: this.dealPda(campaignId),
        eventAuthority: this.eventAuthority(),
        program: this.program.programId,
      })
      .rpc();
  }

  async finalizeSchedule(campaignId: bigint): Promise<TransactionSignature> {
    return this.program.methods
      .finalizeSchedule(new BN(campaignId.toString()))
      .accountsStrict({
        admin: this.admin.publicKey,
        platform: this.platformPda,
        deal: this.dealPda(campaignId),
        eventAuthority: this.eventAuthority(),
        program: this.program.programId,
      })
      .rpc();
  }

  /**
   * Разрешает токен платформе и заодно создаёт счёт казны под него.
   * Инструкция идемпотентна: повторный вызов только досоздаёт недостающий счёт.
   */
  async allowMint(mintAddress: string): Promise<TransactionSignature> {
    const platform = await this.platform();
    const treasury = new PublicKey(platform.treasury);
    const mint = new PublicKey(mintAddress);

    return this.program.methods
      .allowMint()
      .accountsStrict({
        admin: this.admin.publicKey,
        platform: this.platformPda,
        mint,
        treasury,
        treasuryToken: this.ata(treasury, mint),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        eventAuthority: this.eventAuthority(),
        program: this.program.programId,
      })
      .rpc();
  }

  async removeMint(mintAddress: string): Promise<TransactionSignature> {
    return this.program.methods
      .removeMint(new PublicKey(mintAddress))
      .accountsStrict({
        admin: this.admin.publicKey,
        platform: this.platformPda,
        eventAuthority: this.eventAuthority(),
        program: this.program.programId,
      })
      .rpc();
  }

  /**
   * Сведения о токене: число знаков нужно, чтобы суммы не разъехались в сто раз,
   * а владелец счёта показывает, классический это SPL Token или Token-2022.
   */
  async tokenInfo(mintAddress: string): Promise<{
    address: string;
    decimals: number;
    isToken2022: boolean;
    /** У Token-2022 бывают расширения, которые съедают часть перевода. */
    hasExtensions: boolean;
  }> {
    const mint = new PublicKey(mintAddress);
    const account = await this.connection.getAccountInfo(mint);
    if (!account) throw new Error('Адрес не найден в сети');

    const owner = account.owner.toBase58();
    const isToken2022 = owner === TOKEN_2022_PROGRAM_ID.toBase58();
    if (owner !== TOKEN_PROGRAM_ID.toBase58() && !isToken2022) {
      throw new Error('Это не токен: аккаунт принадлежит другой программе');
    }
    // Размер классического минта — 82 байта; всё сверх этого у Token-2022 — расширения.
    if (account.data.length < 82) throw new Error('Это не токен');

    return {
      address: mintAddress,
      decimals: account.data[44],
      isToken2022,
      hasExtensions: account.data.length > 82,
    };
  }

  /** Баланс SOL: без него ключ не сможет подписать ни одной операции. */
  async solBalance(address: string): Promise<number> {
    const lamports = await this.connection.getBalance(new PublicKey(address));
    return lamports / 1e9;
  }

  /** Остаток токена на счёте казны; счёта может не быть — это не ошибка. */
  async treasuryBalance(
    treasury: string,
    mint: string,
  ): Promise<{ amount: string; decimals: number } | null> {
    const account = this.ata(new PublicKey(treasury), new PublicKey(mint));
    const balance = await this.connection
      .getTokenAccountBalance(account)
      .catch(() => null);
    if (!balance) return null;
    return { amount: balance.value.amount, decimals: balance.value.decimals };
  }

  get defaultMintAddress(): string {
    return this.defaultMint.toBase58();
  }

  get programAddress(): string {
    return this.program.programId.toBase58();
  }

  explorerAddress(address: string): string {
    return `https://explorer.solana.com/address/${address}${this.explorerSuffix}`;
  }

  explorerTx(signature: string): string {
    return `https://explorer.solana.com/tx/${signature}${this.explorerSuffix}`;
  }

  private get explorerSuffix(): string {
    return this.cluster === 'mainnet-beta' ? '' : `?cluster=${this.cluster}`;
  }
}
