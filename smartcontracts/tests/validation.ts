/**
 * Проверки ввода и состояний: параметры кампании, загрузка графика, операции не в том
 * состоянии кампании, лимит токенов, адреса, созданные заранее посторонним.
 */
import { expect } from "chai";
import { KeyPairSigner } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import {
  ata,
  big,
  bn,
  CampaignOptions,
  common,
  DAY,
  dealPda,
  depositOwnerPda,
  Env,
  MONTH,
  pk,
  platformPda,
  program,
  repayOwnerPda,
  SCALE,
  T0,
  USDC,
} from "./helpers";

const DEADLINE = T0 + 10 * DAY;

function cancelIx(env: Env, id: bigint) {
  return program.methods
    .cancelCampaign(bn(id))
    .accountsStrict({ admin: pk(env.admin), platform: platformPda(), deal: dealPda(id), ...common() })
    .instruction();
}

function finalizeIx(env: Env, id: bigint, admin: KeyPairSigner) {
  return program.methods
    .finalizeSchedule(bn(id))
    .accountsStrict({ admin: pk(admin), platform: platformPda(), deal: dealPda(id), ...common() })
    .instruction();
}

function removeMintIx(env: Env, mint: PublicKey, admin: KeyPairSigner = env.admin) {
  return program.methods
    .removeMint(mint)
    .accountsStrict({ admin: pk(admin), platform: platformPda(), ...common() })
    .instruction();
}

const month = (k: number) => DEADLINE + MONTH * k;

/** Сбор на 100 000 от одного инвестора; закрытие в дедлайн. */
async function activeDeal(env: Env, o: Partial<CampaignOptions> = {}) {
  const { periods } = await env.createCampaign({ id: 1n, ...o });
  const inv = await env.createUser();
  await env.deposit(1n, inv.userId, 100_000n * USDC);
  env.setTime(DEADLINE);
  await env.ok(env.operator, [await env.closeFundingIx(1n, env.operator)]);
  return { periods, inv };
}

describe("параметры кампании", () => {
  const bad: [string, Partial<CampaignOptions>][] = [
    ["soft cap = 0", { softCap: 0n }],
    ["soft cap > hard cap", { softCap: 100_001n * USDC }],
    ["min ticket = 0", { minTicket: 0n }],
    ["min ticket > soft cap", { minTicket: 50_001n * USDC }],
    ["max ticket < min ticket", { maxTicket: 99n * USDC }],
    ["старт = дедлайн", { fundingStart: DEADLINE }],
    ["старт после дедлайна", { fundingStart: DEADLINE + 1 }],
    ["3 периода в году", { periodsPerYear: 3 }],
    ["0 периодов в году", { periodsPerYear: 0 }],
    ["ставка 0", { rateBps: 0 }],
    ["порог дефолта 0 дней", { thresholdDays: 0 }],
    ["комиссия платформы 100%", { platformFeeBps: 10_000 }],
    ["комиссия за досрочное 100%", { prepaymentFeeBps: 10_000 }],
    ["льготный срок отмены 0 дней", { cancelGraceDays: 0 }],
    ["купон с комиссией за досрочное", { schedule: "coupon", prepaymentFeeBps: 100 }],
  ];

  it("некорректные параметры отклоняются с InvalidCampaignParams", async () => {
    const env = await Env.create();
    for (const [name, o] of bad) {
      try {
        await env.fails("InvalidCampaignParams", env.admin, [await env.campaignIx({ id: 1n, ...o })]);
      } catch (e: any) {
        throw new Error(`${name}: ${e.message}`);
      }
    }
    // Ни одна попытка не создала кампанию.
    expect(env.exists(dealPda(1n))).to.eq(false);
  });

  it("граничные значения проходят: 1, 2, 4 периода в году, комиссии 99,99%, max ticket = min ticket, soft = hard cap", async () => {
    const env = await Env.create();
    const ok: Partial<CampaignOptions>[] = [
      { periodsPerYear: 1 },
      { periodsPerYear: 2 },
      { periodsPerYear: 4 },
      { platformFeeBps: 9_999, prepaymentFeeBps: 9_999 },
      { maxTicket: 100n * USDC },
      { softCap: 100_000n * USDC },
      { minTicket: 50_000n * USDC },
    ];
    let id = 1n;
    for (const o of ok) await env.ok(env.admin, [await env.campaignIx({ id: id++, ...o })]);
    expect(big(env.platform().campaignCount)).to.eq(BigInt(ok.length));
  });

  it("не admin, повторный id, нулевой кошелёк заёмщика", async () => {
    const env = await Env.create();
    const stranger = await env.newSigner();
    await env.fails("Unauthorized", stranger, [await env.campaignIx({ id: 1n, admin: stranger })]);
    await env.fails("InvalidBorrowerWallet", env.admin, [
      await env.campaignIx({ id: 1n, borrowerWallet: PublicKey.default }),
    ]);
    await env.ok(env.admin, [await env.campaignIx({ id: 1n })]);
    await env.rejects(env.admin, [await env.campaignIx({ id: 1n })]);
  });
});

