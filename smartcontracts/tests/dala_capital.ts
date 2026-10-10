import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { FailedTransactionMetadata } from "litesvm";
import {
  ata,
  big,
  bn,
  common,
  DAY,
  dealPda,
  Env,
  pk,
  platformPda,
  program,
  T0,
  USDC,
  userPda,
} from "./helpers";

const DEADLINE = T0 + 10 * DAY;

function cancelIx(env: Env, id: bigint) {
  return program.methods
    .cancelCampaign(bn(id))
    .accountsStrict({ admin: pk(env.admin), platform: platformPda(), deal: dealPda(id), ...common() })
    .instruction();
}

/** Кампания 100 000 USDC, собранная тремя инвесторами 50/30/20 и закрытая в дедлайн. */
async function fundedCampaign(env: Env, schedule: "annuity" | "coupon" = "annuity", platformFeeBps = 0) {
  const id = 1n;
  const { periods } = await env.createCampaign({ id, schedule, platformFeeBps });
  const investors = [];
  for (const share of [50_000n, 30_000n, 20_000n]) {
    const user = await env.createUser();
    await env.deposit(id, user.userId, share * USDC);
    investors.push({ ...user, share });
  }
  env.setTime(DEADLINE);
  await env.ok(env.operator, [await env.closeFundingIx(id, env.operator)]);
  return { id, periods, investors };
}

function scheduledPayment(env: Env, id: bigint, k: number): bigint {
  const p = env.deal(id).periods[k];
  return big(p.interestAmount) + big(p.principalAmount);
}

describe("платформа и роли", () => {
  it("update_platform доступен только админу", async () => {
    const env = await Env.create();
    const ix = await program.methods
      .updatePlatform(null, null, null, null)
      .accountsStrict({ admin: pk(env.operator), platform: platformPda(), ...common() })
      .instruction();
    await env.fails("Unauthorized", env.operator, [ix]);
  });

  it("после смены оператора старый ключ не может зачислять депозиты", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n });
    const user = await env.createUser();
    const oldOperator = env.operator;
    const newOperator = await env.newSigner();

    await env.ok(env.admin, [
      await program.methods
        .updatePlatform(null, pk(newOperator), null, null)
        .accountsStrict({ admin: pk(env.admin), platform: platformPda(), ...common() })
        .instruction(),
    ]);

    await env.fails("Unauthorized", oldOperator, [await env.openDepositIx(1n, user.userId)]);
    env.operator = newOperator;
    await env.ok(newOperator, [await env.openDepositIx(1n, user.userId)]);
  });

  it("кампанию нельзя создать в неразрешённом токене", async () => {
    const env = await Env.create();
    await env.ok(env.admin, [
      await program.methods
        .removeMint(env.mint)
        .accountsStrict({ admin: pk(env.admin), platform: platformPda(), ...common() })
        .instruction(),
    ]);
    await env.fails("MintNotAllowed", env.admin, [await env.campaignIx({ id: 1n })]);
  });
});

describe("пользователи и whitelist", () => {
  it("смена адреса вывода блокирует вывод на 48 часов", async () => {
    const env = await Env.create();
    const { userId } = await env.createUser();
    const newAddress = Keypair.generate().publicKey;

    await env.ok(env.admin, [await env.setWithdrawalAddressIx(userId, newAddress)]);
    let user = env.user(userId);
    expect(user.withdrawalAddress.toBase58()).to.eq(newAddress.toBase58());
    expect(user.whitelistStatus).to.eq(false);

    env.setTime(T0 + 47 * 3600);
    await env.fails("AddressChangeDelayNotPassed", env.whitelist, [
      await env.setWhitelistIx(userId, true),
    ]);

    env.setTime(T0 + 48 * 3600);
    await env.ok(env.whitelist, [await env.setWhitelistIx(userId, true)]);
    user = env.user(userId);
    expect(user.whitelistStatus).to.eq(true);
  });

  it("whitelist переключает только whitelist authority", async () => {
    const env = await Env.create();
    const { userId } = await env.createUser();
    const ix = await program.methods
      .setWhitelistStatus(userId, false)
      .accountsStrict({
        whitelistAuthority: pk(env.admin),
        platform: platformPda(),
        user: userPda(userId),
        ...common(),
      })
      .instruction();
    await env.fails("Unauthorized", env.admin, [ix]);
  });
});

