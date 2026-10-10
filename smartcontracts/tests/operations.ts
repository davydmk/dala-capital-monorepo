/**
 * Операционные сценарии: частичное взыскание с повторными выводами, смена оператора
 * посреди займа, депозит после закрытия сбора, точные границы по времени,
 * точные суммы просрочки и дефолта.
 */
import { expect } from "chai";
import {
  ata,
  big,
  common,
  dealPda,
  events,
  DAY,
  Env,
  pk,
  platformPda,
  program,
  T0,
  USDC,
} from "./helpers";

const DEADLINE = T0 + 10 * DAY;
const TOTAL = 100_000n * USDC;

async function fund(env: Env, id: bigint) {
  const { periods } = await env.createCampaign({ id });
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

describe("операционные сценарии", () => {
  it("дефолт: частичное взыскание, вывод, ещё поступление — второй вывод получает только прирост", async () => {
    const env = await Env.create();
    const { periods, investors } = await fund(env, 1n);
    await close(env, 1n);
    const stranger = await env.newSigner();
    env.setTime(periods[0].dueTs + 90 * DAY);
    await env.ok(stranger, [await env.markDefaultIx(1n, stranger)]);
    const inv = investors[0];
    const destination = ata(env.mint, inv.withdrawal);

    await env.repay(1n, 10_000n * USDC);
    await env.ok(env.operator, [await env.withdrawPayoutIx(1n, inv.userId, inv.withdrawal)]);
    const first = env.balance(destination);
    expect(Number(5_000n * USDC - first)).to.be.within(0, 3);

    await env.fails("NothingToWithdraw", env.operator, [
      await env.withdrawPayoutIx(1n, inv.userId, inv.withdrawal),
    ]);

    env.setTime(periods[0].dueTs + 150 * DAY);
    await env.repay(1n, 6_000n * USDC);
    await env.ok(env.operator, [await env.withdrawPayoutIx(1n, inv.userId, inv.withdrawal)]);
    const increment = env.balance(destination) - first;
    expect(Number(3_000n * USDC - increment)).to.be.within(0, 3);
  });

  it("смена оператора посреди займа: новый выводит и обрабатывает дефолт, старый отклоняется", async () => {
    const env = await Env.create();
    const { periods, investors } = await fund(env, 1n);
    await close(env, 1n);
    env.setTime(periods[0].dueTs);
    await env.repay(1n, payment(env, 1n, 0));

    const oldOperator = env.operator;
    const newOperator = await env.newSigner();
    await env.ok(env.admin, [
      await program.methods
        .updatePlatform(null, pk(newOperator), null, null)
        .accountsStrict({ admin: pk(env.admin), platform: platformPda(), ...common() })
        .instruction(),
    ]);

    const inv = investors[0];
    await env.fails("Unauthorized", oldOperator, [
      await env.withdrawPayoutIx(1n, inv.userId, inv.withdrawal),
    ]);
    env.operator = newOperator;
    await env.ok(newOperator, [await env.withdrawPayoutIx(1n, inv.userId, inv.withdrawal)]);
    expect(env.balance(ata(env.mint, inv.withdrawal)) > 0n).to.eq(true);

    const stranger = await env.newSigner();
    env.setTime(periods[1].dueTs + 90 * DAY);
    await env.ok(stranger, [await env.markDefaultIx(1n, stranger)]);
    env.topUp(env.repayAddress(1n), 1_000n * USDC);
    await env.fails("Unauthorized", oldOperator, [await env.processRepaymentIx(1n, oldOperator)]);
    await env.ok(newOperator, [await env.processRepaymentIx(1n, newOperator)]);
    expect(env.balance(env.repayAddress(1n))).to.eq(0n);
  });

  it("депозит пришёл после закрытия сбора: возвращается пользователю, адрес пополнения закрывается", async () => {
    const env = await Env.create();
    const { investors } = await fund(env, 1n);
    await close(env, 1n);
    const inv = investors[0];
    const depositToken = env.depositAddress(1n, inv.userId);

    env.topUp(depositToken, 500n * USDC);
    await env.fails("InvalidDealState", env.operator, [await env.investIx(1n, inv.userId)]);

    await env.ok(env.operator, [await env.withdrawDepositIx(1n, inv.userId, inv.withdrawal)]);
    expect(env.balance(ata(env.mint, inv.withdrawal))).to.eq(500n * USDC);
    expect(env.exists(depositToken)).to.eq(false);
  });
});

describe("точные границы по времени", () => {
  it("зачисление: до старта отклоняется, за секунду до дедлайна проходит, в дедлайн отклоняется", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n, fundingStart: T0 + DAY });
    const user = await env.createUser();
    await env.ok(env.operator, [await env.openDepositIx(1n, user.userId)]);
    const depositToken = env.depositAddress(1n, user.userId);

    env.topUp(depositToken, 1_000n * USDC);
    await env.fails("FundingNotStarted", env.operator, [await env.investIx(1n, user.userId)]);

    env.setTime(DEADLINE - 1);
    await env.ok(env.operator, [await env.investIx(1n, user.userId)]);

    env.topUp(depositToken, 1_000n * USDC);
    env.setTime(DEADLINE);
    await env.fails("FundingClosed", env.operator, [await env.investIx(1n, user.userId)]);
  });

  it("платёж ровно в секунду даты — без пени; через секунду пеня уже начислена", async () => {
    const onTime = await Env.create();
    const a = await fund(onTime, 1n);
    await close(onTime, 1n);
    const stranger = await onTime.newSigner();
    onTime.setTime(a.periods[0].dueTs);
    onTime.topUp(onTime.repayAddress(1n), payment(onTime, 1n, 0));
    await onTime.ok(stranger, [await onTime.processRepaymentIx(1n, stranger)]);
    expect(big(onTime.deal(1n).accPenalty)).to.eq(0n);
    expect(onTime.balance(onTime.repayAddress(1n))).to.eq(0n);

    const late = await Env.create();
    const b = await fund(late, 1n);
    await close(late, 1n);
    const lateStranger = await late.newSigner();
    late.setTime(b.periods[0].dueTs + 1);
    late.topUp(late.repayAddress(1n), payment(late, 1n, 0) + USDC);
    await late.ok(lateStranger, [await late.processRepaymentIx(1n, lateStranger)]);
    expect(big(late.deal(1n).accPenalty) > 0n).to.eq(true, "пеня за одну секунду");
  });

  it("дефолт: за секунду до порога отклоняется, ровно на пороге проходит", async () => {
    const env = await Env.create();
    const { periods } = await fund(env, 1n);
    await close(env, 1n);
    const stranger = await env.newSigner();

    env.setTime(periods[0].dueTs + 90 * DAY - 1);
    await env.fails("DefaultThresholdNotReached", stranger, [await env.markDefaultIx(1n, stranger)]);
    env.setTime(periods[0].dueTs + 90 * DAY);
    await env.ok(stranger, [await env.markDefaultIx(1n, stranger)]);
    expect(big(env.deal(1n).defaultPrincipal)).to.eq(TOTAL);
  });

  it("частичное досрочное: в последнюю секунду суток даты платежа проходит, через секунду отклоняется", async () => {
    const env = await Env.create();
    const { periods } = await fund(env, 1n);
    await close(env, 1n);
    env.setTime(periods[0].dueTs);
    await env.repay(1n, payment(env, 1n, 0));

    env.topUp(env.repayAddress(1n), 2_020n * USDC);
    env.setTime(periods[0].dueTs + DAY);
    await env.fails("NotPaymentDate", env.operator, [await env.prepayPartialIx(1n, 1_000n * USDC)]);

    env.setTime(periods[0].dueTs + DAY - 1);
    await env.ok(env.operator, [await env.prepayPartialIx(1n, 1_000n * USDC)]);
  });
});