describe("загрузка графика", () => {
  const f = (dueTs: number, fraction: bigint = 0n) => ({ dueTs, fraction });

  it("пустая порция, дата не позже дедлайна, даты не по возрастанию — внутри порции и между порциями", async () => {
    const env = await Env.create();
    await env.ok(env.admin, [await env.campaignIx({ id: 1n })]);
    await env.fails("InvalidSchedule", env.admin, [await env.scheduleIx(1n, [])]);
    await env.fails("InvalidSchedule", env.admin, [await env.scheduleIx(1n, [f(DEADLINE)])]);
    await env.fails("InvalidSchedule", env.admin, [await env.scheduleIx(1n, [f(month(2)), f(month(1))])]);
    await env.fails("InvalidSchedule", env.admin, [await env.scheduleIx(1n, [f(month(1)), f(month(1))])]);

    await env.ok(env.admin, [await env.scheduleIx(1n, [f(month(1)), f(month(2))])]);
    await env.fails("InvalidSchedule", env.admin, [await env.scheduleIx(1n, [f(month(2))])]);
    await env.ok(env.admin, [await env.scheduleIx(1n, [f(month(3), SCALE)])]);
    expect(env.deal(1n).periods.length).to.eq(3);
  });

  it("61-й платёж отклоняется с TooManyPeriods", async () => {
    const env = await Env.create();
    await env.ok(env.admin, [await env.campaignIx({ id: 1n })]);
    for (let i = 0; i < 60; i += 20) {
      const chunk = Array.from({ length: 20 }, (_, k) => f(month(i + k + 1)));
      await env.ok(env.admin, [await env.scheduleIx(1n, chunk)]);
    }
    await env.fails("TooManyPeriods", env.admin, [await env.scheduleIx(1n, [f(month(61))])]);
  });

  it("фиксация: без платежей, сумма долей ≠ SCALE, купон с телом не в последнем платеже", async () => {
    const env = await Env.create();
    await env.ok(env.admin, [await env.campaignIx({ id: 1n })]);
    await env.fails("InvalidSchedule", env.admin, [await finalizeIx(env, 1n, env.admin)]);

    await env.ok(env.admin, [await env.scheduleIx(1n, [f(month(1), SCALE / 2n), f(month(2), SCALE / 2n - 1n)])]);
    await env.fails("InvalidSchedule", env.admin, [await finalizeIx(env, 1n, env.admin)]);

    await env.ok(env.admin, [await env.campaignIx({ id: 2n, schedule: "coupon" })]);
    await env.ok(env.admin, [await env.scheduleIx(2n, [f(month(1), 1n), f(month(2), SCALE - 1n)])]);
    await env.fails("InvalidSchedule", env.admin, [await finalizeIx(env, 2n, env.admin)]);

    // Сумма долей больше SCALE тоже отклоняется.
    await env.ok(env.admin, [await env.campaignIx({ id: 3n })]);
    await env.ok(env.admin, [await env.scheduleIx(3n, [f(month(1), SCALE), f(month(2), 1n)])]);
    await env.fails("InvalidSchedule", env.admin, [await finalizeIx(env, 3n, env.admin)]);
  });

  it("после фиксации график не меняется; чужой не загружает и не фиксирует; зачисление до фиксации отклоняется", async () => {
    const env = await Env.create();
    const stranger = await env.newSigner();
    await env.ok(env.admin, [await env.campaignIx({ id: 1n })]);
    await env.fails("Unauthorized", stranger, [await env.scheduleIx(1n, [f(month(1), SCALE)], stranger)]);
    await env.ok(env.admin, [await env.scheduleIx(1n, [f(month(1), SCALE)])]);

    const user = await env.createUser();
    await env.ok(env.operator, [await env.openDepositIx(1n, user.userId)]);
    env.topUp(env.depositAddress(1n, user.userId), 1_000n * USDC);
    await env.fails("ScheduleNotFinalized", env.operator, [await env.investIx(1n, user.userId)]);

    await env.fails("Unauthorized", stranger, [await finalizeIx(env, 1n, stranger)]);
    await env.ok(env.admin, [await finalizeIx(env, 1n, env.admin)]);
    await env.fails("ScheduleFinalized", env.admin, [await finalizeIx(env, 1n, env.admin)]);
    await env.fails("ScheduleFinalized", env.admin, [await env.scheduleIx(1n, [f(month(2))])]);
    await env.ok(env.operator, [await env.investIx(1n, user.userId)]);
  });
});