describe("сбор", () => {
  it("закрытие сбора: комиссия в казну, ровно собранная сумма заёмщику, лишнее в волте", async () => {
    const env = await Env.create();
    const id = 1n;
    await env.createCampaign({ id, platformFeeBps: 400 });
    for (const share of [50_000n, 30_000n, 20_000n]) {
      const { userId } = await env.createUser();
      await env.deposit(id, userId, share * USDC);
    }
    const vault = ata(env.mint, dealPda(id));
    env.topUp(vault, 123n);

    await env.fails("FundingStillOpen", env.operator, [await env.closeFundingIx(id, env.operator)]);

    env.setTime(DEADLINE);
    expect(env.exists(ata(env.mint, pk(env.borrower)))).to.eq(false, "ATA заёмщика ещё нет");
    const stranger = await env.newSigner();
    await env.fails("Unauthorized", stranger, [await env.closeFundingIx(id, stranger)]);
    await env.ok(env.operator, [await env.closeFundingIx(id, env.operator)]);

    expect(env.balance(ata(env.mint, pk(env.treasury)))).to.eq(4_000n * USDC);
    expect(env.balance(ata(env.mint, pk(env.borrower)))).to.eq(96_000n * USDC);
    expect(env.balance(vault)).to.eq(123n);

    const deal = env.deal(id);
    expect(Object.keys(deal.state)[0]).to.eq("active");
    const principal = deal.periods.reduce((s: bigint, p: any) => s + big(p.principalAmount), 0n);
    expect(principal).to.eq(100_000n * USDC);
    expect(big(deal.periods[0].interestAmount)).to.eq(833_333_333n);
  });

  it("min_ticket проверяется на первом вложении, пополнения — на любую сумму", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n, minTicket: 100n * USDC });
    const { userId } = await env.createUser();
    const depositToken = env.depositAddress(1n, userId);

    await env.ok(env.operator, [await env.openDepositIx(1n, userId)]);
    env.topUp(depositToken, 50n * USDC);
    await env.fails("BelowMinTicket", env.operator, [await env.investIx(1n, userId)]);

    env.topUp(depositToken, 60n * USDC);
    await env.ok(env.operator, [await env.investIx(1n, userId)]);
    expect(big(env.position(1n, userId).principal)).to.eq(110n * USDC);

    env.topUp(depositToken, 10n * USDC);
    await env.ok(env.operator, [await env.investIx(1n, userId)]);
    expect(big(env.position(1n, userId).principal)).to.eq(120n * USDC);
  });

  it("сверх hard_cap зачисляется часть, остаток ждёт на адресе пополнения и выводится", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n, hardCap: 100_000n * USDC });
    const a = await env.createUser();
    const b = await env.createUser();
    await env.deposit(1n, a.userId, 90_000n * USDC);
    await env.deposit(1n, b.userId, 20_000n * USDC);

    expect(big(env.position(1n, b.userId).principal)).to.eq(10_000n * USDC);
    expect(env.balance(env.depositAddress(1n, b.userId))).to.eq(10_000n * USDC);
    await env.fails("NoCapacity", env.operator, [await env.investIx(1n, b.userId)]);

    await env.ok(env.operator, [await env.withdrawDepositIx(1n, b.userId, b.withdrawal)]);
    expect(env.balance(ata(env.mint, b.withdrawal))).to.eq(10_000n * USDC);
    expect(env.exists(env.depositAddress(1n, b.userId))).to.eq(true, "в Funding ATA не закрывается");
  });

  it("max_ticket ограничивает позицию", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n, maxTicket: 1_000n * USDC });
    const { userId } = await env.createUser();
    await env.deposit(1n, userId, 1_500n * USDC);
    expect(big(env.position(1n, userId).principal)).to.eq(1_000n * USDC);
    expect(env.balance(env.depositAddress(1n, userId))).to.eq(500n * USDC);
  });

  it("без зафиксированного графика зачисление недоступно, а закрытие сбора даёт Failed", async () => {
    const env = await Env.create();
    await env.ok(env.admin, [await env.campaignIx({ id: 1n })]);
    const { userId } = await env.createUser();
    await env.ok(env.operator, [await env.openDepositIx(1n, userId)]);
    env.topUp(env.depositAddress(1n, userId), 1_000n * USDC);
    await env.fails("ScheduleNotFinalized", env.operator, [await env.investIx(1n, userId)]);

    env.setTime(DEADLINE);
    await env.ok(env.operator, [await env.closeFundingIx(1n, env.operator)]);
    expect(Object.keys(env.deal(1n).state)[0]).to.eq("failed");
  });

  it("отмена до дедлайна, затем возврат взносов; после дедлайна — только по истечении льготного срока", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n });
    const user = await env.createUser();
    await env.deposit(1n, user.userId, 5_000n * USDC);

    env.setTime(DEADLINE);
    await env.fails("CancelGracePeriodActive", env.admin, [await cancelIx(env, 1n)]);
    env.setTime(DEADLINE + 7 * DAY - 1);
    await env.fails("CancelGracePeriodActive", env.admin, [await cancelIx(env, 1n)]);

    env.setTime(DEADLINE - 1);
    await env.ok(env.admin, [await cancelIx(env, 1n)]);
    expect(Object.keys(env.deal(1n).state)[0]).to.eq("failed");

    await env.ok(env.operator, [await env.withdrawRefundIx(1n, user.userId, user.withdrawal)]);
    expect(env.balance(ata(env.mint, user.withdrawal))).to.eq(5_000n * USDC);
    await env.fails("NothingToWithdraw", env.operator, [
      await env.withdrawRefundIx(1n, user.userId, user.withdrawal),
    ]);
  });

  it("счёт заёмщика заморожен: сбор не закрыть, отмена после льготного срока возвращает взносы", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n, cancelGraceDays: 3 });
    const user = await env.createUser();
    await env.deposit(1n, user.userId, 60_000n * USDC);
    env.setTokenAccount(ata(env.mint, pk(env.borrower)), env.mint, pk(env.borrower), 0n, 2);

    env.setTime(DEADLINE);
    const result = await env.send(env.operator, [await env.closeFundingIx(1n, env.operator)]);
    expect(result).to.be.instanceOf(FailedTransactionMetadata, "перевод на замороженный счёт падает");
    expect(Object.keys(env.deal(1n).state)[0]).to.eq("funding");

    env.setTime(DEADLINE + 3 * DAY - 1);
    await env.fails("CancelGracePeriodActive", env.admin, [await cancelIx(env, 1n)]);

    env.setTime(DEADLINE + 3 * DAY);
    await env.ok(env.admin, [await cancelIx(env, 1n)]);
    await env.ok(env.operator, [await env.withdrawRefundIx(1n, user.userId, user.withdrawal)]);
    expect(env.balance(ata(env.mint, user.withdrawal))).to.eq(60_000n * USDC);
  });

  it("токен-счёт нельзя указать кошельком заёмщика", async () => {
    const env = await Env.create();
    const tokenAccount = Keypair.generate().publicKey;
    env.setTokenAccount(tokenAccount, env.mint, pk(env.borrower), 0n);
    await env.fails("InvalidBorrowerWallet", env.admin, [
      await env.campaignIx({ id: 1n, borrowerWallet: tokenAccount }),
    ]);
  });

  it("после провала сбора пустой адрес пополнения закрывается при выводе", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n, softCap: 50_000n * USDC });
    const user = await env.createUser();
    await env.deposit(1n, user.userId, 1_000n * USDC);
    env.topUp(env.depositAddress(1n, user.userId), 7n * USDC);

    env.setTime(DEADLINE);
    await env.ok(env.operator, [await env.closeFundingIx(1n, env.operator)]);
    expect(Object.keys(env.deal(1n).state)[0]).to.eq("failed");

    await env.ok(env.operator, [await env.withdrawDepositIx(1n, user.userId, user.withdrawal)]);
    expect(env.balance(ata(env.mint, user.withdrawal))).to.eq(7n * USDC);
    expect(env.exists(env.depositAddress(1n, user.userId))).to.eq(false);
  });
});

