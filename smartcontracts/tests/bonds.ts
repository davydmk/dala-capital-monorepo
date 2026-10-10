/**
 * Облигации и корпоративные действия: программа `dala_actions` в LiteSVM.
 *
 * Проверяем не компиляцию, а поведение: что минт действительно создаётся с
 * расширениями и метаданными, что бумага у держателя заморожена и он не может
 * её передать, что реестр нельзя снять раньше даты фиксации, а исполнение —
 * раньше реестра, и что прожиг обнуляет выпуск.
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
  TOKEN_2022_PROGRAM_ID,
  createTransferCheckedInstruction,
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
import { DalaActions } from "../target/types/dala_actions";

const ROOT = path.resolve(__dirname, "..");
const IDL = JSON.parse(fs.readFileSync(path.join(ROOT, "target/idl/dala_actions.json"), "utf8"));
const SO_PATH = path.join(ROOT, "target/deploy/dala_actions.so");

const program = new Program<DalaActions>(
  IDL,
  new anchor.AnchorProvider(
    new Connection("http://127.0.0.1:8899"),
    new anchor.Wallet(Keypair.generate()),
    {}
  )
);
const PROGRAM_ID = program.programId;

const USDC = 1_000_000n;
const DAY = 86_400;
const T0 = 1_750_000_000;
/** Номинал одной бумаги: 1 USDC — удобно считать в тестах. */
const FACE = USDC;