describe("операции не в том состоянии кампании", () => {
  it("сбор: обработка поступлений, дефолт, расходы, досрочное, выплата, возврат, раннее закрытие", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n });
    const inv = await env.createUser();
    await env.deposit(1n, inv.userId, 60_000n * USDC);
    const stranger = await env.newSigner();
    env.topUp(env.repayAddress(1n), 1_000n * USDC);

    await env.fails("InvalidDealState", env.operator, [await env.processRepaymentIx(1n, env.operator)]);
    await env.fails("InvalidDealState", stranger, [await env.markDefaultIx(1n, stranger)]);
    await env.fails("InvalidDealState", env.admin, [await env.recordCostIx(1n, USDC)]);
    await env.fails("InvalidDealState", env.operator, [await env.prepayFullIx(1n)]);
    await env.fails("InvalidDealState", env.operator, [await env.prepayPartialIx(1n, USDC)]);
    await env.fails("InvalidDealState", env.operator, [await env.withdrawPayoutIx(1n, inv.userId, inv.withdrawal)]);
    await env.fails("InvalidDealState", env.operator, [await env.withdrawRefundIx(1n, inv.userId, inv.withdrawal)]);
    await env.fails("FundingStillOpen", env.operator, [await env.closeFundingIx(1n, env.operator)]);
    expect(env.balance(ata(env.mint, dealPda(1n)))).to.eq(60_000n * USDC);
  });

  it("активный займ: зачисление, новый адрес пополнения, повторное закрытие, отмена, график, возврат, расходы", async () => {
    const env = await Env.create();
    const { inv } = await activeDeal(env);
    const late = await env.createUser();

    await env.fails("InvalidDealState", env.operator, [await env.openDepositIx(1n, late.userId)]);
    await env.fails("InvalidDealState", env.operator, [await env.investIx(1n, inv.userId)]);
    await env.fails("InvalidDealState", env.operator, [await env.closeFundingIx(1n, env.operator)]);
    await env.fails("InvalidDealState", env.admin, [await cancelIx(env, 1n)]);
    await env.fails("InvalidDealState", env.admin, [await env.scheduleIx(1n, [{ dueTs: month(20), fraction: 0n }])]);
    await env.fails("InvalidDealState", env.admin, [await finalizeIx(env, 1n, env.admin)]);
    await env.fails("InvalidDealState", env.operator, [await env.withdrawRefundIx(1n, inv.userId, inv.withdrawal)]);
    await env.fails("InvalidDealState", env.admin, [await env.recordCostIx(1n, USDC)]);
    expect(Object.keys(env.deal(1n).state)[0]).to.eq("active");
  });

  it("провал сбора: всё, кроме возврата взносов и вывода депозита, отклоняется", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n });
    const inv = await env.createUser();
    await env.deposit(1n, inv.userId, 1_000n * USDC);
    const stranger = await env.newSigner();
    env.setTime(DEADLINE);
    await env.ok(env.operator, [await env.closeFundingIx(1n, env.operator)]);
    expect(Object.keys(env.deal(1n).state)[0]).to.eq("failed");
    env.topUp(env.repayAddress(1n), 1_000n * USDC);

    await env.fails("InvalidDealState", env.operator, [await env.closeFundingIx(1n, env.operator)]);
    await env.fails("InvalidDealState", env.admin, [await cancelIx(env, 1n)]);
    await env.fails("InvalidDealState", env.operator, [await env.investIx(1n, inv.userId)]);
    await env.fails("InvalidDealState", env.operator, [await env.processRepaymentIx(1n, env.operator)]);
    await env.fails("InvalidDealState", stranger, [await env.markDefaultIx(1n, stranger)]);
    await env.fails("InvalidDealState", env.operator, [await env.prepayFullIx(1n)]);
    await env.fails("InvalidDealState", env.operator, [await env.withdrawPayoutIx(1n, inv.userId, inv.withdrawal)]);
    await env.fails("InvalidDealState", env.admin, [await env.setBorrowerWalletIx(1n, pk(stranger))]);

    await env.ok(env.operator, [await env.withdrawRefundIx(1n, inv.userId, inv.withdrawal)]);
    await env.fails("NothingToWithdraw", env.operator, [await env.withdrawRefundIx(1n, inv.userId, inv.withdrawal)]);
    expect(env.balance(ata(env.mint, inv.withdrawal))).to.eq(1_000n * USDC);
  });

  it("дефолт: повторный дефолт, досрочное, возврат отклоняются", async () => {
    const env = await Env.create();
    const { periods, inv } = await activeDeal(env);
    const stranger = await env.newSigner();
    env.setTime(periods[0].dueTs + 90 * DAY);
    await env.ok(stranger, [await env.markDefaultIx(1n, stranger)]);

    await env.fails("InvalidDealState", stranger, [await env.markDefaultIx(1n, stranger)]);
    env.topUp(env.repayAddress(1n), 200_000n * USDC);
    await env.fails("InvalidDealState", env.operator, [await env.prepayFullIx(1n)]);
    await env.fails("InvalidDealState", env.operator, [await env.withdrawRefundIx(1n, inv.userId, inv.withdrawal)]);
  });

  it("погашен: обработка, дефолт, досрочное, расходы отклоняются; выплата работает", async () => {
    const env = await Env.create();
    const { inv } = await activeDeal(env);
    const stranger = await env.newSigner();
    env.topUp(env.repayAddress(1n), 200_000n * USDC);
    await env.ok(env.operator, [await env.prepayFullIx(1n)]);
    expect(Object.keys(env.deal(1n).state)[0]).to.eq("repaid");

    await env.fails("InvalidDealState", env.operator, [await env.processRepaymentIx(1n, env.operator)]);
    await env.fails("InvalidDealState", stranger, [await env.processRepaymentIx(1n, stranger)]);
    await env.fails("InvalidDealState", stranger, [await env.markDefaultIx(1n, stranger)]);
    await env.fails("InvalidDealState", env.operator, [await env.prepayFullIx(1n)]);
    await env.fails("InvalidDealState", env.operator, [await env.prepayPartialIx(1n, USDC)]);
    await env.fails("InvalidDealState", env.admin, [await env.recordCostIx(1n, USDC)]);
    await env.fails("InvalidDealState", env.operator, [await env.withdrawRefundIx(1n, inv.userId, inv.withdrawal)]);

    await env.ok(env.operator, [await env.withdrawPayoutIx(1n, inv.userId, inv.withdrawal)]);
    expect(env.balance(ata(env.mint, inv.withdrawal)) > 100_000n * USDC).to.eq(true);
  });

  it("нулевые суммы: зачисление с пустого адреса, частичное досрочное 0, расходы 0", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n });
    const empty = await env.createUser();
    await env.ok(env.operator, [await env.openDepositIx(1n, empty.userId)]);
    await env.fails("NothingToProcess", env.operator, [await env.investIx(1n, empty.userId)]);
    const inv = await env.createUser();
    await env.deposit(1n, inv.userId, 100_000n * USDC);
    env.setTime(DEADLINE);
    await env.ok(env.operator, [await env.closeFundingIx(1n, env.operator)]);
    const periods = env.deal(1n).periods.map((p: any) => ({ dueTs: p.dueTs.toNumber() }));
    env.setTime(periods[0].dueTs);
    env.topUp(env.repayAddress(1n), 20_000n * USDC);
    await env.fails("InvalidPrepaymentAmount", env.operator, [await env.prepayPartialIx(1n, 0n)]);

    const stranger = await env.newSigner();
    env.setTime(periods[0].dueTs + 90 * DAY);
    await env.ok(stranger, [await env.markDefaultIx(1n, stranger)]);
    await env.fails("InvalidAmount", env.admin, [await env.recordCostIx(1n, 0n)]);
  });
});

