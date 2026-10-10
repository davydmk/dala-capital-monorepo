//! Учёт займа: график, начисление, распределение поступлений, дефолт, досрочное погашение.
//!
//! Все суммы — в минимальных единицах токена. Деление всегда вниз.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::DalaError;
use crate::math::{add, distribute, mul_div, sub, to_u64};
use crate::state::{Deal, DealState, ScheduleType};

/// Как поступление разложено по статьям.
#[derive(Clone, Copy, Default, Debug)]
pub struct Allocation {
    /// Возмещение расходов на взыскание — уходит в казну, минуя волт.
    pub recovery: u64,
    pub interest: u64,
    pub principal: u64,
    pub penalty: u64,
    pub prepayment_fee: u64,
    /// Часть `interest + principal`, внесённая в счёт ещё не наступивших платежей.
    pub advance: u64,
}

impl Allocation {
    /// Сумма, которая уходит в волт и распределяется инвесторам.
    pub fn to_investors(&self) -> Result<u64> {
        add(
            add(self.interest, self.principal)?,
            add(self.penalty, self.prepayment_fee)?,
        )
    }
}

#[derive(Clone, Copy, Default, Debug)]
pub struct FullPrepayment {
    /// Просроченные проценты, просроченное тело и пеня.
    pub overdue: u64,
    /// Проценты текущего периода за фактическое время, за вычетом аванса по процентам.
    pub current_interest: u64,
    /// Тело ещё не наступивших платежей, за вычетом аванса по телу.
    pub remaining_principal: u64,
    pub fee: u64,
    pub total: u64,
}

impl Deal {
    // ─────────────────────────────────────────────────────────────────────
    // График
    // ─────────────────────────────────────────────────────────────────────

    /// Проверяет загруженный график перед открытием сбора.
    pub fn validate_schedule(&self) -> Result<()> {
        let n = self.periods.len();
        require!(n >= 1 && n <= MAX_PERIODS, DalaError::InvalidSchedule);

        let mut sum: u128 = 0;
        for (k, period) in self.periods.iter().enumerate() {
            sum = sum
                .checked_add(period.principal_fraction as u128)
                .ok_or_else(|| error!(DalaError::MathOverflow))?;
            if self.schedule_type == ScheduleType::Coupon && k + 1 < n {
                require!(period.principal_fraction == 0, DalaError::InvalidSchedule);
            }
        }
        require!(sum == SCALE, DalaError::InvalidSchedule);
        Ok(())
    }

    /// Рассчитывает тело и проценты каждого платежа от фактически собранной суммы.
    pub fn build_schedule(&mut self) -> Result<()> {
        let total = self.total_raised as u128;
        let n = self.periods.len();
        let mut assigned: u128 = 0;

        for k in 0..n {
            let amount = if k + 1 == n {
                total
                    .checked_sub(assigned)
                    .ok_or_else(|| error!(DalaError::MathOverflow))?
            } else {
                mul_div(total, self.periods[k].principal_fraction as u128, SCALE)?
            };
            assigned = assigned
                .checked_add(amount)
                .ok_or_else(|| error!(DalaError::MathOverflow))?;
            self.periods[k].principal_amount = to_u64(amount)?;
        }

        self.recompute_interest(0, self.total_raised)
    }

