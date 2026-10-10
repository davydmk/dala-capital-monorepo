use anchor_lang::prelude::*;

#[error_code]
pub enum ActionsError {
    #[msg("Операцию подписал не тот ключ")]
    Unauthorized,
    #[msg("Выпуск уже погашен")]
    BondRedeemed,
    #[msg("Нельзя выпустить больше, чем предусмотрено условиями")]
    SupplyExceeded,
    #[msg("Нечего выпускать или гасить: сумма должна быть больше нуля")]
    InvalidAmount,
    #[msg("У держателя меньше бумаг, чем указано")]
    NotEnoughUnits,
    #[msg("Дата фиксации ещё не наступила")]
    RecordDateNotReached,
    #[msg("Дата фиксации должна быть раньше даты исполнения")]
    InvalidDates,
    #[msg("Действие в неподходящем состоянии")]
    InvalidActionStatus,
    #[msg("Реестр по действию ещё не снят")]
    SnapshotMissing,
    #[msg("Условия выпуска заданы неверно")]
    InvalidBondParams,
    #[msg("Переполнение при расчёте")]
    MathOverflow,
}
