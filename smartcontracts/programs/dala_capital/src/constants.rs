pub const PLATFORM_SEED: &[u8] = b"platform";
pub const DEAL_SEED: &[u8] = b"deal";
pub const USER_SEED: &[u8] = b"user";
pub const POSITION_SEED: &[u8] = b"pos";
pub const DEPOSIT_SEED: &[u8] = b"deposit";
pub const REPAY_SEED: &[u8] = b"repay";

/// Масштаб фиксированной точки для долей тела и аккумуляторов распределения.
pub const SCALE: u128 = 1_000_000_000_000;

pub const BPS_DENOMINATOR: u128 = 10_000;

/// База для начисления по фактическому времени: процентов на просроченное тело,
/// пени и процентов при досрочном погашении.
pub const DAY_COUNT_BASIS: u128 = 360;

pub const SECONDS_PER_DAY: i64 = 86_400;

/// Знаменатель начисления за `t` секунд: `amount × rate_bps × t / ACCRUAL_DENOMINATOR`.
pub const ACCRUAL_DENOMINATOR: u128 = BPS_DENOMINATOR * DAY_COUNT_BASIS * SECONDS_PER_DAY as u128;

/// Должно совпадать с `#[max_len]` у `Deal::periods`.
pub const MAX_PERIODS: usize = 60;

/// Должно совпадать с `#[max_len]` у `Platform::allowed_mints`.
pub const MAX_ALLOWED_MINTS: usize = 8;

pub const ADDRESS_CHANGE_DELAY: i64 = 48 * 60 * 60;
