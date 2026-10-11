//! Юнит-тесты учёта займа: график, начисление, распределение, дефолт, досрочное погашение.
//! Эталонные значения — раздел 18 ТЗ. Суммы в минимальных единицах токена с 6 знаками.

use anchor_lang::error::{Error, ERROR_CODE_OFFSET};
use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::DalaError;
use crate::math::pending;
use crate::state::{Allocation, Deal, DealState, Period, Position, ScheduleType};

const USDC: u64 = 1_000_000;
const DEADLINE: i64 = 1_700_000_000;
const MONTH: i64 = 30 * SECONDS_PER_DAY;
const TOTAL: u64 = 100_000 * USDC;

fn usdc(x: f64) -> u64 {
    (x * USDC as f64).round() as u64
}

fn assert_close(actual: u64, expected: u64, tolerance: u64, what: &str) {
    let diff = actual.abs_diff(expected);
    assert!(
        diff <= tolerance,
        "{what}: получено {actual}, ожидалось {expected} ± {tolerance} (разница {diff})"
    );
}

fn assert_err<T: std::fmt::Debug>(result: Result<T>, expected: DalaError) {
    match result {
        Err(Error::AnchorError(e)) => assert_eq!(
            e.error_code_number,
            expected as u32 + ERROR_CODE_OFFSET,
            "ожидалась ошибка {:?}, получена {}",
            expected,
            e.error_name
        ),
        other => panic!("ожидалась ошибка {expected:?}, получено {other:?}"),
    }
}

/// Доли тела аннуитета в масштабе `SCALE` — так их рассчитывает бэкенд.
fn annuity_fractions(rate_bps: u32, periods_per_year: u8, n: usize) -> Vec<u64> {
    let i = rate_bps as f64 / 10_000.0 / periods_per_year as f64;
    let payment = i / (1.0 - (1.0 + i).powi(-(n as i32)));
    let mut balance = 1.0;
    let mut sum = 0u64;
    let mut out = Vec::with_capacity(n);
    for k in 0..n {
        let principal = payment - balance * i;
        balance -= principal;
        let fraction = if k + 1 == n {
            SCALE as u64 - sum
        } else {
            (principal * SCALE as f64).round() as u64
        };
        sum += fraction;
        out.push(fraction);
    }
    out
}

fn coupon_fractions(n: usize) -> Vec<u64> {
    let mut out = vec![0; n];
    out[n - 1] = SCALE as u64;
    out
}

