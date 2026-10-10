/**
 * Сочетания условий: досрочное погашение при авансе, просрочке и в дефолте,
 * whitelist и смена адреса, смена казны, порог дефолта купона, много инвесторов.
 */
import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { generateKeyPairSigner } from "@solana/kit";
import {
  ata,
  big,
  common,
  DAY,
  dealPda,
  Env,
  pk,
  platformPda,
  program,
  T0,
  USDC,
} from "./helpers";

const DEADLINE = T0 + 10 * DAY;
const TOTAL = 100_000n * USDC;
const DEN = 311_040_000_000n; // 10 000 × 360 × 86 400

async function fund(env: Env, id: bigint, opts: { schedule?: "annuity" | "coupon"; platformFeeBps?: number } = {}) {
  const { periods } = await env.createCampaign({ id, ...opts });
  const investors = [];
  for (const share of [50_000n, 30_000n, 20_000n]) {
    const user = await env.createUser();
    await env.deposit(id, user.userId, share * USDC);
    investors.push({ ...user, share });
  }
  return { periods, investors };
}

async function close(env: Env, id: bigint) {
  env.setTime(DEADLINE);
  await env.ok(env.operator, [await env.closeFundingIx(id, env.operator)]);
}

function payment(env: Env, id: bigint, k: number): bigint {
  const p = env.deal(id).periods[k];
  return big(p.interestAmount) + big(p.principalAmount);
}

function state(env: Env, id: bigint): string {
  return Object.keys(env.deal(id).state)[0];
}

describe("досрочное погашение: сочетания условий", () => {
  it("полное досрочное при авансе: аванс зачитывается, лишнее не списывается", async () => {
    const env = await Env.create();
    const { periods } = await fund(env, 1n);
    await close(env, 1n);

    env.setTime(periods[0].dueTs);
    await env.repay(1n, payment(env, 1n, 0) + 10_000n * USDC);

    const now = periods[0].dueTs + 15 * DAY;
    env.setTime(now);
    const future = env.deal(1n).periods.slice(1);
    const remaining = future.reduce((s: bigint, p: any) => s + big(p.principalAmount) - big(p.principalPaid), 0n);
    const prepaidInterest = future.reduce((s: bigint, p: any) => s + big(p.interestPaid), 0n);
    expect(prepaidInterest > 0n).to.eq(true, "аванс закрыл проценты будущих платежей");

    const accrued = (remaining * 1_000n * BigInt(15 * DAY)) / DEN;
    const current = accrued > prepaidInterest ? accrued - prepaidInterest : 0n;
    const fee = (remaining * 100n) / 10_000n;
    const total = remaining + current + fee;

    env.topUp(env.repayAddress(1n), 100_000n * USDC);
    const before = env.balance(env.repayAddress(1n));
    await env.ok(env.operator, [await env.prepayFullIx(1n)]);

    expect(before - env.balance(env.repayAddress(1n))).to.eq(total);
    expect(state(env, 1n)).to.eq("repaid");
  });

  it("полное досрочное при просрочке и пене: сумма совпадает с формулой", async () => {
    const env = await Env.create();
    const { periods } = await fund(env, 1n);
    await close(env, 1n);
    const p0 = env.deal(1n).periods[0];
    const [principal0, interest0] = [big(p0.principalAmount), big(p0.interestAmount)];

    const seconds = BigInt(15 * DAY);
    env.setTime(periods[0].dueTs + 15 * DAY);
    const remaining = TOTAL - principal0;
    const extra = (principal0 * 1_000n * seconds) / DEN;
    const penalty = ((principal0 + interest0) * 2_000n * seconds) / DEN;
    const current = (remaining * 1_000n * seconds) / DEN;
    const fee = (remaining * 100n) / 10_000n;
    const total = principal0 + interest0 + extra + penalty + current + remaining + fee;

    env.topUp(env.repayAddress(1n), 150_000n * USDC);
    const before = env.balance(env.repayAddress(1n));
    await env.ok(env.operator, [await env.prepayFullIx(1n)]);

    expect(before - env.balance(env.repayAddress(1n))).to.eq(total);
    expect(state(env, 1n)).to.eq("repaid");
    expect(big(env.deal(1n).penalty)).to.eq(0n);
  });

  it("частичное досрочное, когда просрочен и прошлый платёж: всё гасится одной операцией", async () => {
    const env = await Env.create();
    const { periods } = await fund(env, 1n);
    await close(env, 1n);
    const deal0 = env.deal(1n);
    const p0 = deal0.periods[0];
    const [principal0, interest0] = [big(p0.principalAmount), big(p0.interestAmount)];
    const pay0 = principal0 + interest0;
    const pay1 = payment(env, 1n, 1);
    const principalAfter1 = deal0.periods.slice(2).reduce((s: bigint, p: any) => s + big(p.principalAmount), 0n);

    const between = BigInt(periods[1].dueTs - periods[0].dueTs);
    const extra = (principal0 * 1_000n * between) / DEN;
    const penalty = (pay0 * 2_000n * between) / DEN;
    const total = pay0 + pay1 + extra + penalty + 20_000n * USDC + 200n * USDC;

    env.setTime(periods[1].dueTs);
    env.topUp(env.repayAddress(1n), total + 50n * USDC);
    await env.ok(env.operator, [await env.prepayPartialIx(1n, 20_000n * USDC)]);

    expect(env.balance(env.repayAddress(1n))).to.eq(50n * USDC);
    const deal = env.deal(1n);
    for (const k of [0, 1]) {
      const p = deal.periods[k];
      expect(big(p.principalPaid) + big(p.interestPaid)).to.eq(big(p.principalAmount) + big(p.interestAmount));
    }
    const after = deal.periods.slice(2).reduce((s: bigint, p: any) => s + big(p.principalAmount), 0n);
    expect(after).to.eq(principalAfter1 - 20_000n * USDC);
    expect(big(deal.penalty) + big(deal.extraInterest)).to.eq(0n);
  });

  it("в дефолте досрочное погашение недоступно", async () => {
    const env = await Env.create();
    const { periods } = await fund(env, 1n);
    await close(env, 1n);
    const stranger = await env.newSigner();
    env.setTime(periods[0].dueTs + 90 * DAY);
    await env.ok(stranger, [await env.markDefaultIx(1n, stranger)]);

    env.topUp(env.repayAddress(1n), 200_000n * USDC);
    await env.fails("InvalidDealState", env.operator, [await env.prepayFullIx(1n)]);
    await env.fails("InvalidDealState", env.operator, [await env.prepayPartialIx(1n, 1_000n * USDC)]);
  });
});

