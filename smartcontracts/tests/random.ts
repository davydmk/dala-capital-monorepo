/**
 * Случайные сценарии через настоящую программу в LiteSVM.
 *
 * Каждая успешная транзакция сверяется так:
 *   - событие ровно одно и нужного типа;
 *   - разбивка по статьям в событии складывается в итог;
 *   - движение по каждому токен-счёту совпадает с событием до единицы, остальные счета не меняются;
 *   - выплата инвестору равна рассчитанной вне программы по аккумуляторам.
 * Неуспешная транзакция допустима только с ожидаемой ошибкой и не меняет балансов.
 *
 * После каждого шага:
 *   - сохранение: сумма всех токен-счетов = всё, что пришло извне (депозиты и погашения);
 *   - волт покрывает причитающееся инвесторам, лишнее — не больше пыли от округления;
 *   - сумма позиций = total_raised.
 *
 * Сид и число сценариев: RANDOM_SEED, RANDOM_SCENARIOS.
 */
import { expect } from "chai";
import { FailedTransactionMetadata, TransactionMetadata } from "litesvm";
import { KeyPairSigner } from "@solana/kit";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  ata,
  big,
  dealPda,
  DecodedEvent,
  Env,
  events,
  pk,
  positionPda,
  SCALE,
  T0,
  USDC,
  DAY,
} from "./helpers";

const SEED = Number(process.env.RANDOM_SEED ?? 20260918);
const SCENARIOS = Number(process.env.RANDOM_SCENARIOS ?? 40);
const ID = 1n;
const DEADLINE = T0 + 10 * DAY;

function rngFrom(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const chance = (p: number) => next() < p;
  const pick = <T>(xs: T[]): T => xs[int(0, xs.length - 1)];
  /** Сумма в USDC с «неудобными» микроединицами. */
  const usdc = (lo: number, hi: number) => BigInt(int(lo, hi)) * USDC + BigInt(int(0, 999_999));
  return { next, int, chance, pick, usdc };
}

type Rng = ReturnType<typeof rngFrom>;

interface Investor {
  userId: number[];
  withdrawal: PublicKey;
  withdrawnPrincipal: bigint;
  payouts: number;
}

const stateOf = (deal: any) => Object.keys(deal.state)[0];
const key = (p: PublicKey) => p.toBase58();

/** Статистика по всем сценариям — чтобы убедиться, что случайность дошла до всех веток. */
const stats: Record<string, number> = {};
const count = (name: string) => (stats[name] = (stats[name] ?? 0) + 1);

class Scenario {
  env!: Env;
  stranger!: KeyPairSigner;
  investors: Investor[] = [];
  /** Всё, что пришло в систему извне. */
  injected = 0n;
  /** Поведение заёмщика: платит исправно, с перебоями или почти не платит. */
  profile: "good" | "late" | "bad" = "good";
  log: string[] = [];
  /** Успешные выводы выплат: каждый оставляет в волте дробный остаток < 1 единицы по каждой из 4 статей. */
  payouts = 0;

  seed: number;
  rng: Rng;

  constructor(seed: number, rng: Rng) {
    this.seed = seed;
    this.rng = rng;
  }

  // ── Счета ──────────────────────────────────────────────────────────────

  vault = () => ata(this.env.mint, dealPda(ID));
  borrowerToken = () => ata(this.env.mint, pk(this.env.borrower));
  treasuryToken = () => ata(this.env.mint, pk(this.env.treasury));
  depositToken = (inv: Investor) => this.env.depositAddress(ID, inv.userId);
  withdrawalToken = (inv: Investor) => ata(this.env.mint, inv.withdrawal);

  accounts(): PublicKey[] {
    return [
      this.vault(),
      this.env.repayAddress(ID),
      this.borrowerToken(),
      this.treasuryToken(),
      ...this.investors.flatMap((inv) => [this.depositToken(inv), this.withdrawalToken(inv)]),
    ];
  }

  snapshot(): Map<string, bigint> {
    return new Map(this.accounts().map((a) => [key(a), this.env.balance(a)]));
  }

  topUp(account: PublicKey, amount: bigint) {
    this.env.topUp(account, amount);
    this.injected += amount;
  }