// ── Просрочка и дефолт: точные суммы ────────────────────────────────────────

const RATE_BPS = 1_000n;
const PENALTY_BPS = 2_000n;
const ACCRUAL_DENOMINATOR = 10_000n * 360n * 86_400n;

/**
 * Повторяет начисление программы: на просроченное тело — проценты по ставке займа,
 * на просроченное тело и проценты — пеня, с переносом остатков от деления.
 * `missed` — неоплаченные платежи по порядку, начисление идёт до `until`.
 */
function simulateOverdue(missed: { dueTs: number; principal: bigint; interest: bigint }[], until: number) {
  let principal = 0n;
  let scheduledInterest = 0n;
  let extraInterest = 0n;
  let penalty = 0n;
  let interestCarry = 0n;
  let penaltyCarry = 0n;
  let last = missed[0].dueTs;

  const interval = (seconds: bigint) => {
    if (seconds <= 0n) return;
    const interestBase = scheduledInterest + extraInterest;
    if (principal > 0n) {
      const n = principal * RATE_BPS * seconds + interestCarry;
      extraInterest += n / ACCRUAL_DENOMINATOR;
      interestCarry = n % ACCRUAL_DENOMINATOR;
    }
    const base = principal + interestBase;
    if (base > 0n) {
      const n = base * PENALTY_BPS * seconds + penaltyCarry;
      penalty += n / ACCRUAL_DENOMINATOR;
      penaltyCarry = n % ACCRUAL_DENOMINATOR;
    }
  };

  for (const p of missed) {
    interval(BigInt(p.dueTs - last));
    last = p.dueTs;
    principal += p.principal;
    scheduledInterest += p.interest;
  }
  interval(BigInt(until - last));
  return { principal, scheduledInterest, extraInterest, penalty };
}