describe("whitelist, адрес вывода, казна", () => {
  it("выключенный whitelist блокирует возврат взноса и вывод депозита", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n });
    const user = await env.createUser();
    await env.deposit(1n, user.userId, 1_000n * USDC);
    env.topUp(env.depositAddress(1n, user.userId), 5n * USDC);
    await close(env, 1n);
    expect(state(env, 1n)).to.eq("failed");

    await env.ok(env.whitelist, [await env.setWhitelistIx(user.userId, false)]);
    await env.fails("WhitelistDisabled", env.operator, [
      await env.withdrawRefundIx(1n, user.userId, user.withdrawal),
    ]);
    await env.fails("WhitelistDisabled", env.operator, [
      await env.withdrawDepositIx(1n, user.userId, user.withdrawal),
    ]);

    await env.ok(env.whitelist, [await env.setWhitelistIx(user.userId, true)]);
    await env.ok(env.operator, [await env.withdrawRefundIx(1n, user.userId, user.withdrawal)]);
    await env.ok(env.operator, [await env.withdrawDepositIx(1n, user.userId, user.withdrawal)]);
    expect(env.balance(ata(env.mint, user.withdrawal))).to.eq(1_005n * USDC);
  });

  it("после смены адреса и 48 часов выплата идёт на новый адрес, старый отклоняется", async () => {
    const env = await Env.create();
    const { periods, investors } = await fund(env, 1n);
    await close(env, 1n);
    env.setTime(periods[0].dueTs);
    await env.repay(1n, payment(env, 1n, 0));

    const inv = investors[0];
    const newAddress = Keypair.generate().publicKey;
    await env.ok(env.admin, [await env.setWithdrawalAddressIx(inv.userId, newAddress)]);
    env.setTime(periods[0].dueTs + 48 * 3600);
    await env.ok(env.whitelist, [await env.setWhitelistIx(inv.userId, true)]);

    await env.fails("InvalidPubkey", env.operator, [
      await env.withdrawPayoutIx(1n, inv.userId, inv.withdrawal),
    ]);
    await env.ok(env.operator, [await env.withdrawPayoutIx(1n, inv.userId, newAddress)]);
    expect(env.balance(ata(env.mint, newAddress)) > 0n).to.eq(true);
    expect(env.balance(ata(env.mint, inv.withdrawal))).to.eq(0n);
  });

  it("смена казны: старый счёт казны отклоняется, после allow_mint комиссия идёт новой казне", async () => {
    const env = await Env.create();
    await fund(env, 1n, { platformFeeBps: 400 });
    const newTreasury = await generateKeyPairSigner();

    await env.ok(env.admin, [
      await program.methods
        .updatePlatform(null, null, null, pk(newTreasury))
        .accountsStrict({ admin: pk(env.admin), platform: platformPda(), ...common() })
        .instruction(),
    ]);

    env.setTime(DEADLINE);
    await env.fails("Unauthorized", env.operator, [await env.closeFundingIx(1n, env.operator)]);

    env.treasury = newTreasury;
    await env.allowMint(env.mint);
    await env.ok(env.operator, [await env.closeFundingIx(1n, env.operator)]);
    expect(env.balance(ata(env.mint, pk(newTreasury)))).to.eq(4_000n * USDC);
  });
});

