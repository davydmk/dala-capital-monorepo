//! Фаззинг учёта: случайные кампании, суммы, время и последовательности операций.
//! После каждого шага проверяются инварианты. При падении сообщение содержит seed —
//! сценарий воспроизводится запуском с тем же seed.

use anchor_lang::error::{Error, ERROR_CODE_OFFSET};
use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::DalaError;
use crate::math::pending;
use crate::state::{Allocation, Deal, DealState, Period, ScheduleType};

const SCENARIOS: u64 = 2_000;
const DEADLINE: i64 = 1_700_000_000;
const DAY: i64 = SECONDS_PER_DAY;

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    /// Равномерно в [lo, hi] включительно.
    fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.next() % (hi - lo + 1)
    }
    fn chance(&mut self, percent: u64) -> bool {
        self.next() % 100 < percent
    }
}

fn random_deal(rng: &mut Rng) -> Deal {
    let n = rng.range(1, MAX_PERIODS as u64) as usize;
    let schedule_type = if rng.chance(30) { ScheduleType::Coupon } else { ScheduleType::Annuity };
    let periods_per_year = [1u8, 2, 4, 12][rng.range(0, 3) as usize];
    let period_len = 365 * DAY / periods_per_year as i64;

    let fractions: Vec<u64> = if schedule_type == ScheduleType::Coupon {
        (0..n).map(|k| if k + 1 == n { SCALE as u64 } else { 0 }).collect()
    } else {
        let weights: Vec<u64> = (0..n).map(|_| rng.range(1, 1_000)).collect();
        let total: u64 = weights.iter().sum();
        let mut sum = 0u64;
        weights
            .iter()
            .enumerate()
            .map(|(k, w)| {
                let f = if k + 1 == n { SCALE as u64 - sum } else { (*w as u128 * SCALE / total as u128) as u64 };
                sum += f;
                f
            })
            .collect()
    };

    let periods = fractions
        .into_iter()
        .enumerate()
        .map(|(k, principal_fraction)| Period {
            due_ts: DEADLINE + period_len * (k as i64 + 1),
            principal_fraction,
            ..Period::default()
        })
        .collect();

    let total_raised = rng.range(1_000, 1_000_000_000_000_000);
    let mut deal = Deal {
        platform: Pubkey::default(),
        campaign_id: 1,
        mint: Pubkey::default(),
        vault: Pubkey::default(),
        repay_account: Pubkey::default(),
        borrower_wallet: Pubkey::default(),
        soft_cap: 1,
        hard_cap: total_raised,
        min_ticket: 1,
        max_ticket: 0,
        funding_start: DEADLINE - DAY,
        funding_deadline: DEADLINE,
        schedule_type,
        annual_rate_bps: rng.range(1, 5_000) as u32,
        periods_per_year,
        penalty_rate_bps: rng.range(0, 10_000) as u32,
        default_threshold_days: rng.range(1, 120) as u16,
        prepayment_fee_bps: if schedule_type == ScheduleType::Annuity { rng.range(0, 500) as u32 } else { 0 },
        platform_fee_bps: 0,
        cancel_grace_days: 7,
        periods,
        schedule_finalized: true,
        state: DealState::Active,
        total_raised,
        next_period: 0,
        overdue_principal: 0,
        overdue_scheduled_interest: 0,
        extra_interest: 0,
        penalty: 0,
        default_principal: 0,
        default_interest: 0,
        interest_carry: 0,
        penalty_carry: 0,
        last_accrual_ts: DEADLINE,
        recovery_costs: 0,
        recovery_reimbursed: 0,
        acc_principal: 0,
        acc_interest: 0,
        acc_penalty: 0,
        acc_prepayment_fee: 0,
        carry_principal: 0,
        carry_interest: 0,
        carry_penalty: 0,
        carry_prepayment_fee: 0,
        bump: 0,
        repay_bump: 0,
    };
    deal.validate_schedule().unwrap();
    deal.build_schedule().unwrap();
    deal
}

