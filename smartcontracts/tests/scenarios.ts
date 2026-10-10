/**
 * Сквозные сценарии: полные циклы займа, дефолт с полным взысканием, пеня,
 * а также попытки подменить аккаунты другой кампании или пользователя.
 */
import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import {
  ata,
  big,
  DAY,
  dealPda,
  Env,
  pk,
  positionPda,
  SCALE,
  T0,
  USDC,
} from "./helpers";

const DEADLINE = T0 + 10 * DAY;
const TOTAL = 100_000n * USDC;
/** Знаменатель начисления за секунды: 10 000 × 360 × 86 400. */
const ACCRUAL_DENOMINATOR = 311_040_000_000n;

async function fund(env: Env, id: bigint, schedule: "annuity" | "coupon" = "annuity") {
  const { periods } = await env.createCampaign({ id, schedule });
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

/** Все инвесторы выводят выплаты; возвращает сумму выведенного. */
async function withdrawAll(env: Env, id: bigint, investors: { userId: number[]; withdrawal: any }[]) {
  let paid = 0n;
  for (const inv of investors) {
    await env.ok(env.operator, [await env.withdrawPayoutIx(id, inv.userId, inv.withdrawal)]);
    paid += env.balance(ata(env.mint, inv.withdrawal));
  }
  return paid;
}

describe("полные циклы", () => {
  it("аннуитет: 12 платежей по графику → Погашен, инвесторы получают тело и проценты", async () => {
    const env = await Env.create();
    const { periods, investors } = await fund(env, 1n);
    await close(env, 1n);
    const stranger = await env.newSigner();
    const interest = env.deal(1n).periods.reduce((s: bigint, p: any) => s + big(p.interestAmount), 0n);

    let inflow = 0n;
    for (let k = 0; k < 12; k++) {
      env.setTime(periods[k].dueTs);
      const amount = payment(env, 1n, k);
      env.topUp(env.repayAddress(1n), amount);
      await env.ok(stranger, [await env.processRepaymentIx(1n, stranger)]);
      inflow += amount;
      expect(state(env, 1n)).to.eq(k === 11 ? "repaid" : "active");
    }
    expect(inflow).to.eq(TOTAL + interest, "заёмщик внёс ровно тело и проценты по графику");
    expect(env.balance(env.repayAddress(1n))).to.eq(0n);

    const paid = await withdrawAll(env, 1n, investors);
    for (const inv of investors) {
      const expected = (inflow * inv.share) / 100_000n;
      expect(Number(expected - env.balance(ata(env.mint, inv.withdrawal)))).to.be.within(0, 3);
    }
    expect(Number(inflow - paid)).to.be.within(0, 12, "потери на округлении — единицы");
    expect(env.balance(ata(env.mint, dealPda(1n)))).to.eq(inflow - paid);

    env.topUp(env.repayAddress(1n), USDC);
    await env.fails("InvalidDealState", env.operator, [await env.processRepaymentIx(1n, env.operator)]);
  });

  it("купон: 11 купонов и последний платёж с телом → Погашен", async () => {
    const env = await Env.create();
    const { periods, investors } = await fund(env, 1n, "coupon");
    await close(env, 1n);

    let inflow = 0n;
    for (let k = 0; k < 12; k++) {
      env.setTime(periods[k].dueTs);
      const amount = payment(env, 1n, k);
      expect(amount).to.eq(k < 11 ? 833_333_333n : TOTAL + 833_333_333n);
      await env.repay(1n, amount);
      inflow += amount;
    }
    expect(state(env, 1n)).to.eq("repaid");

    const paid = await withdrawAll(env, 1n, investors);
    expect(paid > TOTAL).to.eq(true);
    expect(Number(inflow - paid)).to.be.within(0, 12);
  });

  it("дефолт с полным взысканием → Погашен, казна возмещает расходы, излишек остаётся на адресе", async () => {
    const env = await Env.create();
    const { periods, investors } = await fund(env, 1n);
    await close(env, 1n);
    const stranger = await env.newSigner();

    env.setTime(periods[0].dueTs + 90 * DAY);
    await env.ok(stranger, [await env.markDefaultIx(1n, stranger)]);
    await env.ok(env.admin, [await env.recordCostIx(1n, 1_000n * USDC)]);

    env.setTime(periods[0].dueTs + 200 * DAY);
    const treasury = ata(env.mint, pk(env.treasury));
    const treasuryBefore = env.balance(treasury);
    env.topUp(env.repayAddress(1n), 200_000n * USDC);
    await env.ok(env.operator, [await env.processRepaymentIx(1n, env.operator)]);

    expect(state(env, 1n)).to.eq("repaid");
    expect(env.balance(treasury) - treasuryBefore).to.eq(1_000n * USDC);
    const leftover = env.balance(env.repayAddress(1n));
    expect(leftover > 0n).to.eq(true, "излишек сверх долга не забирается");

    const inVault = env.balance(ata(env.mint, dealPda(1n)));
    expect(inVault).to.eq(200_000n * USDC - leftover - 1_000n * USDC);
    const deal = env.deal(1n);
    expect(big(deal.defaultPrincipal) + big(deal.defaultInterest) + big(deal.penalty)).to.eq(0n);

    const paid = await withdrawAll(env, 1n, investors);
    expect(Number(inVault - paid)).to.be.within(0, 12);
    expect(paid > TOTAL).to.eq(true, "инвесторы вернули тело, проценты и пеню");
  });

  it("пеня: платёж на 10 дней позже — пеня и проценты на просрочку отдельными статьями", async () => {
    const env = await Env.create();
    const { periods, investors } = await fund(env, 1n);
    await close(env, 1n);
    const stranger = await env.newSigner();
    const first = env.deal(1n).periods[0];
    const scheduled = payment(env, 1n, 0);

    const seconds = BigInt(10 * DAY);
    const expectedExtra = (big(first.principalAmount) * 1_000n * seconds) / ACCRUAL_DENOMINATOR;
    const expectedPenalty = (scheduled * 2_000n * seconds) / ACCRUAL_DENOMINATOR;

    env.setTime(periods[0].dueTs + 10 * DAY);
    env.topUp(env.repayAddress(1n), scheduled + 100n * USDC);
    await env.ok(stranger, [await env.processRepaymentIx(1n, stranger)]);

    const leftover = env.balance(env.repayAddress(1n));
    const taken = scheduled + 100n * USDC - leftover;
    expect(Number(taken - scheduled - expectedExtra - expectedPenalty)).to.be.within(-2, 2);

    const deal = env.deal(1n);
    const penaltyDistributed = (big(deal.accPenalty) * TOTAL) / SCALE;
    expect(Number(expectedPenalty - penaltyDistributed)).to.be.within(0, 2);

    const inv = investors[0];
    const principal = inv.share * USDC;
    const expectedPenaltyShare = (principal * big(deal.accPenalty)) / SCALE;
    const expectedTotal =
      (principal * big(deal.accPrincipal)) / SCALE +
      (principal * big(deal.accInterest)) / SCALE +
      expectedPenaltyShare;
    expect(expectedPenaltyShare > 0n).to.eq(true);

    await env.ok(env.operator, [await env.withdrawPayoutIx(1n, inv.userId, inv.withdrawal)]);
    expect(env.balance(ata(env.mint, inv.withdrawal))).to.eq(expectedTotal);
  });
});

describe("подмена аккаунтов", () => {
  /** Кампания 1 закрыта и активна, кампания 2 — в сборе, у обеих есть депозиты. */
  async function twoCampaigns() {
    const env = await Env.create();
    const { periods, investors } = await fund(env, 1n);
    await env.createCampaign({ id: 2n, fundingDeadline: DEADLINE + 30 * DAY });
    const other = await env.createUser();
    await env.deposit(2n, other.userId, 1_000n * USDC);
    await close(env, 1n);
    return { env, periods, investors, other };
  }

  it("зачисление в волт другой кампании отклоняется", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n });
    await env.createCampaign({ id: 2n });
    const user = await env.createUser();
    await env.ok(env.operator, [await env.openDepositIx(1n, user.userId)]);
    env.topUp(env.depositAddress(1n, user.userId), 1_000n * USDC);

    await env.fails("InvalidPubkey", env.operator, [
      await env.investIx(1n, user.userId, { vault: ata(env.mint, dealPda(2n)) }),
    ]);
  });

  it("зачисление с адреса пополнения другой кампании отклоняется", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n });
    await env.createCampaign({ id: 2n });
    const user = await env.createUser();
    await env.ok(env.operator, [await env.openDepositIx(1n, user.userId)]);
    await env.ok(env.operator, [await env.openDepositIx(2n, user.userId)]);
    env.topUp(env.depositAddress(2n, user.userId), 1_000n * USDC);

    await env.rejects(env.operator, [
      await env.investIx(1n, user.userId, { depositToken: env.depositAddress(2n, user.userId) }),
    ]);
    expect(env.balance(env.depositAddress(2n, user.userId))).to.eq(1_000n * USDC);
  });

  it("обработка поступления с адреса погашения другой кампании отклоняется", async () => {
    const { env } = await twoCampaigns();
    env.topUp(env.repayAddress(2n), 5_000n * USDC);
    await env.fails("InvalidPubkey", env.operator, [
      await env.processRepaymentIx(1n, env.operator, { repayToken: env.repayAddress(2n) }),
    ]);
    expect(env.balance(env.repayAddress(2n))).to.eq(5_000n * USDC);
  });

  it("выплата по чужой позиции и из волта другой кампании отклоняется", async () => {
    const { env, periods, investors } = await twoCampaigns();
    env.setTime(periods[0].dueTs);
    await env.repay(1n, payment(env, 1n, 0));
    const [a, b] = investors;

    await env.fails("ConstraintSeeds", env.operator, [
      await env.withdrawPayoutIx(1n, a.userId, a.withdrawal, {
        position: positionPda(dealPda(1n), b.userId),
      }),
    ]);
    await env.fails("InvalidPubkey", env.operator, [
      await env.withdrawPayoutIx(1n, a.userId, a.withdrawal, { vault: ata(env.mint, dealPda(2n)) }),
    ]);
  });

  it("закрытие сбора с чужим счётом казны или чужим кошельком заёмщика отклоняется", async () => {
    const env = await Env.create();
    await fund(env, 1n);
    env.setTime(DEADLINE);

    const fakeTreasury = Keypair.generate().publicKey;
    env.setTokenAccount(fakeTreasury, env.mint, Keypair.generate().publicKey, 0n);
    await env.fails("Unauthorized", env.operator, [
      await env.closeFundingIx(1n, env.operator, { treasuryToken: fakeTreasury }),
    ]);

    const attacker = Keypair.generate().publicKey;
    await env.fails("InvalidPubkey", env.operator, [
      await env.closeFundingIx(1n, env.operator, {
        borrowerWallet: attacker,
        payoutDestination: ata(env.mint, attacker),
      }),
    ]);

    expect(state(env, 1n)).to.eq("funding");
    expect(env.balance(ata(env.mint, dealPda(1n)))).to.eq(TOTAL);
  });
});