describe("разрешённые токены", () => {
  it("восьмой токен проходит, девятый — TooManyMints; повторное разрешение не дублирует; после удаления место освобождается", async () => {
    const env = await Env.create();
    const mints = Array.from({ length: 7 }, () => env.createMint(6));
    for (const mint of mints) await env.allowMint(mint);
    expect(env.platform().allowedMints.length).to.eq(8);

    const ninth = env.createMint(6);
    let failed = false;
    try {
      await env.allowMint(ninth);
    } catch (e: any) {
      failed = true;
      expect(e.message).to.include("TooManyMints");
    }
    expect(failed, "девятый токен").to.eq(true);

    await env.allowMint(mints[0]);
    expect(env.platform().allowedMints.length).to.eq(8);

    await env.ok(env.admin, [await removeMintIx(env, mints[0])]);
    await env.allowMint(ninth);
    expect(env.platform().allowedMints.map((m: PublicKey) => m.toBase58())).to.include(ninth.toBase58());
  });

  it("удаление токена: только admin; уже созданная кампания в нём продолжает работать", async () => {
    const env = await Env.create();
    const stranger = await env.newSigner();
    await env.createCampaign({ id: 1n });
    await env.fails("Unauthorized", stranger, [await removeMintIx(env, env.mint, stranger)]);
    await env.ok(env.admin, [await removeMintIx(env, env.mint)]);

    await env.fails("MintNotAllowed", env.admin, [await env.campaignIx({ id: 2n })]);
    const inv = await env.createUser();
    await env.deposit(1n, inv.userId, 100_000n * USDC);
    env.setTime(DEADLINE);
    await env.ok(env.operator, [await env.closeFundingIx(1n, env.operator)]);
    expect(Object.keys(env.deal(1n).state)[0]).to.eq("active");
  });
});