/// Разбивает сумму сбора на 1–5 позиций.
fn random_positions(rng: &mut Rng, total: u64) -> Vec<u64> {
    let count = rng.range(1, 5.min(total)) as usize;
    let mut cuts: Vec<u64> = (1..count).map(|_| rng.range(1, total - 1)).collect();
    cuts.sort_unstable();
    cuts.dedup();
    let mut positions = Vec::new();
    let mut previous = 0;
    for cut in cuts {
        positions.push(cut - previous);
        previous = cut;
    }
    positions.push(total - previous);
    positions
}

/// Что реально выполнилось — чтобы фаззинг не проходил «вхолостую».
#[derive(Default, Debug)]
struct Stats {
    steps: u64,
    operator_payments: u64,
    stranger_payments: u64,
    advances: u64,
    partial_ok: u64,
    partial_rejected: u64,
    full_prepayments: u64,
    defaults: u64,
    default_payments: u64,
    repaid_during_steps: u64,
    max_periods_due: u64,
}

#[derive(Default)]
struct Ledger {
    taken: u128,
    recovery: u128,
    principal: u128,
    interest: u128,
    penalty: u128,
    fee: u128,
}

impl Ledger {
    fn record(&mut self, alloc: &Allocation) {
        self.principal += alloc.principal as u128;
        self.interest += alloc.interest as u128;
        self.penalty += alloc.penalty as u128;
        self.fee += alloc.prepayment_fee as u128;
    }
    fn to_investors(&self) -> u128 {
        self.principal + self.interest + self.penalty + self.fee
    }
}

fn check_invariants(seed: u64, step: usize, deal: &Deal, ledger: &Ledger, positions: &[u64]) {
    let ctx = format!("seed {seed}, шаг {step}");

    assert_eq!(
        ledger.to_investors() + ledger.recovery,
        ledger.taken,
        "{ctx}: взятое у заёмщика не разложено полностью"
    );
    assert!(
        ledger.principal <= deal.total_raised as u128,
        "{ctx}: тела выплачено больше собранного"
    );

    let buckets = [
        (deal.acc_principal, ledger.principal, "тело"),
        (deal.acc_interest, ledger.interest, "проценты"),
        (deal.acc_penalty, ledger.penalty, "пеня"),
        (deal.acc_prepayment_fee, ledger.fee, "комиссия"),
    ];
    for (acc, distributed, name) in buckets {
        let paid: u128 = positions
            .iter()
            .map(|&p| pending(p, acc, 0).unwrap() as u128)
            .sum();
        assert!(paid <= distributed, "{ctx}: {name}: выплаты {paid} > поступлений {distributed}");
        // Нераспределённое: округление вниз по каждой позиции (меньше единицы на позицию)
        // плюс остаток аккумулятора, перенесённый в следующее распределение
        // (меньше total_raised в масштабе SCALE).
        let bound = positions.len() as u128 + deal.total_raised as u128 / SCALE + 1;
        assert!(
            distributed - paid <= bound,
            "{ctx}: {name}: потери на округлении {} слишком велики",
            distributed - paid
        );
    }

    if deal.state == DealState::Active {
        assert!(
            deal.due_obligations().unwrap() <= deal.active_obligations().unwrap(),
            "{ctx}: причитающееся больше всего долга"
        );
    }
    if deal.state == DealState::Repaid {
        assert_eq!(
            ledger.principal,
            deal.total_raised as u128,
            "{ctx}: погашено, но тело выплачено не полностью"
        );
    }
}

fn expect_allowed(seed: u64, result: &Result<Allocation>) {
    if let Err(Error::AnchorError(e)) = result {
        let allowed = [
            DalaError::NotPaymentDate,
            DalaError::HasAdvance,
            DalaError::InvalidPrepaymentAmount,
        ];
        assert!(
            allowed.iter().any(|a| *a as u32 + ERROR_CODE_OFFSET == e.error_code_number),
            "seed {seed}: неожиданная ошибка частичного досрочного: {}",
            e.error_name
        );
    } else if let Err(other) = result {
        panic!("seed {seed}: неожиданная ошибка: {other:?}");
    }
}