/// Кампания сразу после закрытия сбора: 100 000 USDC, 10% годовых, пеня 20%,
/// ежемесячные платежи каждые 30 дней после дедлайна.
fn active_deal(schedule_type: ScheduleType, n: usize) -> Deal {
    let fractions = match schedule_type {
        ScheduleType::Annuity => annuity_fractions(1_000, 12, n),
        ScheduleType::Coupon => coupon_fractions(n),
    };
    let periods = fractions
        .into_iter()
        .enumerate()
        .map(|(k, principal_fraction)| Period {
            due_ts: DEADLINE + MONTH * (k as i64 + 1),
            principal_fraction,
            ..Period::default()
        })
        .collect();

    let mut deal = Deal {
        platform: Pubkey::default(),
        campaign_id: 1,
        mint: Pubkey::default(),
        vault: Pubkey::default(),
        repay_account: Pubkey::default(),
        borrower_wallet: Pubkey::default(),
        soft_cap: USDC,
        hard_cap: TOTAL,
        min_ticket: USDC,
        max_ticket: 0,
        funding_start: DEADLINE - MONTH,
        funding_deadline: DEADLINE,
        schedule_type,
        annual_rate_bps: 1_000,
        periods_per_year: 12,
        penalty_rate_bps: 2_000,
        default_threshold_days: 90,
        prepayment_fee_bps: if schedule_type == ScheduleType::Annuity { 100 } else { 0 },
        platform_fee_bps: 0,
        cancel_grace_days: 7,
        periods,
        schedule_finalized: true,
        state: DealState::Active,
        total_raised: TOTAL,
        funding_closed_ts: 0,
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

fn scheduled_payment(deal: &Deal, k: usize) -> u64 {
    deal.periods[k].interest_amount + deal.periods[k].principal_amount
}

/// Поступление в дату платежа `k`: начисление до даты, распределение, зачисление инвесторам.
fn pay_at(deal: &mut Deal, now: i64, amount: u64) -> Allocation {
    deal.accrue(now).unwrap();
    let amount = amount.min(deal.active_obligations().unwrap());
    let alloc = deal.allocate_active(amount).unwrap();
    deal.credit_investors(&alloc).unwrap();
    alloc
}

fn position(principal: u64) -> Position {
    Position {
        deal: Pubkey::default(),
        user_id: [0; 16],
        principal,
        checkpoint_principal: 0,
        checkpoint_interest: 0,
        checkpoint_penalty: 0,
        checkpoint_prepayment_fee: 0,
        bump: 0,
    }
}

// ─────────────────────────────────────────────────────────────────────────
// График
// ─────────────────────────────────────────────────────────────────────────

#[test]
fn annuity_schedule_matches_reference() {
    let deal = active_deal(ScheduleType::Annuity, 12);

    assert_eq!(deal.periods[0].interest_amount, 833_333_333);
    assert_close(deal.periods[0].principal_amount, usdc(7_958.26), 20_000, "тело платежа 1");
    assert_close(scheduled_payment(&deal, 0), usdc(8_791.59), 20_000, "платёж 1");

    for k in 1..11 {
        assert_close(
            scheduled_payment(&deal, k),
            scheduled_payment(&deal, 0),
            5,
            "аннуитетные платежи равны",
        );
    }

    let principal: u64 = deal.periods.iter().map(|p| p.principal_amount).sum();
    assert_eq!(principal, TOTAL, "тело графика ровно равно сумме сбора");

    let after_six: u64 = deal.periods[6..].iter().map(|p| p.principal_amount).sum();
    assert_close(after_six, usdc(51_244.54), USDC, "остаток тела после 6 платежей");

    let interest: u64 = deal.periods.iter().map(|p| p.interest_amount).sum();
    assert_close(interest, usdc(5_499.08), 100_000, "проценты за весь срок");
}

#[test]
fn coupon_schedule_matches_reference() {
    let deal = active_deal(ScheduleType::Coupon, 12);

    for k in 0..11 {
        assert_eq!(deal.periods[k].interest_amount, 833_333_333);
        assert_eq!(deal.periods[k].principal_amount, 0);
    }
    assert_eq!(scheduled_payment(&deal, 11), 100_833_333_333);
}

#[test]
fn schedule_validation_rejects_bad_fractions() {
    let mut deal = active_deal(ScheduleType::Annuity, 12);
    deal.periods[3].principal_fraction += 1;
    assert_err(deal.validate_schedule(), DalaError::InvalidSchedule);

    let mut coupon = active_deal(ScheduleType::Coupon, 12);
    coupon.periods[0].principal_fraction = 1;
    coupon.periods[11].principal_fraction -= 1;
    assert_err(coupon.validate_schedule(), DalaError::InvalidSchedule);
}

#[test]
fn rounding_leaves_no_principal_behind() {
    let mut deal = active_deal(ScheduleType::Annuity, 7);
    deal.total_raised = 123_456_789_013;
    deal.build_schedule().unwrap();
    let principal: u64 = deal.periods.iter().map(|p| p.principal_amount).sum();
    assert_eq!(principal, deal.total_raised);
}

// ─────────────────────────────────────────────────────────────────────────
// Погашение до дефолта
// ─────────────────────────────────────────────────────────────────────────

#[test]
fn underpayment_goes_to_interest_then_principal() {
    let mut deal = active_deal(ScheduleType::Annuity, 12);
    let due = deal.periods[0].due_ts;

    let alloc = pay_at(&mut deal, due, 5_000 * USDC);

    assert_eq!(alloc.interest, 833_333_333);
    assert_eq!(alloc.principal, 5_000 * USDC - 833_333_333);
    assert_eq!(alloc.advance, 0);
    assert_close(deal.overdue_principal, usdc(3_791.59), 20_000, "просроченное тело");
    assert_eq!(deal.overdue_scheduled_interest, 0);
    assert_eq!(deal.days_past_due(due), 0);
    assert_eq!(deal.days_past_due(due + 10 * SECONDS_PER_DAY), 10);
}

#[test]
fn penalty_and_interest_accrue_on_overdue() {
    let mut deal = active_deal(ScheduleType::Annuity, 12);
    let due = deal.periods[0].due_ts;
    pay_at(&mut deal, due, 5_000 * USDC);
    let overdue = deal.overdue_principal;

    deal.accrue(due + 10 * SECONDS_PER_DAY).unwrap();

    let expected_penalty = (overdue as u128 * 2_000 * 10 / (10_000 * 360)) as u64;
    let expected_interest = (overdue as u128 * 1_000 * 10 / (10_000 * 360)) as u64;
    assert_close(deal.penalty, expected_penalty, 2, "пеня за 10 дней");
    assert_close(deal.penalty, usdc(21.06), 10_000, "пеня ≈ 21,06");
    assert_close(deal.extra_interest, expected_interest, 2, "проценты на просроченное тело");
}

#[test]
fn next_payment_first_closes_overdue_and_penalty() {
    let mut deal = active_deal(ScheduleType::Annuity, 12);
    let due = deal.periods[0].due_ts;
    let now = due + 10 * SECONDS_PER_DAY;
    pay_at(&mut deal, due, 5_000 * USDC);
    deal.accrue(now).unwrap();
    let (overdue, penalty) = (deal.overdue_principal, deal.penalty);
    assert!(deal.extra_interest > 0 && penalty > 0);

    let alloc = pay_at(&mut deal, now, 9_000 * USDC);

    assert_eq!(deal.overdue_principal, 0);
    assert_eq!(deal.extra_interest, 0);
    assert_eq!(deal.penalty, 0);
    assert_eq!(alloc.penalty, penalty, "пеня закрыта целиком");
    assert_eq!(
        alloc.interest + alloc.principal + alloc.penalty,
        9_000 * USDC,
        "поступление разложено целиком"
    );
    assert!(alloc.principal >= overdue);
    assert!(alloc.advance > 0, "остаток ушёл авансом в следующий платёж");
}

#[test]
fn overpayment_is_advance_for_next_payments() {
    let mut deal = active_deal(ScheduleType::Annuity, 12);
    let payment = scheduled_payment(&deal, 0);

    let due = deal.periods[0].due_ts;
    let alloc = pay_at(&mut deal, due, 20_000 * USDC);

    assert_eq!(deal.periods[0].interest_paid + deal.periods[0].principal_paid, payment);
    assert_eq!(
        deal.periods[1].interest_paid + deal.periods[1].principal_paid,
        scheduled_payment(&deal, 1)
    );
    let into_third = deal.periods[2].interest_paid + deal.periods[2].principal_paid;
    assert_close(into_third, usdc(2_416.82), 30_000, "в счёт платежа 3");
    assert_close(alloc.advance, 20_000 * USDC - payment, 0, "аванс");
    assert_eq!(deal.overdue_principal + deal.overdue_scheduled_interest, 0);
}

#[test]
fn single_underpayment_never_reaches_default() {
    let mut deal = active_deal(ScheduleType::Annuity, 12);
    let first_due = deal.periods[0].due_ts;
    pay_at(&mut deal, first_due, 5_000 * USDC);

    for m in 1..12 {
        let due = deal.periods[m].due_ts;
        let payment = scheduled_payment(&deal, m);
        pay_at(&mut deal, due, payment);
        assert!(deal.days_past_due(due) < 31, "месяц {}: дни просрочки", m + 1);

        let before_next = due + 29 * SECONDS_PER_DAY;
        deal.accrue(before_next).unwrap();
        assert!(deal.days_past_due(before_next) < 31);
        assert!(deal.days_past_due(before_next) < deal.default_threshold_days as i64);
    }
    assert!(deal.state == DealState::Active);
}

#[test]
fn systematic_underpayment_defaults_around_month_seven() {
    let mut deal = active_deal(ScheduleType::Annuity, 12);
    let mut default_month = None;

    for m in 0..12 {
        let due = deal.periods[m].due_ts;
        pay_at(&mut deal, due, 5_000 * USDC);
        for now in [due, due + 29 * SECONDS_PER_DAY] {
            deal.accrue(now).unwrap();
            if default_month.is_none() && deal.days_past_due(now) >= 90 {
                default_month = Some(m + 1);
            }
        }
    }

    let month = default_month.expect("порог дефолта должен быть достигнут");
    assert!((6..=8).contains(&month), "дефолт на месяце {month}");
}

#[test]
fn full_payment_by_schedule_repays_loan() {
    let mut deal = active_deal(ScheduleType::Coupon, 12);
    for m in 0..12 {
        let payment = scheduled_payment(&deal, m);
        let due = deal.periods[m].due_ts;
        pay_at(&mut deal, due, payment);
    }
    assert!(deal.active_fully_paid());
}

// ─────────────────────────────────────────────────────────────────────────
// Дефолт
// ─────────────────────────────────────────────────────────────────────────

#[test]
fn due_obligations_exclude_future_payments() {
    let mut deal = active_deal(ScheduleType::Annuity, 12);
    let due = deal.periods[0].due_ts;

    deal.accrue(due - 1).unwrap();
    assert_eq!(deal.due_obligations().unwrap(), 0, "до даты платежа ничего не причитается");

    deal.accrue(due).unwrap();
    assert_eq!(deal.due_obligations().unwrap(), scheduled_payment(&deal, 0));

    pay_at(&mut deal, due, 5_000 * USDC);
    deal.accrue(due + 10 * SECONDS_PER_DAY).unwrap();
    assert_eq!(
        deal.due_obligations().unwrap(),
        deal.overdue_principal + deal.extra_interest + deal.penalty
    );
    assert!(deal.active_obligations().unwrap() > deal.due_obligations().unwrap());
}

#[test]
fn default_accelerates_principal_and_keeps_accruing() {
    let mut deal = active_deal(ScheduleType::Annuity, 12);
    let now = deal.periods[0].due_ts + 90 * SECONDS_PER_DAY;
    deal.accrue(now).unwrap();
    assert_eq!(deal.days_past_due(now), 90);

    let unpaid_interest = deal.overdue_scheduled_interest + deal.extra_interest;
    deal.enter_default().unwrap();

    assert!(deal.state == DealState::Default);
    assert_eq!(deal.default_principal, TOTAL, "весь остаток тела просрочен");
    assert_eq!(deal.default_interest, unpaid_interest);
    assert_eq!(deal.overdue_principal, 0);

    let (interest, penalty) = (deal.default_interest, deal.penalty);
    deal.accrue(now + MONTH).unwrap();
    let expected = (TOTAL as u128 * 1_000 * 30 / (10_000 * 360)) as u64;
    assert_close(deal.default_interest - interest, expected, 2, "проценты после дефолта");
    assert!(deal.penalty > penalty, "пеня после дефолта растёт");
}

#[test]
fn default_distribution_order_and_settlement() {
    let mut deal = active_deal(ScheduleType::Annuity, 12);
    let now = deal.periods[0].due_ts + 90 * SECONDS_PER_DAY;
    deal.accrue(now).unwrap();
    deal.enter_default().unwrap();
    deal.recovery_costs = 1_000 * USDC;

    let interest = deal.default_interest;
    let alloc = deal.allocate_default_debt(interest + 10 * USDC).unwrap();
    assert_eq!(alloc.interest, interest);
    assert_eq!(alloc.principal, 10 * USDC);
    assert_eq!(alloc.penalty, 0);

    let rest = deal.default_debt().unwrap();
    let alloc = deal.allocate_default_debt(rest).unwrap();
    assert!(alloc.penalty > 0);
    assert!(!deal.default_fully_paid(), "расходы на взыскание ещё не возмещены");

    deal.recovery_reimbursed = deal.recovery_costs;
    assert!(deal.default_fully_paid());
}

// ─────────────────────────────────────────────────────────────────────────
// Досрочное погашение
// ─────────────────────────────────────────────────────────────────────────

fn deal_after_six_payments() -> Deal {
    let mut deal = active_deal(ScheduleType::Annuity, 12);
    for m in 0..6 {
        let payment = scheduled_payment(&deal, m);
        let due = deal.periods[m].due_ts;
        pay_at(&mut deal, due, payment);
    }
    deal
}

#[test]
fn full_prepayment_on_payment_date() {
    let mut deal = deal_after_six_payments();
    let now = deal.periods[5].due_ts;

    let quote = deal.quote_full_prepayment(now).unwrap();
    assert_eq!(quote.overdue, 0);
    assert_eq!(quote.current_interest, 0);
    assert_close(quote.remaining_principal, usdc(51_244.54), USDC, "остаток тела");
    assert_eq!(quote.fee, quote.remaining_principal / 100, "комиссия 1%");
    assert_close(quote.fee, usdc(512.45), 20_000, "комиссия ≈ 512,45");
    assert_eq!(quote.total, quote.remaining_principal + quote.fee);

    let alloc = deal.apply_full_prepayment(&quote).unwrap();
    assert!(deal.state == DealState::Repaid);
    assert_eq!(alloc.principal, quote.remaining_principal);
    assert_eq!(alloc.prepayment_fee, quote.fee);
}

#[test]
fn full_prepayment_charges_interest_for_actual_days() {
    let mut deal = deal_after_six_payments();
    let now = deal.periods[5].due_ts + 15 * SECONDS_PER_DAY;
    deal.accrue(now).unwrap();

    let quote = deal.quote_full_prepayment(now).unwrap();
    let expected = (quote.remaining_principal as u128 * 1_000 * 15 / (10_000 * 360)) as u64;
    assert_close(quote.current_interest, expected, 1, "проценты за 15 дней");
    assert_close(quote.current_interest, usdc(213.52), 20_000, "≈ 213,52");
}

#[test]
fn partial_prepayment_reduces_payments_keeps_dates() {
    let mut deal = deal_after_six_payments();
    let now = deal.periods[5].due_ts;
    let dates: Vec<i64> = deal.periods.iter().map(|p| p.due_ts).collect();
    let before: u64 = deal.periods[6..].iter().map(|p| p.principal_amount).sum();

    let fee = deal.apply_partial_prepayment(now, 20_000 * USDC).unwrap();

    assert_eq!(fee, 200 * USDC);
    let after: u64 = deal.periods[6..].iter().map(|p| p.principal_amount).sum();
    assert_eq!(after, before - 20_000 * USDC);
    assert_close(scheduled_payment(&deal, 6), usdc(5_360.3), USDC, "новый платёж ≈ 5 360");
    let new_dates: Vec<i64> = deal.periods.iter().map(|p| p.due_ts).collect();
    assert_eq!(dates, new_dates, "даты не меняются");
}

#[test]
fn partial_prepayment_in_one_transfer_settles_todays_payment_first() {
    let mut deal = deal_after_six_payments();
    let today = deal.periods[6].due_ts;
    deal.accrue(today).unwrap();

    let payment = scheduled_payment(&deal, 6);
    let (interest, principal) = (deal.periods[6].interest_amount, deal.periods[6].principal_amount);
    assert_eq!(deal.due_obligations().unwrap(), payment, "сегодняшний платёж причитается");
    let before: u64 = deal.periods[7..].iter().map(|p| p.principal_amount).sum();

    let alloc = deal.prepay_partial_settling_due(today, 20_000 * USDC).unwrap();

    assert_eq!(alloc.interest, interest);
    assert_eq!(alloc.principal, principal + 20_000 * USDC);
    assert_eq!(alloc.prepayment_fee, 200 * USDC);
    assert_eq!(alloc.advance, 0);
    assert_eq!(alloc.to_investors().unwrap(), payment + 20_200 * USDC);
    assert_eq!(deal.due_obligations().unwrap(), 0);

    let after: u64 = deal.periods[7..].iter().map(|p| p.principal_amount).sum();
    assert_eq!(after, before - 20_000 * USDC);
}

#[test]
fn partial_prepayment_rejected_outside_payment_date() {
    let mut deal = deal_after_six_payments();
    let now = deal.periods[5].due_ts + SECONDS_PER_DAY;
    deal.accrue(now).unwrap();
    assert_err(
        deal.apply_partial_prepayment(now, 1_000 * USDC),
        DalaError::NotPaymentDate,
    );
}

#[test]
fn partial_prepayment_rejected_with_advance() {
    let mut deal = deal_after_six_payments();
    let now = deal.periods[5].due_ts;
    pay_at(&mut deal, now, 100 * USDC);
    assert_err(
        deal.apply_partial_prepayment(now, 1_000 * USDC),
        DalaError::HasAdvance,
    );
}

#[test]
fn partial_prepayment_rejected_with_overdue() {
    let mut deal = active_deal(ScheduleType::Annuity, 12);
    let now = deal.periods[0].due_ts;
    pay_at(&mut deal, now, 5_000 * USDC);
    assert_err(
        deal.apply_partial_prepayment(now, 1_000 * USDC),
        DalaError::HasOverdue,
    );
}

// ─────────────────────────────────────────────────────────────────────────
// Распределение инвесторам
// ─────────────────────────────────────────────────────────────────────────

#[test]
fn distribution_is_pro_rata() {
    let mut deal = active_deal(ScheduleType::Annuity, 12);
    let payment = scheduled_payment(&deal, 0);
    let due = deal.periods[0].due_ts;
    pay_at(&mut deal, due, payment);

    let expected = [
        (50_000 * USDC, 416.67, 3_979.13),
        (30_000 * USDC, 250.00, 2_387.48),
        (20_000 * USDC, 166.67, 1_591.65),
    ];
    let mut total = 0u64;
    for (principal, interest, body) in expected {
        let payout = position(principal)
            .pending_payout(
                deal.acc_principal,
                deal.acc_interest,
                deal.acc_penalty,
                deal.acc_prepayment_fee,
            )
            .unwrap();
        assert_close(payout.interest, usdc(interest), 10_000, "проценты");
        assert_close(payout.principal, usdc(body), 20_000, "тело");
        total += payout.total().unwrap();
    }
    assert!(total <= payment, "выплаты не превышают поступления");
    // Каждое округление вниз теряет меньше единицы: 3 позиции × 2 статьи (тело, проценты).
    assert!(payment - total <= 6, "потери на округлении — единицы: {}", payment - total);
}

#[test]
fn payouts_never_exceed_inflows() {
    let mut deal = active_deal(ScheduleType::Annuity, 12);
    let shares = [33_333 * USDC + 333_333, 33_333 * USDC + 333_333, 33_333 * USDC + 333_334];
    let mut distributed = 0u64;

    let mut amounts = [1u64, 7, 999_999, 3_333 * USDC + 1, 12_345_678, 8_791 * USDC].iter().cycle();
    for m in 0..12 {
        let due = deal.periods[m].due_ts;
        let alloc = pay_at(&mut deal, due, *amounts.next().unwrap());
        distributed += alloc.to_investors().unwrap();

        let paid: u64 = shares
            .iter()
            .map(|&s| {
                let p = position(s);
                pending(p.principal, deal.acc_interest, 0).unwrap()
                    + pending(p.principal, deal.acc_principal, 0).unwrap()
                    + pending(p.principal, deal.acc_penalty, 0).unwrap()
            })
            .sum();
        assert!(paid <= distributed, "месяц {}: {paid} > {distributed}", m + 1);
    }
}