describe("погашение и выплаты", () => {
  it("платёж распределяется 50/30/20, инвесторы выводят свою долю", async () => {
    const env = await Env.create();
    const { id, periods, investors } = await fundedCampaign(env);
    const payment = scheduledPayment(env, id, 0);

    env.setTime(periods[0].dueTs);
    const stranger = await env.newSigner();
    await env.repay(id, payment, stranger);

    let paid = 0n;
    for (const inv of investors) {
      await env.ok(env.operator, [await env.withdrawPayoutIx(id, inv.userId, inv.withdrawal)]);
      const received = env.balance(ata(env.mint, inv.withdrawal));
      const expected = (payment * inv.share) / 100_000n;
      expect(Number(expected - received)).to.be.within(0, 2);
      paid += received;
    }
    expect(paid <= payment).to.eq(true);

    const first = investors[0];
    await env.fails("NothingToWithdraw", env.operator, [
      await env.withdrawPayoutIx(id, first.userId, first.withdrawal),
    ]);
  });

  it("вывод только на адрес вывода и только при включённом whitelist", async () => {
    const env = await Env.create();
    const { id, periods, investors } = await fundedCampaign(env);
    env.setTime(periods[0].dueTs);
    await env.repay(id, scheduledPayment(env, id, 0));
    const inv = investors[0];

    await env.fails("InvalidPubkey", env.operator, [
      await env.withdrawPayoutIx(id, inv.userId, Keypair.generate().publicKey),
    ]);

    await env.ok(env.whitelist, [await env.setWhitelistIx(inv.userId, false)]);
    await env.fails("WhitelistDisabled", env.operator, [
      await env.withdrawPayoutIx(id, inv.userId, inv.withdrawal),
    ]);
  });

  it("пустой адрес погашения обрабатывать нечего", async () => {
    const env = await Env.create();
    const { id, periods } = await fundedCampaign(env);
    env.setTime(periods[0].dueTs);
    await env.fails("NothingToProcess", env.operator, [await env.processRepaymentIx(id, env.operator)]);
  });
});

