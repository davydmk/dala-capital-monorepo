/**
 * Тестовое окружение: программа загружается в LiteSVM, время управляется вручную.
 * Инструкции собираются Anchor-клиентом, отправляются через @solana/kit.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  AccountLayout,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  MintLayout,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  KeyPairSigner,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { FailedTransactionMetadata, LiteSVM, TransactionMetadata } from "litesvm";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { DalaCapital } from "../target/types/dala_capital";

const ROOT = path.resolve(__dirname, "..");
const IDL = JSON.parse(fs.readFileSync(path.join(ROOT, "target/idl/dala_capital.json"), "utf8"));
const SO_PATH = path.join(ROOT, "target/deploy/dala_capital.so");

export const program = new Program<DalaCapital>(
  IDL,
  new anchor.AnchorProvider(
    new Connection("http://127.0.0.1:8899"),
    new anchor.Wallet(Keypair.generate()),
    {}
  )
);
export const PROGRAM_ID = program.programId;

export const USDC = 1_000_000n;
export const DAY = 86_400;
export const MONTH = 30 * DAY;
export const SCALE = 1_000_000_000_000n;
export const T0 = 1_750_000_000;

// ── Преобразования ─────────────────────────────────────────────────────────

export const bn = (x: bigint | number) => new BN(x.toString());
export const big = (x: BN | number | bigint) => BigInt(x.toString());
export const pk = (s: KeyPairSigner) => new PublicKey(s.address);
export const usdc = (x: number) => BigInt(Math.round(x * 1_000_000));

export function newUserId(): number[] {
  return Array.from(Keypair.generate().publicKey.toBytes().slice(0, 16));
}

function u64le(x: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(x));
  return b;
}

// ── PDA ────────────────────────────────────────────────────────────────────

const pda = (seeds: (Buffer | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

export const platformPda = () => pda([Buffer.from("platform")]);
export const eventAuthority = () => pda([Buffer.from("__event_authority")]);
export const dealPda = (id: bigint | number) =>
  pda([Buffer.from("deal"), platformPda().toBuffer(), u64le(id)]);
export const userPda = (userId: number[]) =>
  pda([Buffer.from("user"), platformPda().toBuffer(), Buffer.from(userId)]);
export const positionPda = (deal: PublicKey, userId: number[]) =>
  pda([Buffer.from("pos"), deal.toBuffer(), Buffer.from(userId)]);
export const depositOwnerPda = (deal: PublicKey, userId: number[]) =>
  pda([Buffer.from("deposit"), deal.toBuffer(), Buffer.from(userId)]);
export const repayOwnerPda = (deal: PublicKey) =>
  pda([Buffer.from("repay"), deal.toBuffer()]);
export const ata = (mint: PublicKey, owner: PublicKey) =>
  getAssociatedTokenAddressSync(mint, owner, true);

/** Аккаунты, общие для всех инструкций с событиями. */
export const common = () => ({
  eventAuthority: eventAuthority(),
  program: PROGRAM_ID,
});

// ── Параметры кампании и график ────────────────────────────────────────────

export type Schedule = "annuity" | "coupon";

export function annuityFractions(rateBps: number, periodsPerYear: number, n: number): bigint[] {
  const i = rateBps / 10_000 / periodsPerYear;
  const payment = i / (1 - Math.pow(1 + i, -n));
  let balance = 1;
  let sum = 0n;
  const out: bigint[] = [];
  for (let k = 0; k < n; k++) {
    const principal = payment - balance * i;
    balance -= principal;
    const fraction = k + 1 === n ? SCALE - sum : BigInt(Math.round(principal * 1e12));
    sum += fraction;
    out.push(fraction);
  }
  return out;
}

export function couponFractions(n: number): bigint[] {
  return Array.from({ length: n }, (_, k) => (k + 1 === n ? SCALE : 0n));
}

export interface CampaignOptions {
  id: bigint;
  schedule?: Schedule;
  softCap?: bigint;
  hardCap?: bigint;
  minTicket?: bigint;
  maxTicket?: bigint;
  fundingStart?: number;
  fundingDeadline?: number;
  rateBps?: number;
  periods?: number;
  penaltyBps?: number;
  thresholdDays?: number;
  prepaymentFeeBps?: number;
  platformFeeBps?: number;
  cancelGraceDays?: number;
  borrowerWallet?: PublicKey;
  periodsPerYear?: number;
  admin?: KeyPairSigner;
}