const u64le = (x: bigint | number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(x));
  return b;
};
const u32le = (x: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(x);
  return b;
};
const pda = (seeds: (Buffer | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

const registryPda = (campaignId: bigint) => pda([Buffer.from("registry"), u64le(campaignId)]);
const mintPda = (campaignId: bigint) =>
  pda([Buffer.from("bond"), registryPda(campaignId).toBuffer()]);
const actionPda = (campaignId: bigint, index: number) =>
  pda([Buffer.from("action"), registryPda(campaignId).toBuffer(), u32le(index)]);
const bondAta = (mint: PublicKey, owner: PublicKey) =>
  getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);

const CAMPAIGN = 1n;

class Env {
  svm!: LiteSVM;
  admin!: KeyPairSigner;
  operator!: KeyPairSigner;
  alice!: KeyPairSigner;
  bob!: KeyPairSigner;

  static async create(): Promise<Env> {
    const env = new Env();
    env.svm = new LiteSVM();
    env.svm.addProgramFromFile(address(PROGRAM_ID.toBase58()), SO_PATH);
    env.setTime(T0);
    env.admin = await env.newSigner();
    env.operator = await env.newSigner();
    env.alice = await env.newSigner();
    env.bob = await env.newSigner();
    return env;
  }

  setTime(unix: number) {
    const clock = this.svm.getClock();
    clock.unixTimestamp = BigInt(unix);
    this.svm.setClock(clock);
  }

  async newSigner(sol = 100): Promise<KeyPairSigner> {
    const signer = await generateKeyPairSigner();
    this.svm.airdrop(signer.address, lamports(BigInt(sol) * 1_000_000_000n));
    return signer;
  }

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

  async rejects(feePayer: KeyPairSigner, ixs: TransactionInstruction[], signers: KeyPairSigner[] = []) {
    const result = await this.send(feePayer, ixs, signers);
    expect(result, "ожидался отказ транзакции").to.be.instanceOf(FailedTransactionMetadata);
    return (result as FailedTransactionMetadata).meta().logs().join("\n");
  }

  account(key: PublicKey) {
    return this.svm.getAccount(address(key.toBase58()));
  }

  registry(campaignId = CAMPAIGN) {
    const acc = this.account(registryPda(campaignId));
    return program.coder.accounts.decode("registry", Buffer.from(acc.data));
  }

  action(index: number, campaignId = CAMPAIGN) {
    const acc = this.account(actionPda(campaignId, index));
    return program.coder.accounts.decode("actionRecord", Buffer.from(acc.data));
  }

  /** Баланс и состояние заморозки токен-счёта Token-2022. */
  holding(owner: PublicKey, campaignId = CAMPAIGN) {
    const acc = this.account(bondAta(mintPda(campaignId), owner));
    if (!acc.exists) return { units: 0n, frozen: false };
    const data = Buffer.from(acc.data);
    const decoded = AccountLayout.decode(data.subarray(0, ACCOUNT_SIZE));
    return { units: decoded.amount, frozen: data.readUInt8(108) === 2 };
  }

  /** Сырые данные минта: по ним видно, что расширения и метаданные на месте. */
  mintData(campaignId = CAMPAIGN): Buffer {
    return Buffer.from(this.account(mintPda(campaignId)).data);
  }

  // ── Шаги сценария ────────────────────────────────────────────────────────

  async issue(campaignId = CAMPAIGN, maxSupply = 100n) {
    return this.ok(this.admin, [
      await program.methods
        .issueBond(new BN(campaignId.toString()), {
          faceValue: new BN(FACE.toString()),
          couponRateBps: 1200,
          couponsPerYear: 2,
          maturityTs: new BN(T0 + 365 * DAY),
          maxSupply: new BN(maxSupply.toString()),
          paymentMint: PublicKey.default,
          operator: new PublicKey(this.operator.address),
          name: "Dala Bond Astana Trade",
          symbol: "DALAB1",
          uri: "https://dala.capital/bonds/1",
        })
        .accountsStrict({
          authority: new PublicKey(this.admin.address),
          registry: registryPda(campaignId),
          mint: mintPda(campaignId),
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    ]);
  }

  holderIx(holder: KeyPairSigner, campaignId = CAMPAIGN) {
    return {
      operator: new PublicKey(this.operator.address),
      registry: registryPda(campaignId),
      mint: mintPda(campaignId),
      holder: new PublicKey(holder.address),
      holderToken: bondAta(mintPda(campaignId), new PublicKey(holder.address)),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  }

  async mintTo(holder: KeyPairSigner, units: bigint, campaignId = CAMPAIGN) {
    return this.ok(
      this.operator,
      [
        await program.methods
          .mintToHolder(new BN(campaignId.toString()), new BN(units.toString()))
          .accountsStrict(this.holderIx(holder, campaignId))
          .instruction(),
      ],
      []
    );
  }

  async burnFrom(holder: KeyPairSigner, units: bigint, redemption: boolean) {
    return this.ok(this.operator, [
      await program.methods
        .burnFromHolder(new BN(CAMPAIGN.toString()), new BN(units.toString()), redemption)
        .accountsStrict(this.holderIx(holder))
        .instruction(),
    ]);
  }

  async declare(index: number, kind: any, recordTs: number, paymentTs: number, amount: bigint) {
    return this.ok(this.admin, [
      await program.methods
        .declareAction(
          new BN(CAMPAIGN.toString()),
          index,
          kind,
          new BN(recordTs),
          new BN(paymentTs),
          new BN(amount.toString())
        )
        .accountsStrict({
          authority: new PublicKey(this.admin.address),
          registry: registryPda(CAMPAIGN),
          action: actionPda(CAMPAIGN, index),
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    ]);
  }

  snapshotIx(index: number, holders: number, units: bigint, total: bigint, hash: number[]) {
    return program.methods
      .recordSnapshot(
        new BN(CAMPAIGN.toString()),
        index,
        holders,
        new BN(units.toString()),
        new BN(total.toString()),
        hash
      )
      .accountsStrict({
        operator: new PublicKey(this.operator.address),
        registry: registryPda(CAMPAIGN),
        action: actionPda(CAMPAIGN, index),
      })
      .instruction();
  }
}

const HASH = Array.from({ length: 32 }, (_, i) => i + 1);
const SIGNATURE = Array.from({ length: 64 }, (_, i) => (i * 3) % 251);

describe("Облигация: выпуск и обращение", () => {
  let env: Env;
  beforeEach(async () => {
    env = await Env.create();
  });

  it("выпуск создаёт минт и пишет условия в его метаданные", async () => {
    await env.issue();

    const registry = env.registry();
    expect(registry.campaignId.toString()).to.equal("1");
    expect(registry.faceValue.toString()).to.equal(FACE.toString());
    expect(registry.couponRateBps).to.equal(1200);
    expect(registry.outstanding.toString()).to.equal("0");

    // Условия бумаги читаются прямо из минта, без нашей программы.
    const data = env.mintData().toString("utf8");
    expect(data).to.include("Dala Bond Astana Trade");
    expect(data).to.include("DALAB1");
    expect(data).to.include("face_value");
    expect(data).to.include("coupon_bps");
    expect(data).to.include("maturity");
  });

  it("бумаги выдаются в момент взноса и счёт держателя заморожен", async () => {
    await env.issue();
    await env.mintTo(env.alice, 3n);

    const holding = env.holding(new PublicKey(env.alice.address));
    expect(holding.units.toString()).to.equal("3");
    expect(holding.frozen, "счёт держателя должен быть заморожен").to.be.true;
    expect(env.registry().outstanding.toString()).to.equal("3");
    expect(env.registry().issued.toString()).to.equal("3");
  });

  it("держатель не может передать бумагу сам", async () => {
    await env.issue();
    await env.mintTo(env.alice, 2n);
    // У получателя счёт тоже должен существовать, иначе перевод упадёт
    // по другой причине и проверка ничего не докажет.
    await env.mintTo(env.bob, 1n);

    const from = bondAta(mintPda(CAMPAIGN), new PublicKey(env.alice.address));
    const to = bondAta(mintPda(CAMPAIGN), new PublicKey(env.bob.address));
    const logs = await env.rejects(env.alice, [
      createTransferCheckedInstruction(
        from,
        mintPda(CAMPAIGN),
        to,
        new PublicKey(env.alice.address),
        1,
        0,
        [],
        TOKEN_2022_PROGRAM_ID
      ),
    ]);
    expect(logs.toLowerCase(), logs).to.include("frozen");
  });

  it("нельзя выпустить больше, чем предусмотрено условиями", async () => {
    await env.issue(CAMPAIGN, 5n);
    await env.mintTo(env.alice, 5n);
    await env.fails("SupplyExceeded", env.operator, [
      await program.methods
        .mintToHolder(new BN(CAMPAIGN.toString()), new BN(1))
        .accountsStrict(env.holderIx(env.alice))
        .instruction(),
    ]);
  });

  it("возврат взноса сжигает бумаги, не закрывая выпуск", async () => {
    await env.issue();
    await env.mintTo(env.alice, 4n);
    await env.burnFrom(env.alice, 4n, false);

    expect(env.holding(new PublicKey(env.alice.address)).units.toString()).to.equal("0");
    expect(env.registry().outstanding.toString()).to.equal("0");
    // Выпущено за всё время не уменьшается: это история, а не остаток.
    expect(env.registry().issued.toString()).to.equal("4");
    expect(env.registry().status).to.deep.equal({ active: {} });
  });

  it("погашение прожигает бумаги и закрывает выпуск", async () => {
    await env.issue();
    await env.mintTo(env.alice, 2n);
    await env.mintTo(env.bob, 3n);

    await env.burnFrom(env.alice, 2n, true);
    expect(env.registry().status, "пока кто-то держит — выпуск жив").to.deep.equal({
      active: {},
    });

    await env.burnFrom(env.bob, 3n, true);
    expect(env.registry().outstanding.toString()).to.equal("0");
    expect(env.registry().status).to.deep.equal({ redeemed: {} });
  });

  it("чужим ключом бумаги не выпустить", async () => {
    await env.issue();
    await env.fails("Unauthorized", env.alice, [
      await program.methods
        .mintToHolder(new BN(CAMPAIGN.toString()), new BN(1))
        .accountsStrict({
          ...env.holderIx(env.alice),
          operator: new PublicKey(env.alice.address),
        })
        .instruction(),
    ]);
  });
});

describe("Корпоративные действия", () => {
  let env: Env;
  const RECORD = T0 + 10 * DAY;
  const PAYMENT = T0 + 11 * DAY;

  beforeEach(async () => {
    env = await Env.create();
    await env.issue();
    await env.mintTo(env.alice, 4n);
    await env.mintTo(env.bob, 6n);
  });

  it("реестр нельзя снять до даты фиксации", async () => {
    await env.declare(0, { coupon: {} }, RECORD, PAYMENT, 60_000n);
    await env.fails("RecordDateNotReached", env.operator, [
      await env.snapshotIx(0, 2, 10n, 600_000n, HASH),
    ]);
  });

  it("дата исполнения не может быть раньше даты фиксации", async () => {
    await env.fails("InvalidDates", env.admin, [
      await program.methods
        .declareAction(
          new BN(CAMPAIGN.toString()),
          0,
          { coupon: {} },
          new BN(PAYMENT),
          new BN(RECORD),
          new BN(0)
        )
        .accountsStrict({
          authority: new PublicKey(env.admin.address),
          registry: registryPda(CAMPAIGN),
          action: actionPda(CAMPAIGN, 0),
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    ]);
  });

  it("купон проходит полный цикл: объявлен, реестр снят, исполнен, закрыт", async () => {
    // 10 бумаг × 1 USDC × 12% ÷ 2 = 0,6 USDC на весь выпуск.
    const perUnit = (FACE * 1200n) / 10_000n / 2n;
    await env.declare(0, { coupon: {} }, RECORD, PAYMENT, perUnit);
    expect(env.action(0).status).to.deep.equal({ declared: {} });

    env.setTime(RECORD);
    await env.ok(env.operator, [await env.snapshotIx(0, 2, 10n, perUnit * 10n, HASH)]);

    const snapshotted = env.action(0);
    expect(snapshotted.status).to.deep.equal({ snapshot: {} });
    expect(snapshotted.holders).to.equal(2);
    expect(snapshotted.units.toString()).to.equal("10");
    expect(snapshotted.totalAmount.toString()).to.equal((perUnit * 10n).toString());
    expect(Buffer.from(snapshotted.registerHash)).to.deep.equal(Buffer.from(HASH));

    env.setTime(PAYMENT);
    await env.ok(env.operator, [
      await program.methods
        .settleAction(new BN(CAMPAIGN.toString()), 0, SIGNATURE, new BN(0), new BN(0))
        .accountsStrict({
          operator: new PublicKey(env.operator.address),
          registry: registryPda(CAMPAIGN),
          action: actionPda(CAMPAIGN, 0),
        })
        .instruction(),
    ]);
    expect(env.action(0).status).to.deep.equal({ settled: {} });
    expect(Buffer.from(env.action(0).settlement)).to.deep.equal(Buffer.from(SIGNATURE));

    await env.ok(env.admin, [
      await program.methods
        .closeAction(new BN(CAMPAIGN.toString()), 0)
        .accountsStrict({
          authority: new PublicKey(env.admin.address),
          registry: registryPda(CAMPAIGN),
          action: actionPda(CAMPAIGN, 0),
        })
        .instruction(),
    ]);
    expect(env.action(0).status).to.deep.equal({ closed: {} });
  });

  it("исполнение без снятого реестра отклоняется", async () => {
    await env.declare(0, { coupon: {} }, RECORD, PAYMENT, 60_000n);
    await env.fails("SnapshotMissing", env.operator, [
      await program.methods
        .settleAction(new BN(CAMPAIGN.toString()), 0, SIGNATURE, new BN(0), new BN(0))
        .accountsStrict({
          operator: new PublicKey(env.operator.address),
          registry: registryPda(CAMPAIGN),
          action: actionPda(CAMPAIGN, 0),
        })
        .instruction(),
    ]);
  });

  it("снимок реестра — самостоятельное действие и закрывается без выплат", async () => {
    await env.declare(0, { record: {} }, RECORD, RECORD, 0n);
    env.setTime(RECORD);
    await env.ok(env.operator, [await env.snapshotIx(0, 2, 10n, 0n, HASH)]);

    await env.ok(env.admin, [
      await program.methods
        .closeAction(new BN(CAMPAIGN.toString()), 0)
        .accountsStrict({
          authority: new PublicKey(env.admin.address),
          registry: registryPda(CAMPAIGN),
          action: actionPda(CAMPAIGN, 0),
        })
        .instruction(),
    ]);
    expect(env.action(0).status).to.deep.equal({ closed: {} });
  });

  it("голосование записывает итог и одобренный бюджет взыскания", async () => {
    const budget = 5n * USDC;
    await env.declare(0, { vote: {} }, RECORD, PAYMENT, budget);
    env.setTime(RECORD);
    await env.ok(env.operator, [await env.snapshotIx(0, 2, 10n, 0n, HASH)]);
    await env.ok(env.operator, [
      await program.methods
        .settleAction(new BN(CAMPAIGN.toString()), 0, SIGNATURE, new BN(6), new BN(4))
        .accountsStrict({
          operator: new PublicKey(env.operator.address),
          registry: registryPda(CAMPAIGN),
          action: actionPda(CAMPAIGN, 0),
        })
        .instruction(),
    ]);

    const action = env.action(0);
    expect(action.votesFor.toString()).to.equal("6");
    expect(action.votesAgainst.toString()).to.equal("4");
    // Предел расходов, который держатели одобрили, остаётся в записи.
    expect(action.amountPerUnit.toString()).to.equal(budget.toString());
  });

  it("дефолт меняет статус выпуска, но бумаги остаются у держателей", async () => {
    await env.ok(env.admin, [
      await program.methods
        .setBondStatus(new BN(CAMPAIGN.toString()), true)
        .accountsStrict({
          authority: new PublicKey(env.admin.address),
          registry: registryPda(CAMPAIGN),
        })
        .instruction(),
    ]);

    expect(env.registry().status).to.deep.equal({ defaulted: {} });
    expect(env.holding(new PublicKey(env.alice.address)).units.toString()).to.equal("4");
    expect(env.registry().outstanding.toString()).to.equal("10");
  });

  it("после взыскания бумаги сгорают и выпуск закрывается", async () => {
    await env.ok(env.admin, [
      await program.methods
        .setBondStatus(new BN(CAMPAIGN.toString()), true)
        .accountsStrict({
          authority: new PublicKey(env.admin.address),
          registry: registryPda(CAMPAIGN),
        })
        .instruction(),
    ]);
    await env.burnFrom(env.alice, 4n, true);
    await env.burnFrom(env.bob, 6n, true);

    expect(env.registry().outstanding.toString()).to.equal("0");
    expect(env.registry().status).to.deep.equal({ redeemed: {} });
  });

  it("действие объявляет только админ", async () => {
    await env.fails("Unauthorized", env.operator, [
      await program.methods
        .declareAction(
          new BN(CAMPAIGN.toString()),
          0,
          { coupon: {} },
          new BN(RECORD),
          new BN(PAYMENT),
          new BN(0)
        )
        .accountsStrict({
          authority: new PublicKey(env.operator.address),
          registry: registryPda(CAMPAIGN),
          action: actionPda(CAMPAIGN, 0),
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    ]);
  });
});