describe("обработка поступлений", () => {
  it("до даты платежа посторонний не проводит поступление, оператор проводит авансом", async () => {
    const env = await Env.create();
    const { id, periods } = await fundedCampaign(env);
    const stranger = await env.newSigner();
    const payment = scheduledPayment(env, id, 0);

    env.setTime(periods[0].dueTs - DAY);
    env.topUp(env.repayAddress(id), payment);
    await env.fails("NothingToProcess", stranger, [await env.processRepaymentIx(id, stranger)]);
    expect(env.balance(env.repayAddress(id))).to.eq(payment);

    await env.ok(env.operator, [await env.processRepaymentIx(id, env.operator)]);
    expect(env.balance(env.repayAddress(id))).to.eq(0n);
    const period = env.deal(id).periods[0];
    expect(big(period.interestPaid) + big(period.principalPaid)).to.eq(payment);
  });

  it("посторонний проводит только причитающееся, остаток уходит в досрочное погашение", async () => {
    const env = await Env.create();
    const { id, periods } = await fundedCampaign(env);
    const stranger = await env.newSigner();
    const payment = scheduledPayment(env, id, 0);

    env.setTime(periods[0].dueTs);
    env.topUp(env.repayAddress(id), payment + 10_100n * USDC);
    await env.ok(stranger, [await env.processRepaymentIx(id, stranger)]);

    expect(env.balance(env.repayAddress(id))).to.eq(10_100n * USDC, "излишек не стал авансом");
    const deal = env.deal(id);
    expect(big(deal.periods[1].interestPaid) + big(deal.periods[1].principalPaid)).to.eq(0n);

    await env.ok(env.operator, [await env.prepayPartialIx(id, 10_000n * USDC)]);
    expect(env.balance(env.repayAddress(id))).to.eq(0n);
  });
});

describe("дефолт", () => {
  it("дефолт по порогу, обработка только оператором, расходы на взыскание возмещаются первыми", async () => {
    const env = await Env.create();
    const { id, periods, investors } = await fundedCampaign(env);
    const stranger = await env.newSigner();

    env.setTime(periods[0].dueTs + 89 * DAY);
    await env.fails("DefaultThresholdNotReached", stranger, [await env.markDefaultIx(id, stranger)]);

    env.setTime(periods[0].dueTs + 90 * DAY);
    await env.ok(stranger, [await env.markDefaultIx(id, stranger)]);
    const deal = env.deal(id);
    expect(Object.keys(deal.state)[0]).to.eq("default");
    expect(big(deal.defaultPrincipal)).to.eq(100_000n * USDC);

    env.topUp(env.repayAddress(id), 5_000n * USDC);
    await env.fails("Unauthorized", stranger, [await env.processRepaymentIx(id, stranger)]);

    await env.ok(env.admin, [await env.recordCostIx(id, 1_000n * USDC)]);
    const treasury = ata(env.mint, pk(env.treasury));
    const vault = ata(env.mint, dealPda(id));
    const treasuryBefore = env.balance(treasury);
    await env.ok(env.operator, [await env.processRepaymentIx(id, env.operator)]);

    expect(env.balance(treasury) - treasuryBefore).to.eq(1_000n * USDC);
    expect(env.balance(vault)).to.eq(4_000n * USDC);
    expect(big(env.deal(id).recoveryReimbursed)).to.eq(1_000n * USDC);

    const inv = investors[0];
    await env.ok(env.operator, [await env.withdrawPayoutIx(id, inv.userId, inv.withdrawal)]);
    expect(Number(2_000n * USDC - env.balance(ata(env.mint, inv.withdrawal)))).to.be.within(0, 2);
  });

  it("расходы на взыскание вносятся только в дефолте", async () => {
    const env = await Env.create();
    const { id } = await fundedCampaign(env);
    await env.fails("InvalidDealState", env.admin, [await env.recordCostIx(id, USDC)]);
  });
});