describe("кошелёк заёмщика", () => {
  it("посторонний не может закрыть сбор и отправить деньги на адрес заёмщика", async () => {
    const env = await Env.create();
    await fund(env, 1n);
    env.setTime(DEADLINE);
    const stranger = await env.newSigner();
    await env.fails("Unauthorized", stranger, [await env.closeFundingIx(1n, stranger)]);
    expect(state(env, 1n)).to.eq("funding");
    expect(env.balance(ata(env.mint, dealPda(1n)))).to.eq(TOTAL);
  });

  it("после дедлайна админ меняет кошелёк, оператор закрывает сбор на новый адрес", async () => {
    const env = await Env.create();
    await fund(env, 1n);
    env.setTime(DEADLINE + DAY);
    const newWallet = Keypair.generate().publicKey;

    await env.ok(env.admin, [await env.setBorrowerWalletIx(1n, newWallet)]);
    expect(env.deal(1n).borrowerWallet.toBase58()).to.eq(newWallet.toBase58());

    await env.fails("InvalidPubkey", env.operator, [await env.closeFundingIx(1n, env.operator)]);
    await env.ok(env.operator, [
      await env.closeFundingIx(1n, env.operator, {
        borrowerWallet: newWallet,
        payoutDestination: ata(env.mint, newWallet),
      }),
    ]);
    expect(env.balance(ata(env.mint, newWallet))).to.eq(TOTAL);
    expect(env.exists(ata(env.mint, pk(env.borrower)))).to.eq(false, "на старый адрес ничего не ушло");
  });

  it("сменить кошелёк может только админ, только на не токен-счёт и только в сборе", async () => {
    const env = await Env.create();
    await fund(env, 1n);
    const stranger = await env.newSigner();

    await env.fails("Unauthorized", stranger, [
      await env.setBorrowerWalletIx(1n, Keypair.generate().publicKey, stranger),
    ]);

    const tokenAccount = Keypair.generate().publicKey;
    env.setTokenAccount(tokenAccount, env.mint, pk(env.borrower), 0n);
    await env.fails("InvalidBorrowerWallet", env.admin, [await env.setBorrowerWalletIx(1n, tokenAccount)]);

    await close(env, 1n);
    await env.fails("InvalidDealState", env.admin, [
      await env.setBorrowerWalletIx(1n, Keypair.generate().publicKey),
    ]);
  });
});

describe("дефолт и распределение", () => {
  it("купон: порог дефолта 30 дней", async () => {
    const env = await Env.create();
    const { periods } = await fund(env, 1n, { schedule: "coupon" });
    await close(env, 1n);
    const stranger = await env.newSigner();

    env.setTime(periods[0].dueTs + 29 * DAY);
    await env.fails("DefaultThresholdNotReached", stranger, [await env.markDefaultIx(1n, stranger)]);
    env.setTime(periods[0].dueTs + 30 * DAY);
    await env.ok(stranger, [await env.markDefaultIx(1n, stranger)]);
    expect(state(env, 1n)).to.eq("default");
    expect(big(env.deal(1n).defaultPrincipal)).to.eq(TOTAL);
  });

  it("семь инвесторов с неудобными суммами, выводы в разные моменты полного цикла", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n });
    const odd = [12_345_678_901n, 23_456_789_012n, 7_777_777_777n, 19_999_999_999n, 1_234_567_890n, 15_000_000_001n];
    const shares = [...odd, TOTAL - odd.reduce((s, x) => s + x, 0n)];
    const investors = [];
    for (const share of shares) {
      const user = await env.createUser();
      await env.deposit(1n, user.userId, share);
      investors.push({ ...user, share });
    }
    await close(env, 1n);
    const stranger = await env.newSigner();
    const periods = env.deal(1n).periods;

    let inflow = 0n;
    for (let k = 0; k < 12; k++) {
      env.setTime(Number(periods[k].dueTs));
      const amount = payment(env, 1n, k);
      env.topUp(env.repayAddress(1n), amount);
      await env.ok(stranger, [await env.processRepaymentIx(1n, stranger)]);
      inflow += amount;

      // Разные инвесторы выводят в разные месяцы — чекпоинты должны сдвигаться корректно.
      for (let i = 0; i < investors.length; i++) {
        if ((k + 1) % (i + 2) === 0 || k === 11) {
          const inv = investors[i];
          await env.ok(env.operator, [await env.withdrawPayoutIx(1n, inv.userId, inv.withdrawal)]);
        }
      }
    }
    expect(state(env, 1n)).to.eq("repaid");

    let paid = 0n;
    for (const inv of investors) {
      const got = env.balance(ata(env.mint, inv.withdrawal));
      const expected = (inflow * inv.share) / TOTAL;
      expect(Number(expected - got)).to.be.within(0, 30, "доля инвестора");
      paid += got;
    }
    expect(paid <= inflow).to.eq(true, "выплаты не превышают поступлений");
    expect(Number(inflow - paid)).to.be.within(0, 200, "потери на округлении — единицы");
    expect(env.balance(ata(env.mint, dealPda(1n)))).to.eq(inflow - paid);
  });
});