// ── События ────────────────────────────────────────────────────────────────

/** Префикс инструкции-события `emit_cpi!` (EVENT_IX_TAG в little-endian). */
const EVENT_IX_TAG = Buffer.from([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);

export interface DecodedEvent {
  name: string;
  data: any;
}

/** Достаёт события из внутренних инструкций транзакции. Имя — с маленькой буквы. */
export function events(result: TransactionMetadata): DecodedEvent[] {
  const out: DecodedEvent[] = [];
  for (const group of result.innerInstructions()) {
    for (const inner of group) {
      const data = Buffer.from(inner.instruction().data());
      if (data.length < 16 || !data.subarray(0, 8).equals(EVENT_IX_TAG)) continue;
      const event = program.coder.events.decode(data.subarray(8).toString("base64"));
      if (event) out.push({ name: event.name[0].toLowerCase() + event.name.slice(1), data: event.data });
    }
  }
  return out;
}

// ── Окружение ──────────────────────────────────────────────────────────────

export class Env {
  svm!: LiteSVM;
  admin!: KeyPairSigner;
  operator!: KeyPairSigner;
  whitelist!: KeyPairSigner;
  treasury!: KeyPairSigner;
  borrower!: KeyPairSigner;
  mint!: PublicKey;
  /** Размеры отправленных транзакций в байтах — для проверки лимита 1 232 байта. */
  txSizes: number[] = [];

  static async create(): Promise<Env> {
    const env = new Env();
    env.svm = new LiteSVM();
    env.svm.addProgramFromFile(address(PROGRAM_ID.toBase58()), SO_PATH);
    env.setTime(T0);

    env.admin = await env.newSigner();
    env.operator = await env.newSigner();
    env.whitelist = await env.newSigner();
    env.treasury = await generateKeyPairSigner();
    env.borrower = await generateKeyPairSigner();
    env.mint = env.createMint(6);

    await env.ok(env.admin, [
      await program.methods
        .initPlatform(pk(env.admin), pk(env.operator), pk(env.whitelist), pk(env.treasury))
        .accountsStrict({
          payer: pk(env.admin),
          platform: platformPda(),
          systemProgram: SystemProgram.programId,
          ...common(),
        })
        .instruction(),
    ]);
    await env.allowMint(env.mint);
    return env;
  }

  // ── Время, SOL, токены ───────────────────────────────────────────────────

  setTime(unix: number) {
    const clock = this.svm.getClock();
    clock.unixTimestamp = BigInt(unix);
    this.svm.setClock(clock);
  }

  now(): number {
    return Number(this.svm.getClock().unixTimestamp);
  }

  async newSigner(sol = 100): Promise<KeyPairSigner> {
    const signer = await generateKeyPairSigner();
    this.svm.airdrop(signer.address, lamports(BigInt(sol) * 1_000_000_000n));
    return signer;
  }

  createMint(decimals: number): PublicKey {
    const mint = Keypair.generate().publicKey;
    const data = Buffer.alloc(MINT_SIZE);
    MintLayout.encode(
      {
        mintAuthorityOption: 1,
        mintAuthority: Keypair.generate().publicKey,
        supply: 0n,
        decimals,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      data
    );
    this.setRaw(mint, TOKEN_PROGRAM_ID, data);
    return mint;
  }

  private setRaw(account: PublicKey, owner: PublicKey, data: Buffer) {
    this.svm.setAccount({
      address: address(account.toBase58()),
      data: new Uint8Array(data),
      executable: false,
      lamports: lamports(this.svm.minimumBalanceForRentExemption(BigInt(data.length))),
      programAddress: address(owner.toBase58()),
      space: BigInt(data.length),
    } as any);
  }

  /** Записывает токен-счёт с балансом напрямую — имитация перевода с внешнего кошелька или биржи. */
  setTokenAccount(account: PublicKey, mint: PublicKey, owner: PublicKey, amount: bigint, state = 1) {
    const data = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode(
      {
        mint,
        owner,
        amount,
        delegateOption: 0,
        delegate: PublicKey.default,
        state: 1,
        isNativeOption: 0,
        isNative: 0n,
        delegatedAmount: 0n,
        closeAuthorityOption: 0,
        closeAuthority: PublicKey.default,
      },
      data
    );
    // state: 1 — активен, 2 — заморожен эмитентом.
    data.writeUInt8(state, 108);
    this.setRaw(account, TOKEN_PROGRAM_ID, data);
  }

  exists(account: PublicKey): boolean {
    return this.svm.getAccount(address(account.toBase58())).exists;
  }

  balance(account: PublicKey): bigint {
    const acc = this.svm.getAccount(address(account.toBase58()));
    if (!acc.exists) return 0n;
    return AccountLayout.decode(Buffer.from(acc.data)).amount;
  }

  /** Добавляет токены на существующий токен-счёт. */
  topUp(account: PublicKey, amount: bigint) {
    const acc = this.svm.getAccount(address(account.toBase58()));
    if (!acc.exists) throw new Error(`токен-счёт ${account.toBase58()} не существует`);
    const decoded = AccountLayout.decode(Buffer.from(acc.data));
    this.setTokenAccount(account, decoded.mint, decoded.owner, decoded.amount + amount);
  }

  // ── Транзакции ───────────────────────────────────────────────────────────

  async send(
    feePayer: KeyPairSigner,
    ixs: TransactionInstruction[],
    signers: KeyPairSigner[] = []
  ): Promise<TransactionMetadata | FailedTransactionMetadata> {
    const all = [feePayer, ...signers];
    const kitIxs = ixs.map((ix) => ({
      programAddress: address(ix.programId.toBase58()),
      accounts: ix.keys.map((k) => {
        const addr = address(k.pubkey.toBase58());
        const role = k.isSigner
          ? k.isWritable
            ? AccountRole.WRITABLE_SIGNER
            : AccountRole.READONLY_SIGNER
          : k.isWritable
          ? AccountRole.WRITABLE
          : AccountRole.READONLY;
        const signer = all.find((s) => s.address === addr);
        return k.isSigner && signer ? { address: addr, role, signer } : { address: addr, role };
      }),
      data: new Uint8Array(ix.data),
    }));

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(feePayer, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: this.svm.latestBlockhash(), lastValidBlockHeight: 0n },
          m
        ),
      (m) => appendTransactionMessageInstructions(kitIxs as any, m)
    );
    const tx = await signTransactionMessageWithSigners(message as any);
    this.txSizes.push(Buffer.from(getBase64EncodedWireTransaction(tx as any), "base64").length);
    const result = this.svm.sendTransaction(tx as any);
    this.svm.expireBlockhash();
    return result;
  }

  async ok(feePayer: KeyPairSigner, ixs: TransactionInstruction[], signers: KeyPairSigner[] = []) {
    const result = await this.send(feePayer, ixs, signers);
    if (result instanceof FailedTransactionMetadata) {
      throw new Error(
        `транзакция упала: ${result.toString()}\n${result.meta().logs().join("\n")}`
      );
    }
    return result;
  }

  /** Транзакция должна упасть — без проверки конкретной ошибки (например, ошибки токен-программы). */
  async rejects(feePayer: KeyPairSigner, ixs: TransactionInstruction[], signers: KeyPairSigner[] = []) {
    const result = await this.send(feePayer, ixs, signers);
    expect(result, "ожидался отказ транзакции").to.be.instanceOf(FailedTransactionMetadata);
    return (result as FailedTransactionMetadata).meta().logs().join("\n");
  }

  async fails(
    errorName: string,
    feePayer: KeyPairSigner,
    ixs: TransactionInstruction[],
    signers: KeyPairSigner[] = []
  ) {
    const result = await this.send(feePayer, ixs, signers);
    expect(result, `ожидалась ошибка ${errorName}`).to.be.instanceOf(FailedTransactionMetadata);
    const logs = (result as FailedTransactionMetadata).meta().logs().join("\n");
    expect(logs, logs).to.include(`Error Code: ${errorName}`);
  }

  // ── Чтение аккаунтов ─────────────────────────────────────────────────────

  private decode(name: string, account: PublicKey): any {
    const acc = this.svm.getAccount(address(account.toBase58()));
    if (!acc.exists) throw new Error(`аккаунт ${name} ${account.toBase58()} не существует`);
    return program.coder.accounts.decode(name, Buffer.from(acc.data));
  }

  platform = () => this.decode("platform", platformPda());
  deal = (id: bigint) => this.decode("deal", dealPda(id));
  user = (userId: number[]) => this.decode("userAccount", userPda(userId));
  position = (id: bigint, userId: number[]) =>
    this.decode("position", positionPda(dealPda(id), userId));

  // ── Сценарные шаги ───────────────────────────────────────────────────────

  async allowMint(mint: PublicKey) {
    await this.ok(this.admin, [
      await program.methods
        .allowMint()
        .accountsStrict({
          admin: pk(this.admin),
          platform: platformPda(),
          mint,
          treasury: pk(this.treasury),
          treasuryToken: ata(mint, pk(this.treasury)),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          ...common(),
        })
        .instruction(),
    ]);
  }

  async createUser(withdrawal?: PublicKey, whitelisted = true) {
    const userId = newUserId();
    const owner = withdrawal ?? Keypair.generate().publicKey;
    await this.ok(this.whitelist, [
      await program.methods
        .createUser(userId, { individual: {} }, owner, whitelisted)
        .accountsStrict({
          whitelistAuthority: pk(this.whitelist),
          platform: platformPda(),
          user: userPda(userId),
          systemProgram: SystemProgram.programId,
          ...common(),
        })
        .instruction(),
    ]);
    return { userId, withdrawal: owner };
  }

  campaignIx(o: CampaignOptions) {
    const deal = dealPda(o.id);
    const schedule = o.schedule ?? "annuity";
    return program.methods
      .createCampaign(bn(o.id), {
        softCap: bn(o.softCap ?? 50_000n * USDC),
        hardCap: bn(o.hardCap ?? 100_000n * USDC),
        minTicket: bn(o.minTicket ?? 100n * USDC),
        maxTicket: bn(o.maxTicket ?? 0n),
        fundingStart: bn(o.fundingStart ?? T0),
        fundingDeadline: bn(o.fundingDeadline ?? T0 + 10 * DAY),
        scheduleType: schedule === "annuity" ? { annuity: {} } : { coupon: {} },
        annualRateBps: o.rateBps ?? 1_000,
        periodsPerYear: o.periodsPerYear ?? 12,
        penaltyRateBps: o.penaltyBps ?? 2_000,
        defaultThresholdDays: o.thresholdDays ?? (schedule === "annuity" ? 90 : 30),
        prepaymentFeeBps: o.prepaymentFeeBps ?? (schedule === "annuity" ? 100 : 0),
        platformFeeBps: o.platformFeeBps ?? 0,
        cancelGraceDays: o.cancelGraceDays ?? 7,
      } as any)
      .accountsStrict({
        admin: pk(o.admin ?? this.admin),
        platform: platformPda(),
        deal,
        mint: this.mint,
        borrowerWallet: o.borrowerWallet ?? pk(this.borrower),
        repayOwner: repayOwnerPda(deal),
        vault: ata(this.mint, deal),
        repayToken: ata(this.mint, repayOwnerPda(deal)),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        ...common(),
      })
      .instruction();
  }

  scheduleIx(id: bigint, periods: { dueTs: number; fraction: bigint }[], admin: KeyPairSigner = this.admin) {
    return program.methods
      .addSchedulePeriods(
        bn(id),
        periods.map((p) => ({ dueTs: bn(p.dueTs), principalFraction: bn(p.fraction) }))
      )
      .accountsStrict({
        admin: pk(admin),
        platform: platformPda(),
        deal: dealPda(id),
        ...common(),
      })
      .instruction();
  }

  finalizeIx(id: bigint) {
    return program.methods
      .finalizeSchedule(bn(id))
      .accountsStrict({ admin: pk(this.admin), platform: platformPda(), deal: dealPda(id), ...common() })
      .instruction();
  }

  /** Создаёт кампанию, загружает график частями по 20 платежей и фиксирует его. */
  async createCampaign(o: CampaignOptions) {
    const n = o.periods ?? 12;
    const schedule = o.schedule ?? "annuity";
    const fractions =
      schedule === "annuity" ? annuityFractions(o.rateBps ?? 1_000, 12, n) : couponFractions(n);
    const deadline = o.fundingDeadline ?? T0 + 10 * DAY;
    const periods = fractions.map((fraction, k) => ({ dueTs: deadline + MONTH * (k + 1), fraction }));

    await this.ok(this.admin, [await this.campaignIx(o)]);
    for (let i = 0; i < periods.length; i += 20) {
      await this.ok(this.admin, [await this.scheduleIx(o.id, periods.slice(i, i + 20))]);
    }
    await this.ok(this.admin, [await this.finalizeIx(o.id)]);
    return { deal: dealPda(o.id), periods };
  }

  openDepositIx(id: bigint, userId: number[]) {
    const deal = dealPda(id);
    const owner = depositOwnerPda(deal, userId);
    return program.methods
      .openDeposit(bn(id), userId)
      .accountsStrict({
        operator: pk(this.operator),
        platform: platformPda(),
        deal,
        user: userPda(userId),
        depositOwner: owner,
        mint: this.mint,
        depositToken: ata(this.mint, owner),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        ...common(),
      })
      .instruction();
  }

  depositAddress(id: bigint, userId: number[]) {
    return ata(this.mint, depositOwnerPda(dealPda(id), userId));
  }

  investIx(id: bigint, userId: number[], overrides: Record<string, PublicKey> = {}) {
    const deal = dealPda(id);
    const owner = depositOwnerPda(deal, userId);
    return program.methods
      .invest(bn(id), userId)
      .accountsStrict({
        operator: pk(this.operator),
        platform: platformPda(),
        deal,
        user: userPda(userId),
        position: positionPda(deal, userId),
        depositOwner: owner,
        depositToken: ata(this.mint, owner),
        vault: ata(this.mint, deal),
        mint: this.mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        ...common(),
        ...overrides,
      })
      .instruction();
  }

  /** Открывает адрес пополнения, пополняет его и зачисляет в кампанию. */
  async deposit(id: bigint, userId: number[], amount: bigint) {
    const depositToken = this.depositAddress(id, userId);
    if (!this.exists(depositToken)) {
      await this.ok(this.operator, [await this.openDepositIx(id, userId)]);
    }
    this.topUp(depositToken, amount);
    await this.ok(this.operator, [await this.investIx(id, userId)]);
  }

  closeFundingIx(id: bigint, caller: KeyPairSigner, overrides: Record<string, PublicKey> = {}) {
    const deal = dealPda(id);
    return program.methods
      .closeFunding(bn(id))
      .accountsStrict({
        operator: pk(caller),
        platform: platformPda(),
        deal,
        vault: ata(this.mint, deal),
        mint: this.mint,
        borrowerWallet: pk(this.borrower),
        payoutDestination: ata(this.mint, pk(this.borrower)),
        treasuryToken: ata(this.mint, pk(this.treasury)),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        ...common(),
        ...overrides,
      })
      .instruction();
  }

  setBorrowerWalletIx(id: bigint, wallet: PublicKey, admin: KeyPairSigner = this.admin) {
    return program.methods
      .setBorrowerWallet(bn(id))
      .accountsStrict({
        admin: pk(admin),
        platform: platformPda(),
        deal: dealPda(id),
        borrowerWallet: wallet,
        ...common(),
      })
      .instruction();
  }

  repayAddress(id: bigint) {
    return ata(this.mint, repayOwnerPda(dealPda(id)));
  }

  processRepaymentIx(id: bigint, caller: KeyPairSigner, overrides: Record<string, PublicKey> = {}) {
    const deal = dealPda(id);
    return program.methods
      .processRepayment(bn(id))
      .accountsStrict({
        caller: pk(caller),
        platform: platformPda(),
        deal,
        repayOwner: repayOwnerPda(deal),
        repayToken: this.repayAddress(id),
        vault: ata(this.mint, deal),
        treasuryToken: ata(this.mint, pk(this.treasury)),
        mint: this.mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        ...common(),
        ...overrides,
      })
      .instruction();
  }

  /** Заёмщик вносит деньги на адрес погашения, кто-то обрабатывает поступление. */
  async repay(id: bigint, amount: bigint, caller?: KeyPairSigner) {
    this.topUp(this.repayAddress(id), amount);
    const who = caller ?? this.operator;
    await this.ok(who, [await this.processRepaymentIx(id, who)]);
  }

  markDefaultIx(id: bigint, caller: KeyPairSigner) {
    return program.methods
      .markDefault(bn(id))
      .accountsStrict({ caller: pk(caller), platform: platformPda(), deal: dealPda(id), ...common() })
      .instruction();
  }

  recordCostIx(id: bigint, amount: bigint) {
    return program.methods
      .recordRecoveryCost(bn(id), bn(amount))
      .accountsStrict({ admin: pk(this.admin), platform: platformPda(), deal: dealPda(id), ...common() })
      .instruction();
  }

  prepayAccounts(id: bigint) {
    const deal = dealPda(id);
    return {
      operator: pk(this.operator),
      platform: platformPda(),
      deal,
      repayOwner: repayOwnerPda(deal),
      repayToken: this.repayAddress(id),
      vault: ata(this.mint, deal),
      mint: this.mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      ...common(),
    };
  }

  prepayFullIx(id: bigint) {
    return program.methods.prepayFull(bn(id)).accountsStrict(this.prepayAccounts(id)).instruction();
  }

  prepayPartialIx(id: bigint, principal: bigint) {
    return program.methods
      .prepayPartial(bn(id), bn(principal))
      .accountsStrict(this.prepayAccounts(id))
      .instruction();
  }

  private withdrawAccounts(id: bigint, userId: number[], withdrawal: PublicKey) {
    const deal = dealPda(id);
    return {
      operator: pk(this.operator),
      platform: platformPda(),
      deal,
      user: userPda(userId),
      position: positionPda(deal, userId),
      withdrawalOwner: withdrawal,
      destination: ata(this.mint, withdrawal),
      vault: ata(this.mint, deal),
      mint: this.mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      ...common(),
    };
  }

  withdrawPayoutIx(
    id: bigint,
    userId: number[],
    withdrawal: PublicKey,
    overrides: Record<string, PublicKey> = {}
  ) {
    return program.methods
      .withdrawPayout(bn(id), userId)
      .accountsStrict({ ...this.withdrawAccounts(id, userId, withdrawal), ...overrides })
      .instruction();
  }

  withdrawRefundIx(id: bigint, userId: number[], withdrawal: PublicKey) {
    return program.methods
      .withdrawRefund(bn(id), userId)
      .accountsStrict(this.withdrawAccounts(id, userId, withdrawal))
      .instruction();
  }

  withdrawDepositIx(id: bigint, userId: number[], withdrawal: PublicKey) {
    const deal = dealPda(id);
    const owner = depositOwnerPda(deal, userId);
    return program.methods
      .withdrawDeposit(bn(id), userId)
      .accountsStrict({
        operator: pk(this.operator),
        platform: platformPda(),
        deal,
        user: userPda(userId),
        depositOwner: owner,
        depositToken: ata(this.mint, owner),
        withdrawalOwner: withdrawal,
        destination: ata(this.mint, withdrawal),
        mint: this.mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        ...common(),
      })
      .instruction();
  }

  setWhitelistIx(userId: number[], status: boolean) {
    return program.methods
      .setWhitelistStatus(userId, status)
      .accountsStrict({
        whitelistAuthority: pk(this.whitelist),
        platform: platformPda(),
        user: userPda(userId),
        ...common(),
      })
      .instruction();
  }

  setWithdrawalAddressIx(userId: number[], withdrawal: PublicKey) {
    return program.methods
      .setWithdrawalAddress(userId, withdrawal)
      .accountsStrict({ admin: pk(this.admin), platform: platformPda(), user: userPda(userId), ...common() })
      .instruction();
  }
}