describe("досрочное погашение", () => {
  it("частичное в дату платежа, затем полное; инвестор получает всё поступившее", async () => {
    const env = await Env.create();
    const { id, periods, investors } = await fundedCampaign(env);

    for (let k = 0; k < 6; k++) {
      env.setTime(periods[k].dueTs);
      await env.repay(id, scheduledPayment(env, id, k));
    }

    const before = env.deal(id).periods.slice(6).reduce((s: bigint, p: any) => s + big(p.principalAmount), 0n);
    const paymentBefore = scheduledPayment(env, id, 6);
    env.topUp(env.repayAddress(id), 20_200n * USDC);
    await env.ok(env.operator, [await env.prepayPartialIx(id, 20_000n * USDC)]);

    let deal = env.deal(id);
    const after = deal.periods.slice(6).reduce((s: bigint, p: any) => s + big(p.principalAmount), 0n);
    expect(after).to.eq(before - 20_000n * USDC);
    expect(scheduledPayment(env, id, 6) < paymentBefore).to.eq(true);
    expect(env.balance(env.repayAddress(id))).to.eq(0n);

    env.setTime(periods[5].dueTs + 15 * DAY);
    env.topUp(env.repayAddress(id), 40_000n * USDC);
    await env.ok(env.operator, [await env.prepayFullIx(id)]);
    deal = env.deal(id);
    expect(Object.keys(deal.state)[0]).to.eq("repaid");
    expect(env.balance(env.repayAddress(id)) > 0n).to.eq(true, "излишек остаётся на адресе погашения");

    const vault = ata(env.mint, dealPda(id));
    const inVault = env.balance(vault);
    let paid = 0n;
    for (const inv of investors) {
      await env.ok(env.operator, [await env.withdrawPayoutIx(id, inv.userId, inv.withdrawal)]);
      paid += env.balance(ata(env.mint, inv.withdrawal));
    }
    expect(Number(inVault - paid)).to.be.within(0, 6);
    expect(paid > 100_000n * USDC).to.eq(true, "инвесторы вернули тело и получили доход");
  });

  it("частичное досрочное одним траншем с сегодняшним платежом", async () => {
    const env = await Env.create();
    const { id, periods } = await fundedCampaign(env);
    const payment = scheduledPayment(env, id, 0);
    const before = env
      .deal(id)
      .periods.slice(1)
      .reduce((s: bigint, p: any) => s + big(p.principalAmount), 0n);

    env.setTime(periods[0].dueTs);
    env.topUp(env.repayAddress(id), payment + 20_200n * USDC);
    await env.ok(env.operator, [await env.prepayPartialIx(id, 20_000n * USDC)]);

    expect(env.balance(env.repayAddress(id))).to.eq(0n);
    const deal = env.deal(id);
    const first = deal.periods[0];
    expect(big(first.interestPaid) + big(first.principalPaid)).to.eq(payment, "платёж закрыт");
    const after = deal.periods.slice(1).reduce((s: bigint, p: any) => s + big(p.principalAmount), 0n);
    expect(after).to.eq(before - 20_000n * USDC);
    expect(big(deal.periods[1].interestPaid)).to.eq(0n, "аванса нет");
  });

  it("частичное досрочное вне даты платежа отклоняется", async () => {
    const env = await Env.create();
    const { id, periods } = await fundedCampaign(env);
    env.setTime(periods[0].dueTs);
    await env.repay(id, scheduledPayment(env, id, 0));

    env.setTime(periods[0].dueTs + 2 * DAY);
    env.topUp(env.repayAddress(id), 1_010n * USDC);
    await env.fails("NotPaymentDate", env.operator, [await env.prepayPartialIx(id, 1_000n * USDC)]);
  });

  it("для купона досрочного погашения нет", async () => {
    const env = await Env.create();
    const { id, periods } = await fundedCampaign(env, "coupon");
    env.setTime(periods[0].dueTs);
    env.topUp(env.repayAddress(id), 110_000n * USDC);
    await env.fails("PrepaymentNotAllowed", env.operator, [await env.prepayFullIx(id)]);
  });
});
