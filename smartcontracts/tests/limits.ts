/**
 * Худший случай по размеру транзакций и вычислениям: график на 60 платежей.
 * Жёсткий потолок Solana — 1 400 000 единиц вычислений на транзакцию; без инструкции
 * ComputeBudget транзакция получает 200 000 на инструкцию.
 */
import { expect } from "chai";
import { TransactionMetadata } from "litesvm";
import { big, DAY, Env, T0, USDC } from "./helpers";

const DEADLINE = T0 + 10 * DAY;
const PERIODS = 60;
const MAX_TX_SIZE = 1_232;
const HARD_CU_LIMIT = 1_400_000n;
const DEFAULT_CU_LIMIT = 200_000n;

const report: { operation: string; cu: bigint }[] = [];

async function funded60(env: Env) {
  const id = 1n;
  const { periods } = await env.createCampaign({ id, periods: PERIODS });
  const user = await env.createUser();
  await env.deposit(id, user.userId, 100_000n * USDC);
  env.setTime(DEADLINE);
  await env.ok(env.operator, [await env.closeFundingIx(id, env.operator)]);
  return { id, periods, user };
}

function measure(operation: string, result: TransactionMetadata) {
  const cu = result.computeUnitsConsumed();
  report.push({ operation, cu });
  expect(cu < HARD_CU_LIMIT, `${operation}: ${cu} CU превышает жёсткий лимит`).to.eq(true);
  return cu;
}

describe("лимиты: график на 60 платежей", () => {
  after(() => {
    console.log("\n    Потребление вычислений (CU):");
    for (const r of report) {
      const mark = r.cu > DEFAULT_CU_LIMIT ? "  ← нужен ComputeBudget" : "";
      console.log(`      ${r.operation.padEnd(58)} ${r.cu.toString().padStart(9)}${mark}`);
    }
  });

  it("загрузка графика частями по 20 помещается в транзакцию", async () => {
    const env = await Env.create();
    env.txSizes = [];
    await env.createCampaign({ id: 1n, periods: PERIODS });

    const [create, ...rest] = env.txSizes;
    const uploads = rest.slice(0, -1);
    console.log(`      create_campaign: ${create} байт; add_schedule_periods ×20: ${uploads.join(", ")} байт`);
    expect(uploads.length).to.eq(3);
    for (const size of env.txSizes) expect(size).to.be.at.most(MAX_TX_SIZE);

    const deal = env.deal(1n);
    expect(deal.periods.length).to.eq(PERIODS);
    expect(deal.scheduleFinalized).to.eq(true);
  });

  it("закрытие сбора: расчёт 60 платежей", async () => {
    const env = await Env.create();
    await env.createCampaign({ id: 1n, periods: PERIODS });
    const user = await env.createUser();
    await env.deposit(1n, user.userId, 100_000n * USDC);
    env.setTime(DEADLINE);
    measure("close_funding (60 платежей)", await env.ok(env.operator, [await env.closeFundingIx(1n, env.operator)]));
  });

  it("обработка поступления после всех 60 дат: начисление и распределение по всем периодам", async () => {
    const env = await Env.create();
    const { id, periods } = await funded60(env);

    env.setTime(periods[PERIODS - 1].dueTs + DAY);
    env.topUp(env.repayAddress(id), 1_000_000n * USDC);
    measure(
      "process_repayment после 60 наступивших платежей",
      await env.ok(env.operator, [await env.processRepaymentIx(id, env.operator)])
    );
    expect(Object.keys(env.deal(id).state)[0]).to.eq("repaid");
  });

  it("полное досрочное после 59 пропущенных платежей", async () => {
    const env = await Env.create();
    const { id, periods } = await funded60(env);

    env.setTime(periods[PERIODS - 2].dueTs + 15 * DAY);
    env.topUp(env.repayAddress(id), 1_000_000n * USDC);
    measure("prepay_full после 59 пропущенных платежей", await env.ok(env.operator, [await env.prepayFullIx(id)]));
    expect(Object.keys(env.deal(id).state)[0]).to.eq("repaid");
  });

  it("перевод в дефолт после всех 60 дат и обработка в дефолте", async () => {
    const env = await Env.create();
    const { id, periods } = await funded60(env);
    const stranger = await env.newSigner();

    env.setTime(periods[PERIODS - 1].dueTs + DAY);
    measure("mark_default после 60 наступивших платежей", await env.ok(stranger, [await env.markDefaultIx(id, stranger)]));
    expect(big(env.deal(id).defaultPrincipal)).to.eq(100_000n * USDC);

    await env.ok(env.admin, [await env.recordCostIx(id, 1_000n * USDC)]);
    env.setTime(periods[PERIODS - 1].dueTs + 100 * DAY);
    env.topUp(env.repayAddress(id), 1_000_000n * USDC);
    measure(
      "process_repayment в дефолте (расходы + весь долг)",
      await env.ok(env.operator, [await env.processRepaymentIx(id, env.operator)])
    );
    expect(Object.keys(env.deal(id).state)[0]).to.eq("repaid");
  });

  it("частичное досрочное в дату 1-го платежа: пересчёт 59 будущих платежей", async () => {
    const env = await Env.create();
    const { id, periods } = await funded60(env);
    const first = env.deal(id).periods[0];
    const payment = big(first.interestAmount) + big(first.principalAmount);

    env.setTime(periods[0].dueTs);
    env.topUp(env.repayAddress(id), payment + 20_200n * USDC);
    measure(
      "prepay_partial в дату 1-го платежа (пересчёт 59 платежей)",
      await env.ok(env.operator, [await env.prepayPartialIx(id, 20_000n * USDC)])
    );
  });

  it("выплата инвестору после полного погашения", async () => {
    const env = await Env.create();
    const { id, periods, user } = await funded60(env);
    env.setTime(periods[PERIODS - 1].dueTs + DAY);
    env.topUp(env.repayAddress(id), 1_000_000n * USDC);
    await env.ok(env.operator, [await env.processRepaymentIx(id, env.operator)]);

    measure(
      "withdraw_payout (кампания на 60 платежей)",
      await env.ok(env.operator, [await env.withdrawPayoutIx(id, user.userId, user.withdrawal)])
    );
  });
});