function periodOf(env: Env, id: bigint, k: number) {
  const p = env.deal(id).periods[k];
  return { dueTs: Number(big(p.dueTs)), principal: big(p.principalAmount), interest: big(p.interestAmount) };
}

/** Единственное событие с таким именем; числа — строками. */
function onlyEvent(result: any, name: string): Record<string, string> {
  const evs = events(result).filter((e) => e.name === name);
  expect(evs.length, name).to.eq(1);
  return Object.fromEntries(Object.entries(evs[0].data).map(([k, v]) => [k, String(v)]));
}

describe("просрочка и дефолт: точные суммы", () => {
  it("три платежа пропущены, через 10 дней после третьего всё закрыто одним переводом — займ возвращается в график", async () => {
    const env = await Env.create();
    await fund(env, 1n);
    await close(env, 1n);
    const stranger = await env.newSigner();
    const missed = [0, 1, 2].map((k) => periodOf(env, 1n, k));
    const cureAt = missed[2].dueTs + 10 * DAY;
    env.setTime(cureAt);

    // 70 дней просрочки — до порога 90 далеко.
    await env.fails("DefaultThresholdNotReached", stranger, [await env.markDefaultIx(1n, stranger)]);

    const sim = simulateOverdue(missed, cureAt);
    const due = sim.principal + sim.scheduledInterest + sim.extraInterest + sim.penalty;

    // Заёмщик присылает с запасом; посторонний проводит ровно причитающееся, остаток ждёт следующей даты.
    env.topUp(env.repayAddress(1n), due + 1_000n * USDC);
    const result = await env.ok(stranger, [await env.processRepaymentIx(1n, stranger)]);
    const ev = onlyEvent(result, "repaymentProcessed");
    expect(ev.received).to.eq(due.toString());
    expect(ev.principal).to.eq(sim.principal.toString());
    expect(ev.interest).to.eq((sim.scheduledInterest + sim.extraInterest).toString());
    expect(ev.penalty).to.eq(sim.penalty.toString());
    expect(ev.advance).to.eq("0");
    expect(env.balance(env.repayAddress(1n))).to.eq(1_000n * USDC);

    const deal = env.deal(1n);
    for (const field of ["overduePrincipal", "overdueScheduledInterest", "extraInterest", "penalty"]) {
      expect(big(deal[field]), field).to.eq(0n);
    }
    expect(deal.nextPeriod).to.eq(3);

    // Дальше строго по графику: остаток 1 000 уходит в четвёртый платёж.
    for (let k = 3; k < 12; k++) {
      const p = periodOf(env, 1n, k);
      env.setTime(p.dueTs);
      const topUp = p.principal + p.interest - (k === 3 ? 1_000n * USDC : 0n);
      await env.repay(1n, topUp, stranger);
      expect(big(env.deal(1n).penalty), `пеня после платежа ${k + 1}`).to.eq(0n);
    }
    expect(Object.keys(env.deal(1n).state)[0]).to.eq("repaid");
    expect(env.balance(env.repayAddress(1n))).to.eq(0n);
    console.log(
      `      просрочка 3 платежей: проценты на просрочку ${Number(sim.extraInterest) / 1e6}, пеня ${Number(sim.penalty) / 1e6}, итого ${Number(due) / 1e6}`
    );
  });

  it("расходы на взыскание больше взысканного: всё уходит в казну, инвесторам ничего; излишек — инвесторам", async () => {
    const env = await Env.create();
    const { periods, investors } = await fund(env, 1n);
    await close(env, 1n);
    const stranger = await env.newSigner();
    env.setTime(periods[0].dueTs + 90 * DAY);
    await env.ok(stranger, [await env.markDefaultIx(1n, stranger)]);
    await env.ok(env.admin, [await env.recordCostIx(1n, 5_000n * USDC)]);

    const treasury = ata(env.mint, pk(env.treasury));
    const vault = ata(env.mint, dealPda(1n));
    const treasuryBefore = env.balance(treasury);
    const vaultBefore = env.balance(vault);

    env.topUp(env.repayAddress(1n), 3_000n * USDC);
    let result = await env.ok(env.operator, [await env.processRepaymentIx(1n, env.operator)]);
    let ev = onlyEvent(result, "repaymentProcessed");
    expect(ev.recovery).to.eq((3_000n * USDC).toString());
    expect([ev.interest, ev.principal, ev.penalty]).to.deep.eq(["0", "0", "0"]);
    expect(env.balance(treasury) - treasuryBefore).to.eq(3_000n * USDC);
    expect(env.balance(vault)).to.eq(vaultBefore);
    for (const inv of investors) {
      await env.fails("NothingToWithdraw", env.operator, [
        await env.withdrawPayoutIx(1n, inv.userId, inv.withdrawal),
      ]);
    }

    // Следующие 4 000: 2 000 закрывают расходы, 2 000 идут инвесторам в проценты.
    env.topUp(env.repayAddress(1n), 4_000n * USDC);
    result = await env.ok(env.operator, [await env.processRepaymentIx(1n, env.operator)]);
    ev = onlyEvent(result, "repaymentProcessed");
    expect(ev.recovery).to.eq((2_000n * USDC).toString());
    expect(ev.interest).to.eq((2_000n * USDC).toString());
    expect(env.balance(treasury) - treasuryBefore).to.eq(5_000n * USDC);
    expect(env.balance(vault) - vaultBefore).to.eq(2_000n * USDC);
    const deal = env.deal(1n);
    expect(big(deal.recoveryReimbursed)).to.eq(big(deal.recoveryCosts));

    // Инвестор с 50% получает ровно половину от 2 000.
    const inv = investors[0];
    await env.ok(env.operator, [await env.withdrawPayoutIx(1n, inv.userId, inv.withdrawal)]);
    expect(env.balance(ata(env.mint, inv.withdrawal))).to.eq(1_000n * USDC);
  });

  it("дефолт после четырёх оплаченных платежей: к взысканию только непогашенный остаток; полное взыскание сходится до единицы", async () => {
    const env = await Env.create();
    const { investors } = await fund(env, 1n);
    await close(env, 1n);
    const stranger = await env.newSigner();

    let paidPrincipal = 0n;
    let paidInterest = 0n;
    for (let k = 0; k < 4; k++) {
      const p = periodOf(env, 1n, k);
      env.setTime(p.dueTs);
      await env.repay(1n, p.principal + p.interest, stranger);
      paidPrincipal += p.principal;
      paidInterest += p.interest;
    }

    const fifth = periodOf(env, 1n, 4);
    const defaultAt = fifth.dueTs + 90 * DAY;
    env.setTime(defaultAt);
    const result = await env.ok(stranger, [await env.markDefaultIx(1n, stranger)]);
    const ev = onlyEvent(result, "defaultMarked");

    // За 90 дней после пятого наступают ещё шестой, седьмой и восьмой платежи.
    const missed = [4, 5, 6, 7].map((k) => periodOf(env, 1n, k));
    expect(missed[3].dueTs <= defaultAt && periodOf(env, 1n, 8).dueTs > defaultAt).to.eq(true);
    const sim = simulateOverdue(missed, defaultAt);
    const remaining = TOTAL - paidPrincipal;
    expect(ev.daysPastDue).to.eq("90");
    expect(ev.principal).to.eq(remaining.toString());
    // Проценты — наступивших платежей 5–8 плюс проценты на просроченное тело;
    // плановые проценты платежей 9–12 не требуются.
    expect(ev.interest).to.eq((sim.scheduledInterest + sim.extraInterest).toString());
    expect(ev.penalty).to.eq(sim.penalty.toString());

    const debt = remaining + sim.scheduledInterest + sim.extraInterest + sim.penalty;
    env.topUp(env.repayAddress(1n), debt);
    await env.ok(env.operator, [await env.processRepaymentIx(1n, env.operator)]);
    expect(Object.keys(env.deal(1n).state)[0]).to.eq("repaid");
    expect(env.balance(env.repayAddress(1n))).to.eq(0n);

    // Инвесторы вместе получили всё тело, проценты за 8 периодов, проценты на просрочку и пеню.
    let received = 0n;
    for (const inv of investors) {
      await env.ok(env.operator, [await env.withdrawPayoutIx(1n, inv.userId, inv.withdrawal)]);
      received += env.balance(ata(env.mint, inv.withdrawal));
    }
    const expected = TOTAL + paidInterest + sim.scheduledInterest + sim.extraInterest + sim.penalty;
    expect(Number(expected - received)).to.be.within(0, 12);
    console.log(
      `      дефолт после 4 платежей: тело ${Number(remaining) / 1e6}, проценты ${Number(sim.scheduledInterest + sim.extraInterest) / 1e6}, пеня ${Number(sim.penalty) / 1e6}`
    );
  });
});