  investorByUserId(userId: number[]): Investor {
    const inv = this.investors.find((i) => Buffer.from(i.userId).equals(Buffer.from(userId)));
    if (!inv) throw new Error("событие с неизвестным user_id");
    return inv;
  }

  // ── Отправка с проверками ──────────────────────────────────────────────

  /**
   * Отправляет транзакцию. При отказе — проверяет, что ошибка из списка допустимых
   * и балансы не изменились. При успехе — сверяет событие с движениями по счетам.
   */
  async step(
    label: string,
    payer: KeyPairSigner,
    ixs: TransactionInstruction[],
    allowed: string[],
    expectedPayout?: bigint[]
  ): Promise<DecodedEvent | null> {
    const before = this.snapshot();
    const result = await this.env.send(payer, ixs);
    this.log.push(`t=${this.env.now() - DEADLINE} ${label}`);

    if (result instanceof FailedTransactionMetadata) {
      const logs = result.meta().logs().join("\n");
      const code = /Error Code: (\w+)/.exec(logs)?.[1];
      if (!code || !allowed.includes(code)) {
        this.fail(`${label}: неожиданный отказ ${code ?? result.toString()}\n${logs}`);
      }
      this.log[this.log.length - 1] += ` → ${code}`;
      this.expectDeltas(label, before, new Map());
      count(`${label}: ${code}`);
      return null;
    }

    const evs = events(result as TransactionMetadata).filter((e) => e.name !== "depositOpened");
    if (evs.length !== 1) this.fail(`${label}: ожидалось одно событие, пришло ${evs.length}`);
    const ev = evs[0];
    this.log[this.log.length - 1] += ` → ${ev.name} ${JSON.stringify(ev.data, (_, v) =>
      v && v.constructor?.name === "BN" ? v.toString() : v
    )}`;
    this.expectDeltas(label, before, this.deltasFromEvent(label, ev, expectedPayout));
    count(`${label}: ok`);
    return ev;
  }

  /** Ожидаемые движения по счетам по событию. Попутно проверяет, что статьи складываются. */
  deltasFromEvent(label: string, ev: DecodedEvent, expectedPayout?: bigint[]): Map<string, bigint> {
    const d = ev.data;
    const n = (x: any) => big(x);
    const deltas = new Map<string, bigint>();
    const add = (account: PublicKey, amount: bigint) =>
      deltas.set(key(account), (deltas.get(key(account)) ?? 0n) + amount);

    switch (ev.name) {
      case "invested": {
        const inv = this.investorByUserId(d.userId);
        add(this.depositToken(inv), -n(d.amount));
        add(this.vault(), n(d.amount));
        break;
      }
      case "fundingClosed": {
        this.expectEq(label, n(d.platformFee) + n(d.payoutAmount), n(d.totalRaised), "комиссия + выдача");
        const deal = this.env.deal(ID);
        this.expectEq(
          label,
          n(d.platformFee),
          (n(d.totalRaised) * BigInt(deal.platformFeeBps)) / 10_000n,
          "комиссия платформы"
        );
        add(this.vault(), -n(d.totalRaised));
        add(this.treasuryToken(), n(d.platformFee));
        add(this.borrowerToken(), n(d.payoutAmount));
        break;
      }
      case "fundingFailed":
      case "defaultMarked":
      case "recoveryCostRecorded":
        break;
      case "repaymentProcessed": {
        // advance — не отдельная статья, а часть interest + principal, ушедшая в будущие платежи.
        const toVault = n(d.interest) + n(d.principal) + n(d.penalty);
        this.expectEq(label, toVault + n(d.recovery), n(d.received), "статьи поступления");
        if (n(d.advance) > n(d.interest) + n(d.principal)) this.fail(`${label}: аванс больше тела и процентов`);
        add(this.env.repayAddress(ID), -n(d.received));
        add(this.vault(), toVault);
        add(this.treasuryToken(), n(d.recovery));
        break;
      }
      case "earlyRepayment": {
        const parts = n(d.principal) + n(d.interest) + n(d.penalty) + n(d.prepaymentFee);
        this.expectEq(label, parts, n(d.total), "статьи досрочного");
        add(this.env.repayAddress(ID), -n(d.total));
        add(this.vault(), n(d.total));
        break;
      }
      case "payoutWithdrawn": {
        const parts = [d.principal, d.interest, d.penalty, d.prepaymentFee].map(n);
        this.expectEq(label, parts.reduce((a, b) => a + b, 0n), n(d.amount), "статьи выплаты");
        if (expectedPayout) {
          ["тело", "проценты", "пеня", "комиссия"].forEach((name, i) =>
            this.expectEq(label, parts[i], expectedPayout[i], `выплата: ${name}`)
          );
        }
        const inv = this.investorByUserId(d.userId);
        inv.withdrawnPrincipal += parts[0];
        this.payouts++;
        inv.payouts++;
        add(this.vault(), -n(d.amount));
        add(this.withdrawalToken(inv), n(d.amount));
        break;
      }
      case "refundWithdrawn": {
        const inv = this.investorByUserId(d.userId);
        add(this.vault(), -n(d.amount));
        add(this.withdrawalToken(inv), n(d.amount));
        break;
      }
      case "depositWithdrawn": {
        const inv = this.investorByUserId(d.userId);
        add(this.depositToken(inv), -n(d.amount));
        add(this.withdrawalToken(inv), n(d.amount));
        break;
      }
      default:
        this.fail(`${label}: неожиданное событие ${ev.name}`);
    }
    return deltas;
  }