fn pay_active(
    deal: &mut Deal,
    ledger: &mut Ledger,
    stats: &mut Stats,
    now: i64,
    amount: u64,
    operator: bool,
    seed: u64,
) {
    deal.accrue(now).unwrap();
    let limit = if operator { deal.active_obligations().unwrap() } else { deal.due_obligations().unwrap() };
    let take = amount.min(limit);
    if take == 0 {
        return;
    }
    let alloc = deal.allocate_active(take).unwrap();
    if operator {
        stats.operator_payments += 1;
    } else {
        stats.stranger_payments += 1;
    }
    if alloc.advance > 0 {
        stats.advances += 1;
    }
    assert!(operator || alloc.advance == 0, "seed {seed}: посторонний вызов создал аванс");
    assert_eq!(alloc.to_investors().unwrap(), take, "seed {seed}: поступление разложено не полностью");
    deal.credit_investors(&alloc).unwrap();
    ledger.taken += take as u128;
    ledger.record(&alloc);
    if deal.active_fully_paid() {
        deal.state = DealState::Repaid;
    }
}

fn pay_default(deal: &mut Deal, ledger: &mut Ledger, stats: &mut Stats, now: i64, amount: u64, seed: u64) {
    deal.accrue(now).unwrap();
    stats.default_payments += 1;
    let recovery = amount.min(deal.recovery_outstanding().unwrap());
    let debt = (amount - recovery).min(deal.default_debt().unwrap());
    deal.recovery_reimbursed += recovery;
    let alloc = deal.allocate_default_debt(debt).unwrap();
    assert_eq!(alloc.to_investors().unwrap(), debt, "seed {seed}: взыскание разложено не полностью");
    deal.credit_investors(&alloc).unwrap();
    ledger.taken += (recovery + debt) as u128;
    ledger.recovery += recovery as u128;
    ledger.record(&alloc);
    if deal.default_fully_paid() {
        deal.state = DealState::Repaid;
    }
}

fn random_amount(rng: &mut Rng, scale: u64) -> u64 {
    match rng.range(0, 3) {
        0 => rng.range(0, 1_000),
        1 => rng.range(0, scale / 20 + 1),
        2 => rng.range(0, scale / 2 + 1),
        _ => rng.range(0, scale.saturating_mul(2)),
    }
}

