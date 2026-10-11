use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum DealState {
    Funding,
    Failed,
    Active,
    Default,
    Repaid,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ScheduleType {
    Annuity,
    Coupon,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Debug, InitSpace)]
pub struct Period {
    pub due_ts: i64,
    /// Доля тела в платеже, масштаб `SCALE`. Задаётся при создании кампании.
    pub principal_fraction: u64,
    /// Тело платежа в токенах. Рассчитывается при закрытии сбора.
    pub principal_amount: u64,
    /// Проценты платежа по графику. Рассчитываются при закрытии сбора
    /// и пересчитываются при частичном досрочном погашении.
    pub interest_amount: u64,
    pub principal_paid: u64,
    pub interest_paid: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Deal {
    // ── Параметры ──────────────────────────────────────────────────────────
    pub platform: Pubkey,
    pub campaign_id: u64,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub repay_account: Pubkey,
    /// Кошелёк заёмщика — владелец, не токен-счёт. Собранные деньги уходят на его ATA,
    /// которая при необходимости создаётся при закрытии сбора.
    pub borrower_wallet: Pubkey,

    pub soft_cap: u64,
    pub hard_cap: u64,
    pub min_ticket: u64,
    /// 0 = без ограничения.
    pub max_ticket: u64,
    pub funding_start: i64,
    /// Начало первого процентного периода.
    pub funding_deadline: i64,

    pub schedule_type: ScheduleType,
    pub annual_rate_bps: u32,
    pub periods_per_year: u8,
    pub penalty_rate_bps: u32,
    pub default_threshold_days: u16,
    pub prepayment_fee_bps: u32,
    pub platform_fee_bps: u32,
    /// Через сколько дней после дедлайна админ может отменить кампанию,
    /// если сбор так и не удалось закрыть.
    pub cancel_grace_days: u16,

    /// Размер должен совпадать с `MAX_PERIODS`.
    #[max_len(60)]
    pub periods: Vec<Period>,
    pub schedule_finalized: bool,

    // ── Состояние ──────────────────────────────────────────────────────────
    pub state: DealState,
    pub total_raised: u64,
    /// Когда оператор закрыл сбор; 0 — пока не закрыт. Без этого поля момент
    /// закрытия пришлось бы брать из журнала платформы, то есть из её записей
    /// о самой себе, а не из сети.
    pub funding_closed_ts: i64,
    /// Первый период, дата которого ещё не наступила.
    pub next_period: u8,

    /// Неоплаченное тело наступивших периодов (до дефолта).
    pub overdue_principal: u64,
    /// Неоплаченные проценты наступивших периодов (до дефолта).
    pub overdue_scheduled_interest: u64,
    /// Проценты по ставке займа, начисленные на просроченное тело (до дефолта).
    pub extra_interest: u64,
    pub penalty: u64,

    /// Весь неоплаченный остаток тела после дефолта.
    pub default_principal: u64,
    /// Неоплаченные проценты после дефолта, включая начисляемые.
    pub default_interest: u64,

    pub interest_carry: u128,
    pub penalty_carry: u128,
    pub last_accrual_ts: i64,

    pub recovery_costs: u64,
    pub recovery_reimbursed: u64,

    pub acc_principal: u128,
    pub acc_interest: u128,
    pub acc_penalty: u128,
    pub acc_prepayment_fee: u128,
    pub carry_principal: u128,
    pub carry_interest: u128,
    pub carry_penalty: u128,
    pub carry_prepayment_fee: u128,

    pub bump: u8,
    pub repay_bump: u8,
}