  expectDeltas(label: string, before: Map<string, bigint>, expected: Map<string, bigint>) {
    const after = this.snapshot();
    for (const [account, was] of before) {
      const actual = (after.get(account) ?? 0n) - was;
      const want = expected.get(account) ?? 0n;
      if (actual !== want) {
        this.fail(`${label}: счёт ${account} изменился на ${actual}, по событию ${want}`);
      }
    }
    for (const account of expected.keys()) {
      if (!before.has(account)) this.fail(`${label}: событие затрагивает неизвестный счёт ${account}`);
    }
  }

  expectEq(label: string, actual: bigint, want: bigint, what: string) {
    if (actual !== want) this.fail(`${label}: ${what}: ${actual} ≠ ${want}`);
  }

  fail(message: string): never {
    throw new Error(
      `сид ${this.seed}: ${message}\nпоследние шаги:\n${this.log.slice(-15).join("\n")}`
    );
  }

  // ── Инварианты ─────────────────────────────────────────────────────────

  pending(inv: Investor): bigint[] {
    const deal = this.env.deal(ID);
    const pos = this.env.position(ID, inv.userId);
    const principal = big(pos.principal);
    const part = (acc: any, cp: any) => (principal * (big(acc) - big(cp))) / SCALE;
    return [
      part(deal.accPrincipal, pos.checkpointPrincipal),
      part(deal.accInterest, pos.checkpointInterest),
      part(deal.accPenalty, pos.checkpointPenalty),
      part(deal.accPrepaymentFee, pos.checkpointPrepaymentFee),
    ];
  }

  checkInvariants(where: string) {
    const snapshot = this.snapshot();
    const total = [...snapshot.values()].reduce((a, b) => a + b, 0n);
    this.expectEq(where, total, this.injected, "сохранение токенов");

    const deal = this.env.deal(ID);
    const state = stateOf(deal);
    const raised = big(deal.totalRaised);
    const positions = this.investors.filter((inv) => this.env.exists(this.positionAddress(inv)));
    const principals = positions.map((inv) => big(this.env.position(ID, inv.userId).principal));
    const vault = this.env.balance(this.vault());

    if (state === "funding") {
      this.expectEq(where, principals.reduce((a, b) => a + b, 0n), raised, "сумма позиций");
      this.expectEq(where, vault, raised, "волт на сборе");
      return;
    }
    if (state === "failed") {
      this.expectEq(where, vault, principals.reduce((a, b) => a + b, 0n), "волт при провале = невозвращённые взносы");
      return;
    }
    this.expectEq(where, principals.reduce((a, b) => a + b, 0n), raised, "сумма позиций");
    const owed = positions
      .map((inv) => this.pending(inv).reduce((a, b) => a + b, 0n))
      .reduce((a, b) => a + b, 0n);
    const dust = BigInt((positions.length + this.payouts) * 4) + raised / SCALE + 1n;
    if (vault < owed) this.fail(`${where}: волт ${vault} меньше причитающегося ${owed}`);
    if (vault - owed > dust) this.fail(`${where}: в волте лишние ${vault - owed} > пыли ${dust}`);
  }