describe("адреса, созданные заранее посторонним", () => {
  async function createAtaBy(env: Env, payer: KeyPairSigner, owner: PublicKey) {
    await env.ok(payer, [
      createAssociatedTokenAccountInstruction(pk(payer), ata(env.mint, owner), owner, env.mint),
    ]);
  }

  it("адрес пополнения создан и пополнен до open_deposit: открытие проходит, деньги зачисляются", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n });
    const inv = await env.createUser();
    const stranger = await env.newSigner();
    const owner = depositOwnerPda(dealPda(1n), inv.userId);
    await createAtaBy(env, stranger, owner);
    env.topUp(env.depositAddress(1n, inv.userId), 5_000n * USDC);

    await env.ok(env.operator, [await env.openDepositIx(1n, inv.userId)]);
    await env.ok(env.operator, [await env.investIx(1n, inv.userId)]);
    expect(big(env.position(1n, inv.userId).principal)).to.eq(5_000n * USDC);
  });

  it("счёт вывода инвестора и счёт заёмщика созданы заранее: вывод и закрытие сбора проходят", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n });
    const inv = await env.createUser();
    const stranger = await env.newSigner();
    await createAtaBy(env, stranger, pk(env.borrower));
    await createAtaBy(env, stranger, inv.withdrawal);
    await env.deposit(1n, inv.userId, 100_000n * USDC);
    env.setTime(DEADLINE);
    await env.ok(env.operator, [await env.closeFundingIx(1n, env.operator)]);
    expect(env.balance(ata(env.mint, pk(env.borrower)))).to.eq(100_000n * USDC);

    env.setTime(env.deal(1n).periods[0].dueTs.toNumber());
    await env.repay(1n, 10_000n * USDC);
    await env.ok(env.operator, [await env.withdrawPayoutIx(1n, inv.userId, inv.withdrawal)]);
    expect(env.balance(ata(env.mint, inv.withdrawal)) > 0n).to.eq(true);
  });

  it("волт и адрес погашения созданы и пополнены заранее: кампания создаётся, лишнее в волте — пыль, на адресе погашения — платёж", async () => {
    const env = await Env.create();
    const stranger = await env.newSigner();
    const deal = dealPda(1n);
    const vault = ata(env.mint, deal);
    await createAtaBy(env, stranger, deal);
    await createAtaBy(env, stranger, repayOwnerPda(deal));
    env.topUp(vault, 7n * USDC);
    env.topUp(env.repayAddress(1n), 500n * USDC);

    const { periods } = await env.createCampaign({ id: 1n });
    const inv = await env.createUser();
    await env.deposit(1n, inv.userId, 100_000n * USDC);
    expect(big(env.deal(1n).totalRaised)).to.eq(100_000n * USDC);

    env.setTime(DEADLINE);
    await env.ok(env.operator, [await env.closeFundingIx(1n, env.operator)]);
    expect(env.balance(ata(env.mint, pk(env.borrower)))).to.eq(100_000n * USDC);
    expect(env.balance(vault)).to.eq(7n * USDC);

    // 500 от постороннего + платёж заёмщика закрывают первый платёж, остаток — аванс.
    env.setTime(periods[0].dueTs);
    await env.repay(1n, 8_500n * USDC);
    await env.ok(env.operator, [await env.withdrawPayoutIx(1n, inv.userId, inv.withdrawal)]);
    expect(env.balance(ata(env.mint, inv.withdrawal))).to.eq(9_000n * USDC);
    expect(env.balance(vault)).to.eq(7n * USDC);
  });
});