    /// Проценты по графику от периода `from`: остаток тела × годовая ставка / периодов в году.
    fn recompute_interest(&mut self, from: usize, start_balance: u64) -> Result<()> {
        let rate = self.annual_rate_bps as u128;
        let denominator = BPS_DENOMINATOR * self.periods_per_year as u128;
        let mut balance = start_balance;

        for k in from..self.periods.len() {
            self.periods[k].interest_amount =
                to_u64(mul_div(balance as u128, rate, denominator)?)?;
            balance = sub(balance, self.periods[k].principal_amount)?;
        }
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────
    // Начисление
    // ─────────────────────────────────────────────────────────────────────

    /// Доводит учёт до `now`: переводит наступившие платежи в просрочку и начисляет
    /// проценты на просроченное тело и пеню по фактическому времени.
    pub fn accrue(&mut self, now: i64) -> Result<()> {
        if !matches!(self.state, DealState::Active | DealState::Default) {
            return Ok(());
        }

        if self.state == DealState::Active {
            while (self.next_period as usize) < self.periods.len() {
                let k = self.next_period as usize;
                let due = self.periods[k].due_ts;
                if due > now {
                    break;
                }

                self.accrue_interval(due.saturating_sub(self.last_accrual_ts))?;
                self.last_accrual_ts = self.last_accrual_ts.max(due);

                let period = self.periods[k];
                self.overdue_principal = add(
                    self.overdue_principal,
                    sub(period.principal_amount, period.principal_paid)?,
                )?;
                self.overdue_scheduled_interest = add(
                    self.overdue_scheduled_interest,
                    sub(period.interest_amount, period.interest_paid)?,
                )?;
                self.next_period = self
                    .next_period
                    .checked_add(1)
                    .ok_or_else(|| error!(DalaError::MathOverflow))?;
            }
        }

        if now > self.last_accrual_ts {
            self.accrue_interval(now - self.last_accrual_ts)?;
            self.last_accrual_ts = now;
        }
        Ok(())
    }

    fn accrue_interval(&mut self, seconds: i64) -> Result<()> {
        if seconds <= 0 {
            return Ok(());
        }
        let seconds = seconds as u128;

        let (principal_base, interest_base) = if self.state == DealState::Default {
            (self.default_principal, self.default_interest)
        } else {
            (
                self.overdue_principal,
                add(self.overdue_scheduled_interest, self.extra_interest)?,
            )
        };

        // Проценты по ставке займа на просроченное тело.
        if principal_base > 0 && self.annual_rate_bps > 0 {
            let numerator = (principal_base as u128)
                .checked_mul(self.annual_rate_bps as u128)
                .and_then(|x| x.checked_mul(seconds))
                .and_then(|x| x.checked_add(self.interest_carry))
                .ok_or_else(|| error!(DalaError::MathOverflow))?;
            let accrued = to_u64(numerator / ACCRUAL_DENOMINATOR)?;
            self.interest_carry = numerator % ACCRUAL_DENOMINATOR;

            if self.state == DealState::Default {
                self.default_interest = add(self.default_interest, accrued)?;
            } else {
                self.extra_interest = add(self.extra_interest, accrued)?;
            }
        }

        // Пеня на просроченное тело и просроченные проценты. На саму пеню не начисляется.
        let penalty_base = add(principal_base, interest_base)?;
        if penalty_base > 0 && self.penalty_rate_bps > 0 {
            let numerator = (penalty_base as u128)
                .checked_mul(self.penalty_rate_bps as u128)
                .and_then(|x| x.checked_mul(seconds))
                .and_then(|x| x.checked_add(self.penalty_carry))
                .ok_or_else(|| error!(DalaError::MathOverflow))?;
            self.penalty = add(self.penalty, to_u64(numerator / ACCRUAL_DENOMINATOR)?)?;
            self.penalty_carry = numerator % ACCRUAL_DENOMINATOR;
        }
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────
    // До дефолта
    // ─────────────────────────────────────────────────────────────────────

    /// Уже причитающееся в Active: неоплаченные проценты и тело наступивших платежей,
    /// проценты на просроченное тело и пеня. Ненаступившие платежи сюда не входят.
    pub fn due_obligations(&self) -> Result<u64> {
        add(
            add(self.overdue_scheduled_interest, self.extra_interest)?,
            add(self.overdue_principal, self.penalty)?,
        )
    }

    /// Все оставшиеся обязательства заёмщика в Active, включая ненаступившие платежи.
    pub fn active_obligations(&self) -> Result<u64> {
        let mut total = self.due_obligations()?;
        for period in self.periods.iter().skip(self.next_period as usize) {
            total = add(total, sub(period.interest_amount, period.interest_paid)?)?;
            total = add(total, sub(period.principal_amount, period.principal_paid)?)?;
        }
        Ok(total)
    }

    /// Раскладывает поступление в Active:
    /// просроченные проценты (по графику, затем начисленные) → просроченное тело → пеня → аванс.
    pub fn allocate_active(&mut self, amount: u64) -> Result<Allocation> {
        let mut left = amount;
        let mut alloc = Allocation::default();
        let next = self.next_period as usize;

        // 1. Проценты наступивших платежей, начиная с самого старого.
        for k in 0..next {
            if left == 0 {
                break;
            }
            let due = sub(self.periods[k].interest_amount, self.periods[k].interest_paid)?;
            let x = due.min(left);
            if x > 0 {
                self.periods[k].interest_paid = add(self.periods[k].interest_paid, x)?;
                self.overdue_scheduled_interest = sub(self.overdue_scheduled_interest, x)?;
                alloc.interest = add(alloc.interest, x)?;
                left -= x;
            }
        }

        // 1б. Проценты, начисленные на просроченное тело.
        let x = self.extra_interest.min(left);
        self.extra_interest -= x;
        alloc.interest = add(alloc.interest, x)?;
        left -= x;

        // 2. Тело наступивших платежей, начиная с самого старого.
        for k in 0..next {
            if left == 0 {
                break;
            }
            let due = sub(self.periods[k].principal_amount, self.periods[k].principal_paid)?;
            let x = due.min(left);
            if x > 0 {
                self.periods[k].principal_paid = add(self.periods[k].principal_paid, x)?;
                self.overdue_principal = sub(self.overdue_principal, x)?;
                alloc.principal = add(alloc.principal, x)?;
                left -= x;
            }
        }

        // 3. Пеня.
        let x = self.penalty.min(left);
        self.penalty -= x;
        alloc.penalty = add(alloc.penalty, x)?;
        left -= x;

        // 4. Аванс: следующие платежи по порядку, в каждом проценты, затем тело.
        for k in next..self.periods.len() {
            if left == 0 {
                break;
            }
            let interest_due =
                sub(self.periods[k].interest_amount, self.periods[k].interest_paid)?;
            let x = interest_due.min(left);
            self.periods[k].interest_paid = add(self.periods[k].interest_paid, x)?;
            alloc.interest = add(alloc.interest, x)?;
            alloc.advance = add(alloc.advance, x)?;
            left -= x;

            let principal_due =
                sub(self.periods[k].principal_amount, self.periods[k].principal_paid)?;
            let x = principal_due.min(left);
            self.periods[k].principal_paid = add(self.periods[k].principal_paid, x)?;
            alloc.principal = add(alloc.principal, x)?;
            alloc.advance = add(alloc.advance, x)?;
            left -= x;
        }

        Ok(alloc)
    }

    pub fn active_fully_paid(&self) -> bool {
        self.extra_interest == 0
            && self.penalty == 0
            && self.periods.iter().all(|p| {
                p.interest_paid == p.interest_amount && p.principal_paid == p.principal_amount
            })
    }

    /// Дни с даты самого старого не полностью оплаченного наступившего платежа.
    pub fn days_past_due(&self, now: i64) -> i64 {
        self.periods
            .iter()
            .take(self.next_period as usize)
            .find(|p| p.interest_paid < p.interest_amount || p.principal_paid < p.principal_amount)
            .map(|p| now.saturating_sub(p.due_ts).max(0) / SECONDS_PER_DAY)
            .unwrap_or(0)
    }

    // ─────────────────────────────────────────────────────────────────────
    // Дефолт
    // ─────────────────────────────────────────────────────────────────────

    /// Весь неоплаченный остаток тела становится просроченным, плановые проценты
    /// ненаступивших периодов больше не требуются.
    pub fn enter_default(&mut self) -> Result<()> {
        let next = self.next_period as usize;
        let mut principal = 0u64;
        let mut prepaid_interest = 0u64;

        for (k, period) in self.periods.iter().enumerate() {
            principal = add(principal, sub(period.principal_amount, period.principal_paid)?)?;
            if k >= next {
                prepaid_interest = add(prepaid_interest, period.interest_paid)?;
            }
        }

        self.default_principal = principal;
        self.default_interest = add(self.overdue_scheduled_interest, self.extra_interest)?
            .saturating_sub(prepaid_interest);
        self.overdue_principal = 0;
        self.overdue_scheduled_interest = 0;
        self.extra_interest = 0;
        self.state = DealState::Default;
        Ok(())
    }

    pub fn recovery_outstanding(&self) -> Result<u64> {
        sub(self.recovery_costs, self.recovery_reimbursed)
    }

    /// Долг перед инвесторами в дефолте: проценты, тело, пеня.
    pub fn default_debt(&self) -> Result<u64> {
        add(add(self.default_interest, self.default_principal)?, self.penalty)
    }

    /// Раскладывает поступление в дефолте (после возмещения расходов): проценты → тело → пеня.
    pub fn allocate_default_debt(&mut self, amount: u64) -> Result<Allocation> {
        let mut left = amount;
        let mut alloc = Allocation::default();

        let x = self.default_interest.min(left);
        self.default_interest -= x;
        alloc.interest = x;
        left -= x;

        let x = self.default_principal.min(left);
        self.default_principal -= x;
        alloc.principal = x;
        left -= x;

        let x = self.penalty.min(left);
        self.penalty -= x;
        alloc.penalty = x;

        Ok(alloc)
    }

    pub fn default_fully_paid(&self) -> bool {
        self.default_interest == 0
            && self.default_principal == 0
            && self.penalty == 0
            && self.recovery_costs == self.recovery_reimbursed
    }

    // ─────────────────────────────────────────────────────────────────────
    // Распределение инвесторам
    // ─────────────────────────────────────────────────────────────────────

    pub fn credit_investors(&mut self, alloc: &Allocation) -> Result<()> {
        let total = self.total_raised;
        distribute(&mut self.acc_interest, &mut self.carry_interest, alloc.interest, total)?;
        distribute(&mut self.acc_principal, &mut self.carry_principal, alloc.principal, total)?;
        distribute(&mut self.acc_penalty, &mut self.carry_penalty, alloc.penalty, total)?;
        distribute(
            &mut self.acc_prepayment_fee,
            &mut self.carry_prepayment_fee,
            alloc.prepayment_fee,
            total,
        )?;
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────
    // Досрочное погашение
    // ─────────────────────────────────────────────────────────────────────

    pub fn quote_full_prepayment(&self, now: i64) -> Result<FullPrepayment> {
        let next = self.next_period as usize;

        let overdue = add(
            add(self.overdue_scheduled_interest, self.extra_interest)?,
            add(self.overdue_principal, self.penalty)?,
        )?;

        let mut remaining_principal = 0u64;
        let mut prepaid_interest = 0u64;
        for period in self.periods.iter().skip(next) {
            remaining_principal = add(
                remaining_principal,
                sub(period.principal_amount, period.principal_paid)?,
            )?;
            prepaid_interest = add(prepaid_interest, period.interest_paid)?;
        }

        let period_start = if next == 0 {
            self.funding_deadline
        } else {
            self.periods[next - 1].due_ts
        };
        let elapsed = now.saturating_sub(period_start).max(0) as u128;
        let accrued = to_u64(
            (remaining_principal as u128)
                .checked_mul(self.annual_rate_bps as u128)
                .and_then(|x| x.checked_mul(elapsed))
                .ok_or_else(|| error!(DalaError::MathOverflow))?
                / ACCRUAL_DENOMINATOR,
        )?;
        let current_interest = accrued.saturating_sub(prepaid_interest);

        let fee = to_u64(mul_div(
            remaining_principal as u128,
            self.prepayment_fee_bps as u128,
            BPS_DENOMINATOR,
        )?)?;

        let total = add(
            add(overdue, current_interest)?,
            add(remaining_principal, fee)?,
        )?;

        Ok(FullPrepayment {
            overdue,
            current_interest,
            remaining_principal,
            fee,
            total,
        })
    }

    /// Закрывает долг полностью по котировке, полученной в той же транзакции.
    pub fn apply_full_prepayment(&mut self, quote: &FullPrepayment) -> Result<Allocation> {
        // Ровно сумма просрочки закрывает просроченные проценты, тело и пеню, аванса не остаётся.
        let mut alloc = if quote.overdue > 0 {
            self.allocate_active(quote.overdue)?
        } else {
            Allocation::default()
        };

        // Ненаступившие платежи считаются погашенными: тело возвращено целиком,
        // проценты — за фактическое время.
        let next = self.next_period as usize;
        for period in self.periods.iter_mut().skip(next) {
            period.principal_paid = period.principal_amount;
            period.interest_paid = period.interest_amount;
        }

        alloc.interest = add(alloc.interest, quote.current_interest)?;
        alloc.principal = add(alloc.principal, quote.remaining_principal)?;
        alloc.prepayment_fee = add(alloc.prepayment_fee, quote.fee)?;

        self.state = DealState::Repaid;
        Ok(alloc)
    }

    /// Частичное досрочное погашение тела `amount` в дату платежа.
    /// Оставшиеся платежи уменьшаются пропорционально, даты не меняются.
    /// Возвращает комиссию за досрочное погашение.
    pub fn apply_partial_prepayment(&mut self, now: i64, amount: u64) -> Result<u64> {
        let n = self.periods.len();
        let next = self.next_period as usize;
        require!(next >= 1 && next < n, DalaError::NotPaymentDate);

        let payment_date = self.periods[next - 1].due_ts;
        require!(
            now >= payment_date && now < payment_date.saturating_add(SECONDS_PER_DAY),
            DalaError::NotPaymentDate
        );

        require!(
            self.overdue_scheduled_interest == 0
                && self.overdue_principal == 0
                && self.extra_interest == 0
                && self.penalty == 0,
            DalaError::HasOverdue
        );

        let mut balance = 0u64;
        for period in self.periods.iter().skip(next) {
            require!(
                period.principal_paid == 0 && period.interest_paid == 0,
                DalaError::HasAdvance
            );
            balance = add(balance, period.principal_amount)?;
        }
        require!(amount > 0 && amount < balance, DalaError::InvalidPrepaymentAmount);

        let fee = self.partial_prepayment_fee(amount)?;

        let new_balance = balance - amount;
        let mut assigned = 0u64;
        for k in next..n {
            let scaled = if k + 1 == n {
                sub(new_balance, assigned)?
            } else {
                to_u64(mul_div(
                    self.periods[k].principal_amount as u128,
                    new_balance as u128,
                    balance as u128,
                )?)?
            };
            assigned = add(assigned, scaled)?;
            self.periods[k].principal_amount = scaled;
        }

        self.recompute_interest(next, new_balance)?;
        Ok(fee)
    }

    /// Комиссия за частичное досрочное погашение тела `amount`.
    pub fn partial_prepayment_fee(&self, amount: u64) -> Result<u64> {
        to_u64(mul_div(
            amount as u128,
            self.prepayment_fee_bps as u128,
            BPS_DENOMINATOR,
        )?)
    }

    /// Частичное досрочное погашение одним траншем: сначала проводится уже причитающееся
    /// (наступивший платёж, просрочка, пеня), затем досрочно гасится тело `amount`.
    /// Заёмщику не нужно разносить платёж и досрочную часть по разным переводам.
    pub fn prepay_partial_settling_due(&mut self, now: i64, amount: u64) -> Result<Allocation> {
        let due = self.due_obligations()?;
        let mut alloc = if due > 0 {
            self.allocate_active(due)?
        } else {
            Allocation::default()
        };
        require!(alloc.advance == 0, DalaError::HasAdvance);

        let fee = self.apply_partial_prepayment(now, amount)?;
        alloc.principal = add(alloc.principal, amount)?;
        alloc.prepayment_fee = add(alloc.prepayment_fee, fee)?;
        Ok(alloc)
    }
}