  positionAddress(inv: Investor) {
    return positionPda(dealPda(ID), inv.userId);
  }

  // ── Сценарий ───────────────────────────────────────────────────────────

  async run() {
    const r = this.rng;
    this.env = await Env.create();
    const env = this.env;
    this.stranger = await env.newSigner();

    this.profile = r.pick(["good", "good", "late", "bad"]);
    count(`заёмщик: ${this.profile}`);
    const schedule = r.chance(0.65) ? "annuity" : "coupon";
    const hardCap = r.usdc(5_000, 300_000);
    const softCap = (hardCap * BigInt(r.int(20, 100))) / 100n;
    const minTicket = BigInt(r.int(1, 100)) * USDC;
    const maxTicket = r.chance(0.3) ? hardCap / BigInt(r.int(2, 4)) : 0n;
    const periods = r.int(1, 24);
    const params = {
      id: ID,
      schedule: schedule as "annuity" | "coupon",
      hardCap,
      softCap: softCap < minTicket ? minTicket : softCap,
      minTicket,
      maxTicket: maxTicket !== 0n && maxTicket < minTicket ? minTicket : maxTicket,
      periods,
      rateBps: r.int(100, 3_000),
      penaltyBps: r.pick([0, r.int(100, 5_000)]),
      thresholdDays: r.int(10, 120),
      prepaymentFeeBps: schedule === "annuity" ? r.int(0, 300) : 0,
      platformFeeBps: r.int(0, 500),
    };
    this.log.push(`заёмщик ${this.profile}`);
    this.log.push(`кампания ${JSON.stringify(params, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    const { periods: dates } = await env.createCampaign(params);
    count(`кампания: ${schedule}`);

    await this.funding(params.softCap, hardCap);
    this.checkInvariants("после сбора");

    env.setTime(DEADLINE + r.int(0, 2 * 3600));
    const closed = await this.step("close_funding", env.operator, [
      await env.closeFundingIx(ID, env.operator),
    ], []);
    this.checkInvariants("после закрытия сбора");

    if (closed!.name === "fundingFailed") {
      count("сбор провалился");
      await this.refundAll();
      return;
    }

    const lastDue = dates[dates.length - 1].dueTs;
    const ops = r.int(20, 90);
    for (let i = 0; i < ops && stateOf(env.deal(ID)) !== "repaid"; i++) {
      await this.randomOp(lastDue);
      this.checkInvariants(`после шага ${i}`);
    }
    await this.settleAndWithdraw();
  }

  async funding(softCap: bigint, hardCap: bigint) {
    const r = this.rng;
    const env = this.env;
    const failFunding = r.chance(0.12);
    const n = r.int(1, 6);
    let raised = 0n;
    for (let k = 0; k < n; k++) {
      const user = await env.createUser();
      const inv: Investor = { ...user, withdrawnPrincipal: 0n, payouts: 0 };
      this.investors.push(inv);
      await env.ok(env.operator, [await env.openDepositIx(ID, inv.userId)]);

      const deal = env.deal(ID);
      let amount = r.usdc(Number(big(deal.minTicket) / USDC), Number(hardCap / USDC / 2n) + 1);
      // Последний инвестор добирает до soft cap, если сбор должен пройти.
      if (k === n - 1 && !failFunding && raised + amount < softCap) amount = softCap - raised + r.usdc(0, 1_000);
      if (failFunding && raised + amount >= softCap) amount = big(deal.minTicket);
      this.topUp(this.depositToken(inv), amount);

      const ev = await this.step("invest", env.operator, [await env.investIx(ID, inv.userId)], [
        "NoCapacity",
        "BelowMinTicket",
      ]);
      if (ev) raised += big(ev.data.amount);
      // Сверх hard cap или max_ticket остаётся на адресе пополнения.
      if (r.chance(0.5)) await this.withdrawDeposit(inv);
    }
  }

  async withdrawDeposit(inv: Investor) {
    await this.step(
      "withdraw_deposit",
      this.env.operator,
      [await this.env.withdrawDepositIx(ID, inv.userId, inv.withdrawal)],
      // Адрес пополнения закрывается после вывода, если кампания уже не на сборе.
      ["NothingToWithdraw", "AccountNotInitialized"]
    );
  }

  async refundAll() {
    for (const inv of this.investors) {
      await this.step(
        "withdraw_refund",
        this.env.operator,
        [await this.env.withdrawRefundIx(ID, inv.userId, inv.withdrawal)],
        ["NothingToWithdraw"]
      );
      await this.withdrawDeposit(inv);
      this.checkInvariants("после возврата");
    }
    this.expectEq("после всех возвратов", this.env.balance(this.vault()), 0n, "пустой волт");
  }

  nextPayment(): { dueTs: number; amount: bigint } | null {
    const deal = this.env.deal(ID);
    const k = Number(deal.nextPeriod);
    const p = deal.periods[k];
    if (!p) return null;
    return {
      dueTs: Number(big(p.dueTs)),
      amount: big(p.interestAmount) + big(p.principalAmount) - big(p.interestPaid) - big(p.principalPaid),
    };
  }

  async randomOp(lastDue: number) {
    const r = this.rng;
    const env = this.env;
    const now = env.now();
    const next = this.nextPayment();
    const raised = big(env.deal(ID).totalRaised);
    let roll = r.next();
    // Плохой заёмщик почти не платит и не гасит досрочно; опаздывающий платит реже.
    const skip = this.profile === "bad" ? 0.85 : this.profile === "late" ? 0.4 : 0;
    if (((roll >= 0.25 && roll < 0.5) || (roll >= 0.8 && roll < 0.9)) && r.chance(skip)) roll = 0;

    if (roll < 0.25) {
      // Время: чуть вперёд, в дату следующего платежа или далеко вперёд.
      const choice = r.int(0, 2);
      let t = now + r.int(3600, 10 * DAY);
      if (choice === 1 && next && next.dueTs > now) t = next.dueTs + r.pick([0, r.int(0, DAY - 1)]);
      if (choice === 2) t = now + r.int(20, 70) * DAY;
      env.setTime(Math.min(t, lastDue + 500 * DAY));
      return;
    }

    if (roll < 0.5) {
      // Заёмщик платит: ровно платёж, часть, с запасом или случайно.
      const base = next?.amount ?? raised / 10n;
      const amount = r.pick([
        base,
        (base * BigInt(r.int(10, 90))) / 100n,
        (base * BigInt(r.int(110, 250))) / 100n,
        r.usdc(1, 5_000),
      ]);
      if (amount > 0n) this.topUp(env.repayAddress(ID), amount);
      const caller = r.chance(0.5) ? env.operator : this.stranger;
      const who = caller === env.operator ? "оператор" : "посторонний";
      await this.step(`process_repayment (${who})`, caller, [await env.processRepaymentIx(ID, caller)], [
        "NothingToProcess",
        "InvalidDealState",
        ...(caller === env.operator ? [] : ["Unauthorized"]),
      ]);
      return;
    }

    if (roll < 0.68) {
      const inv = r.pick(this.investors);
      if (!this.env.exists(this.positionAddress(inv))) return;
      const expected = this.pending(inv);
      await this.step(
        "withdraw_payout",
        env.operator,
        [await env.withdrawPayoutIx(ID, inv.userId, inv.withdrawal)],
        ["NothingToWithdraw"],
        expected
      );
      return;
    }

    if (roll < 0.76) {
      await this.step("mark_default", this.stranger, [await env.markDefaultIx(ID, this.stranger)], [
        "DefaultThresholdNotReached",
        "InvalidDealState",
      ]);
      return;
    }

    if (roll < 0.8) {
      await this.step("record_recovery_cost", env.admin, [await env.recordCostIx(ID, r.usdc(1, 3_000))], [
        "InvalidDealState",
      ]);
      return;
    }

    if (roll < 0.83) {
      this.topUp(env.repayAddress(ID), raised * 2n);
      await this.step("prepay_full", env.operator, [await env.prepayFullIx(ID)], [
        "InvalidDealState",
        "PrepaymentNotAllowed",
        "NothingToProcess",
      ]);
      return;
    }

    if (roll < 0.9) {
      // Частичное досрочное: встаём в сутки даты платежа и гасим часть тела.
      if (next && next.dueTs >= now) env.setTime(next.dueTs + r.pick([0, r.int(0, DAY - 1)]));
      const amount = r.chance(0.1) ? raised * 2n : (raised * BigInt(r.int(1, 30))) / 100n + BigInt(r.int(0, 999));
      this.topUp(env.repayAddress(ID), amount * 2n + (next?.amount ?? 0n) * 3n + raised / 2n);
      await this.step("prepay_partial", env.operator, [await env.prepayPartialIx(ID, amount)], [
        "InvalidDealState",
        "PrepaymentNotAllowed",
        "NotPaymentDate",
        "HasOverdue",
        "HasAdvance",
        "InvalidPrepaymentAmount",
        "InsufficientRepayBalance",
      ]);
      return;
    }

    if (roll < 0.95) {
      await this.withdrawDeposit(r.pick(this.investors));
      return;
    }

    // Посторонний дёргает обработку без новых денег.
    await this.step("process_repayment (посторонний, без денег)", this.stranger, [
      await env.processRepaymentIx(ID, this.stranger),
    ], ["NothingToProcess", "InvalidDealState", "Unauthorized"]);
  }

  /** Доводит займ до погашения и выводит всё. Проверяет, что тело вернулось полностью. */
  async settleAndWithdraw() {
    const env = this.env;
    const state = stateOf(env.deal(ID));
    count(`конец: ${state}`);
    if (state !== "repaid") {
      env.setTime(env.now() + this.rng.int(0, 30) * DAY);
      this.topUp(env.repayAddress(ID), big(env.deal(ID).totalRaised) * 3n);
      await this.step("финальное погашение", env.operator, [await env.processRepaymentIx(ID, env.operator)], []);
      this.checkInvariants("после финального погашения");
      this.expectEq("финал", BigInt(stateOf(env.deal(ID)) === "repaid" ? 1 : 0), 1n, "займ погашен");
    }

    for (const inv of this.investors) {
      if (!env.exists(this.positionAddress(inv))) continue;
      for (let attempt = 0; attempt < 2; attempt++) {
        await this.step(
          "финальный вывод",
          env.operator,
          [await env.withdrawPayoutIx(ID, inv.userId, inv.withdrawal)],
          ["NothingToWithdraw"],
          this.pending(inv)
        );
      }
      // Второй вывод подряд обязан быть пустым.
      const leftover = this.pending(inv).reduce((a, b) => a + b, 0n);
      this.expectEq("финал", leftover, 0n, "после вывода ничего не причитается");
      const principal = big(env.position(ID, inv.userId).principal);
      const shortfall = principal - inv.withdrawnPrincipal;
      // Каждый вывод округляет тело вниз меньше чем на единицу.
      if (shortfall < 0n || shortfall > BigInt(inv.payouts) + 1n) {
        this.fail(`финал: инвестор вернул тело ${inv.withdrawnPrincipal} из ${principal}`);
      }
    }
    this.checkInvariants("после всех выводов");
  }
}

describe("случайные сценарии через программу", () => {
  it(`${SCENARIOS} сценариев, сид ${SEED}: события = движения по счетам, токены сохраняются`, async () => {
    for (let s = 0; s < SCENARIOS; s++) {
      const seed = SEED + s;
      await new Scenario(seed, rngFrom(seed)).run();
    }

    const lines = Object.entries(stats).sort(([a], [b]) => a.localeCompare(b));
    console.log(lines.map(([k, v]) => `      ${k}: ${v}`).join("\n"));

    // Случайность должна дойти до всех ключевых веток.
    const need = [
      "сбор провалился",
      "конец: default",
      "конец: active",
      "prepay_full: ok",
      "prepay_partial: ok",
      "mark_default: ok",
      "record_recovery_cost: ok",
      "process_repayment (посторонний): ok",
      "process_repayment (оператор): ok",
      "withdraw_payout: ok",
      "withdraw_deposit: ok",
    ];
    for (const name of need) expect(stats[name] ?? 0, name).to.be.greaterThan(0);
  });
});
