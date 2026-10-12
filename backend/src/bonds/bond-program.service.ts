import { readFileSync } from 'node:fs';
import * as anchor from '@coral-xyz/anchor';
import { AnchorProvider, BN, Program, Wallet } from '@coral-xyz/anchor';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  type TransactionSignature,
} from '@solana/web3.js';
import idl from '../solana/idl/dala_actions.json' with { type: 'json' };
import type { DalaActions } from '../solana/idl/dala_actions.js';

const TOKEN_2022_PROGRAM_ID = new PublicKey(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

/** Выпуск облигации, как он лежит в сети. */
export interface BondRegistry {
  address: string;
  mint: string;
  campaignId: bigint;
  faceValue: bigint;
  couponRateBps: number;
  couponsPerYear: number;
  maturityTs: number;
  maxSupply: bigint;
  issued: bigint;
  outstanding: bigint;
  status: 'active' | 'defaulted' | 'redeemed' | 'cancelled';
  /** Идентификатор по ISO 6166; пусто, пока не присвоен. */
  isin: string;
}

/** Корпоративное действие из журнала. */
export interface OnchainAction {
  index: number;
  kind: string;
  recordTs: number;
  paymentTs: number;
  amountPerUnit: bigint;
  holders: number;
  units: bigint;
  totalAmount: bigint;
  registerHash: string;
  settlement: string | null;
  votesFor: bigint;
  votesAgainst: bigint;
  status: string;
}

/** Строка реестра держателей, прочитанная из сети. */
export interface OnchainHolder {
  holder: string;
  tokenAccount: string;
  units: bigint;
}

export type ActionKind =
  'record' | 'coupon' | 'redemption' | 'vote' | 'default' | 'recovery';

/**
 * Клиент программы `dala_actions`: бумага и журнал корпоративных действий.
 *
 * Отдельно от `SolanaService` намеренно — это другая программа со своим
 * жизненным циклом. Ключи те же самые: админ выпускает и объявляет, оператор
 * ведёт кранки.
 */
@Injectable()
export class BondProgramService implements OnModuleInit {
  private readonly logger = new Logger(BondProgramService.name);
  private readonly connection: Connection;
  private readonly admin: Keypair;
  private readonly operator: Keypair;
  readonly cluster: string;
  private program!: Program<DalaActions>;

  constructor(config: ConfigService) {
    this.connection = new Connection(
      config.get<string>('SOLANA_RPC_URL') ?? 'https://api.devnet.solana.com',
      'confirmed',
    );
    this.cluster = config.get<string>('SOLANA_CLUSTER') ?? 'devnet';
    this.admin = BondProgramService.readKeypair(
      config.getOrThrow<string>('SOLANA_ADMIN_KEYPAIR'),
    );
    this.operator = BondProgramService.readKeypair(
      config.getOrThrow<string>('SOLANA_OPERATOR_KEYPAIR'),
    );
  }

  private static readKeypair(file: string): Keypair {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(file, 'utf8')) as number[]),
    );
  }

  onModuleInit() {
    this.program = new Program<DalaActions>(
      idl as anchor.Idl as DalaActions,
      new AnchorProvider(this.connection, new Wallet(this.admin), {
        commitment: 'confirmed',
      }),
    );
    this.logger.log(
      `Корпоративные действия: программа ${this.program.programId.toBase58()} (${this.cluster})`,
    );
  }

  // ── Адреса ───────────────────────────────────────────────────────────────

  registryPda(campaignId: bigint): PublicKey {
    const id = Buffer.alloc(8);
    id.writeBigUInt64LE(campaignId);
    return PublicKey.findProgramAddressSync(
      [Buffer.from('registry'), id],
      this.program.programId,
    )[0];
  }

  mintPda(campaignId: bigint): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('bond'), this.registryPda(campaignId).toBuffer()],
      this.program.programId,
    )[0];
  }

  actionPda(campaignId: bigint, index: number): PublicKey {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(index);
    return PublicKey.findProgramAddressSync(
      [Buffer.from('action'), this.registryPda(campaignId).toBuffer(), bytes],
      this.program.programId,
    )[0];
  }

  /** Счёт держателя: ATA под Token-2022, он же создаётся при выпуске бумаг. */
  holderToken(campaignId: bigint, holder: string): PublicKey {
    const mint = this.mintPda(campaignId);
    return PublicKey.findProgramAddressSync(
      [
        new PublicKey(holder).toBuffer(),
        TOKEN_2022_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )[0];
  }

  explorerAddress(address: string): string {
    return `https://explorer.solana.com/address/${address}${this.explorerSuffix}`;
  }

  explorerTx(signature: string): string {
    return `https://explorer.solana.com/tx/${signature}${this.explorerSuffix}`;
  }

  /**
   * Минт бумаги открываем на вкладке расширений: там видно заморозку счетов,
   * постоянного делегата и метаданные выпуска — то, ради чего она и Token-2022.
   */
  explorerToken(mint: string): string {
    return `https://explorer.solana.com/address/${mint}/token-extensions${this.explorerSuffix}`;
  }

  private get explorerSuffix(): string {
    return this.cluster === 'mainnet-beta' ? '' : `?cluster=${this.cluster}`;
  }

  // ── Чтение ───────────────────────────────────────────────────────────────

  /** Выпуск из сети или null, если по кампании бумага не выпускалась. */
  async registry(campaignId: bigint): Promise<BondRegistry | null> {
    const address = this.registryPda(campaignId);
    const account = await this.program.account.registry.fetchNullable(address);
    if (!account) return null;
    return {
      address: address.toBase58(),
      mint: account.mint.toBase58(),
      campaignId: BigInt(account.campaignId.toString()),
      faceValue: BigInt(account.faceValue.toString()),
      couponRateBps: account.couponRateBps,
      couponsPerYear: account.couponsPerYear,
      maturityTs: Number(account.maturityTs.toString()),
      maxSupply: BigInt(account.maxSupply.toString()),
      issued: BigInt(account.issued.toString()),
      outstanding: BigInt(account.outstanding.toString()),
      status: Object.keys(account.status)[0] as BondRegistry['status'],
      isin: account.isin,
    };
  }

  /** Все корпоративные действия выпуска, от новых к старым. */
  async actions(campaignId: bigint): Promise<OnchainAction[]> {
    const registry = this.registryPda(campaignId);
    const accounts = await this.program.account.actionRecord.all([
      { memcmp: { offset: 8, bytes: registry.toBase58() } },
    ]);
    return accounts
      .map((item) => this.toAction(item.account))
      .sort((a, b) => b.index - a.index);
  }

  async action(
    campaignId: bigint,
    index: number,
  ): Promise<OnchainAction | null> {
    const account = await this.program.account.actionRecord.fetchNullable(
      this.actionPda(campaignId, index),
    );
    return account ? this.toAction(account) : null;
  }

  private toAction(account: {
    index: number;
    kind: Record<string, unknown>;
    recordTs: anchor.BN;
    paymentTs: anchor.BN;
    amountPerUnit: anchor.BN;
    holders: number;
    units: anchor.BN;
    totalAmount: anchor.BN;
    registerHash: number[];
    settlement: number[];
    votesFor: anchor.BN;
    votesAgainst: anchor.BN;
    status: Record<string, unknown>;
  }): OnchainAction {
    const signature = Buffer.from(account.settlement);
    return {
      index: account.index,
      kind: Object.keys(account.kind)[0],
      recordTs: Number(account.recordTs.toString()),
      paymentTs: Number(account.paymentTs.toString()),
      amountPerUnit: BigInt(account.amountPerUnit.toString()),
      holders: account.holders,
      units: BigInt(account.units.toString()),
      totalAmount: BigInt(account.totalAmount.toString()),
      registerHash: Buffer.from(account.registerHash).toString('hex'),
      // Пустая подпись — действие ещё не исполнено.
      settlement: signature.every((byte) => byte === 0)
        ? null
        : anchor.utils.bytes.bs58.encode(signature),
      votesFor: BigInt(account.votesFor.toString()),
      votesAgainst: BigInt(account.votesAgainst.toString()),
      status: Object.keys(account.status)[0],
    };
  }

  /**
   * Реестр держателей: остатки читаются из сети, список кандидатов приходит
   * от платформы как от регистратора.
   *
   * Обойтись одним запросом по минту не вышло: публичные RPC не отдают
   * `getProgramAccounts` по Token-2022 (программа исключена из вторичных
   * индексов), а `getTokenLargestAccounts` режут по частоте. Зато регистратор
   * и так знает, кому выпускал бумаги, — остаётся прочитать их счета, и это
   * один запрос на сотню адресов. Сами остатки всё равно из сети, а не из
   * нашей базы: подменить их мы не можем.
   */
  async holders(
    campaignId: bigint,
    candidates: string[],
  ): Promise<OnchainHolder[]> {
    if (candidates.length === 0) return [];
    const unique = [...new Set(candidates)];
    const addresses = unique.map((owner) =>
      this.holderToken(campaignId, owner),
    );
    const accounts = await this.connection.getMultipleAccountsInfo(addresses);

    return unique
      .map((holder, index) => {
        const account = accounts[index];
        if (!account) return null;
        return {
          holder,
          tokenAccount: addresses[index].toBase58(),
          units: account.data.readBigUInt64LE(64),
        };
      })
      .filter((row): row is OnchainHolder => row !== null && row.units > 0n)
      .sort((a, b) => (a.units < b.units ? 1 : -1));
  }

  /** Сколько всего бумаг в обращении по данным самого минта. */
  async supply(campaignId: bigint): Promise<bigint> {
    const result = await this.connection
      .getTokenSupply(this.mintPda(campaignId))
      .catch(() => null);
    return result ? BigInt(result.value.amount) : 0n;
  }

  // ── Бумага ───────────────────────────────────────────────────────────────

  /** Выпускает облигацию: минт с условиями в метаданных и реестр. */
  issueBond(
    campaignId: bigint,
    params: {
      faceValue: bigint;
      couponRateBps: number;
      couponsPerYear: number;
      maturityTs: number;
      maxSupply: bigint;
      paymentMint: string;
      name: string;
      symbol: string;
      uri: string;
      isin: string;
    },
  ): Promise<TransactionSignature> {
    return this.program.methods
      .issueBond(new BN(campaignId.toString()), {
        faceValue: new BN(params.faceValue.toString()),
        couponRateBps: params.couponRateBps,
        couponsPerYear: params.couponsPerYear,
        maturityTs: new BN(params.maturityTs),
        maxSupply: new BN(params.maxSupply.toString()),
        paymentMint: new PublicKey(params.paymentMint),
        operator: this.operator.publicKey,
        name: params.name,
        symbol: params.symbol,
        uri: params.uri,
        isin: params.isin,
      })
      .accountsStrict({
        authority: this.admin.publicKey,
        registry: this.registryPda(campaignId),
        mint: this.mintPda(campaignId),
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Выдаёт бумаги держателю — сразу после зачтённого взноса. */
  mintToHolder(
    campaignId: bigint,
    holder: string,
    units: bigint,
  ): Promise<TransactionSignature> {
    return this.program.methods
      .mintToHolder(new BN(campaignId.toString()), new BN(units.toString()))
      .accountsStrict(this.holderAccounts(campaignId, holder))
      .signers([this.operator])
      .rpc();
  }

  /** Гасит бумаги: возврат взноса (`redemption = false`) или погашение. */
  burnFromHolder(
    campaignId: bigint,
    holder: string,
    units: bigint,
    redemption: boolean,
  ): Promise<TransactionSignature> {
    return this.program.methods
      .burnFromHolder(
        new BN(campaignId.toString()),
        new BN(units.toString()),
        redemption,
      )
      .accountsStrict(this.holderAccounts(campaignId, holder))
      .signers([this.operator])
      .rpc();
  }

  /**
   * Переносит бумаги с одного адреса держателя на другой **одной
   * транзакцией**: прожиг и выпуск идут в ней двумя инструкциями.
   *
   * Двумя транзакциями делать нельзя. Если вторая не подтвердится — а на
   * сети это бывает, таймаут подтверждения ничего не говорит о судьбе
   * транзакции, — бумаги окажутся сожжены и не выпущены, и держатель
   * останется без доказательства права. Так однажды и случилось на стенде.
   */
  async moveHolder(
    campaignId: bigint,
    from: string,
    to: string,
    units: bigint,
  ): Promise<TransactionSignature> {
    const amount = new BN(units.toString());
    const id = new BN(campaignId.toString());
    const burn = await this.program.methods
      .burnFromHolder(id, amount, false)
      .accountsStrict(this.holderAccounts(campaignId, from))
      .instruction();
    const mint = await this.program.methods
      .mintToHolder(id, amount)
      .accountsStrict(this.holderAccounts(campaignId, to))
      .instruction();

    const transaction = new Transaction().add(burn, mint);
    return sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.operator],
      { commitment: 'confirmed' },
    );
  }

  private holderAccounts(campaignId: bigint, holder: string) {
    return {
      operator: this.operator.publicKey,
      registry: this.registryPda(campaignId),
      mint: this.mintPda(campaignId),
      holder: new PublicKey(holder),
      holderToken: this.holderToken(campaignId, holder),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  }

  /** Переводит выпуск во взыскание и обратно. */
  setBondStatus(
    campaignId: bigint,
    defaulted: boolean,
  ): Promise<TransactionSignature> {
    return this.program.methods
      .setBondStatus(new BN(campaignId.toString()), defaulted)
      .accountsStrict({
        authority: this.admin.publicKey,
        registry: this.registryPda(campaignId),
      })
      .rpc();
  }

  /**
   * Аннулирует выпуск: сбор не состоялся, бумаги сожжены без погашения.
   * Контракт требует, чтобы в обращении уже ничего не было.
   */
  cancelBond(campaignId: bigint): Promise<TransactionSignature> {
    return this.program.methods
      .cancelBond(new BN(campaignId.toString()))
      .accountsStrict({
        authority: this.admin.publicKey,
        registry: this.registryPda(campaignId),
      })
      .rpc();
  }

  // ── Журнал действий ──────────────────────────────────────────────────────

  declareAction(
    campaignId: bigint,
    index: number,
    kind: ActionKind,
    recordTs: number,
    paymentTs: number,
    amountPerUnit: bigint,
  ): Promise<TransactionSignature> {
    return this.program.methods
      .declareAction(
        new BN(campaignId.toString()),
        index,
        { [kind]: {} } as never,
        new BN(recordTs),
        new BN(paymentTs),
        new BN(amountPerUnit.toString()),
      )
      .accountsStrict({
        authority: this.admin.publicKey,
        registry: this.registryPda(campaignId),
        action: this.actionPda(campaignId, index),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  recordSnapshot(
    campaignId: bigint,
    index: number,
    holders: number,
    units: bigint,
    totalAmount: bigint,
    registerHash: Buffer,
  ): Promise<TransactionSignature> {
    return this.program.methods
      .recordSnapshot(
        new BN(campaignId.toString()),
        index,
        holders,
        new BN(units.toString()),
        new BN(totalAmount.toString()),
        [...registerHash],
      )
      .accountsStrict({
        operator: this.operator.publicKey,
        registry: this.registryPda(campaignId),
        action: this.actionPda(campaignId, index),
      })
      .signers([this.operator])
      .rpc();
  }

  settleAction(
    campaignId: bigint,
    index: number,
    settlement: string | null,
    votesFor = 0n,
    votesAgainst = 0n,
  ): Promise<TransactionSignature> {
    // Подпись расчётной транзакции — 64 байта; у действий без денег нули.
    const bytes = settlement
      ? [...anchor.utils.bytes.bs58.decode(settlement)]
      : Array.from({ length: 64 }, () => 0);
    return this.program.methods
      .settleAction(
        new BN(campaignId.toString()),
        index,
        bytes,
        new BN(votesFor.toString()),
        new BN(votesAgainst.toString()),
      )
      .accountsStrict({
        operator: this.operator.publicKey,
        registry: this.registryPda(campaignId),
        action: this.actionPda(campaignId, index),
      })
      .signers([this.operator])
      .rpc();
  }

  closeAction(
    campaignId: bigint,
    index: number,
  ): Promise<TransactionSignature> {
    return this.program.methods
      .closeAction(new BN(campaignId.toString()), index)
      .accountsStrict({
        authority: this.admin.publicKey,
        registry: this.registryPda(campaignId),
        action: this.actionPda(campaignId, index),
      })
      .rpc();
  }
}