fn run_scenario(seed: u64, stats: &mut Stats) {
    let mut rng = Rng::new(seed);
    let mut deal = random_deal(&mut rng);
    let positions = random_positions(&mut rng, deal.total_raised);
    let mut ledger = Ledger::default();
    let mut now = DEADLINE;
    let scale = deal.total_raised;
    let steps = rng.range(1, 120) as usize;

    for step in 0..steps {
        if deal.state == DealState::Repaid {
            stats.repaid_during_steps += 1;
            break;
        }
        stats.steps += 1;
        now += rng.range(0, 45) as i64 * DAY + rng.range(0, DAY as u64 - 1) as i64;
        let op = rng.range(0, 99);

        match deal.state {
            DealState::Active => match op {
                0..=54 => {
                    let amount = random_amount(&mut rng, scale);
                    let operator = rng.chance(50);
                    pay_active(&mut deal, &mut ledger, stats, now, amount, operator, seed);
                }
                55..=66 if deal.schedule_type == ScheduleType::Annuity => {
                    // Чаще попадаем в дату платежа, чтобы частичное досрочное реально проходило.
                    if rng.chance(70) && (deal.next_period as usize) < deal.periods.len() {
                        now = now.max(deal.periods[deal.next_period as usize].due_ts);
                    }
                    let snapshot = deal.clone();
                    deal.accrue(now).unwrap();
                    let due = deal.due_obligations().unwrap();
                    let amount = random_amount(&mut rng, scale / 4 + 1).max(1);
                    let fee = deal.partial_prepayment_fee(amount).unwrap();
                    let result = deal.prepay_partial_settling_due(now, amount);
                    expect_allowed(seed, &result);
                    match result {
                        Ok(alloc) => {
                            assert_eq!(
                                alloc.to_investors().unwrap(),
                                due + amount + fee,
                                "seed {seed}: частичное досрочное разложено не полностью"
                            );
                            deal.credit_investors(&alloc).unwrap();
                            ledger.taken += (due + amount + fee) as u128;
                            ledger.record(&alloc);
                            stats.partial_ok += 1;
                        }
                        Err(_) => {
                            deal = snapshot;
                            stats.partial_rejected += 1;
                        }
                    }
                }
                67..=70 if deal.schedule_type == ScheduleType::Annuity => {
                    deal.accrue(now).unwrap();
                    let quote = deal.quote_full_prepayment(now).unwrap();
                    let alloc = deal.apply_full_prepayment(&quote).unwrap();
                    assert_eq!(
                        alloc.to_investors().unwrap(),
                        quote.total,
                        "seed {seed}: полное досрочное разложено не полностью"
                    );
                    deal.credit_investors(&alloc).unwrap();
                    ledger.taken += quote.total as u128;
                    ledger.record(&alloc);
                    stats.full_prepayments += 1;
                }
                71..=85 => {
                    deal.accrue(now).unwrap();
                    if deal.days_past_due(now) >= deal.default_threshold_days as i64 {
                        deal.enter_default().unwrap();
                        stats.defaults += 1;
                    }
                }
                _ => now += rng.range(0, 400) as i64 * DAY,
            },
            DealState::Default => match op {
                0..=19 => {
                    deal.accrue(now).unwrap();
                    deal.recovery_costs += rng.range(0, scale / 100 + 1);
                }
                _ => {
                    let amount = random_amount(&mut rng, scale);
                    pay_default(&mut deal, &mut ledger, stats, now, amount, seed);
                }
            },
            _ => unreachable!(),
        }

        stats.max_periods_due = stats.max_periods_due.max(deal.next_period as u64);
        check_invariants(seed, step, &deal, &ledger, &positions);
    }

    // Доводим заём до погашения.
    now = now.max(deal.periods.last().unwrap().due_ts) + 30 * DAY;
    match deal.state {
        DealState::Active => pay_active(&mut deal, &mut ledger, stats, now, u64::MAX, true, seed),
        DealState::Default => pay_default(&mut deal, &mut ledger, stats, now, u64::MAX, seed),
        _ => {}
    }
    stats.max_periods_due = stats.max_periods_due.max(deal.next_period as u64);
    assert_eq!(deal.state, DealState::Repaid, "seed {seed}: заём не погашен полной оплатой");
    check_invariants(seed, usize::MAX, &deal, &ledger, &positions);
}

#[test]
fn fuzz_accounting_invariants() {
    let mut stats = Stats::default();
    for seed in 1..=SCENARIOS {
        run_scenario(seed, &mut stats);
    }
    println!("фаззинг: {stats:#?}");

    // Защита от прогона вхолостую: каждая ветка должна реально выполняться много раз.
    assert!(stats.steps > 20_000, "мало шагов: {}", stats.steps);
    assert!(stats.operator_payments > 1_000);
    assert!(stats.stranger_payments > 1_000);
    assert!(stats.advances > 100);
    assert!(stats.partial_ok > 100, "частичное досрочное почти не проходит: {}", stats.partial_ok);
    assert!(stats.partial_rejected > 100);
    assert!(stats.full_prepayments > 100);
    assert!(stats.defaults > 100);
    assert!(stats.default_payments > 100);
    assert_eq!(stats.max_periods_due, MAX_PERIODS as u64, "длинные графики не доходят до конца");
}
