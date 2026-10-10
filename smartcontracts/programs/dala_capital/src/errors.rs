use anchor_lang::prelude::*;

#[error_code]
pub enum DalaError {
    #[msg("Нулевой публичный ключ недопустим")]
    InvalidPubkey,
    #[msg("Подписант не имеет прав на эту операцию")]
    Unauthorized,
    #[msg("Токен не разрешён платформой")]
    MintNotAllowed,
    #[msg("Достигнут лимит разрешённых токенов")]
    TooManyMints,
    #[msg("Неверный токен")]
    WrongMint,
    #[msg("Неверный параметр кампании")]
    InvalidCampaignParams,
    #[msg("Неверный график платежей")]
    InvalidSchedule,
    #[msg("График уже зафиксирован")]
    ScheduleFinalized,
    #[msg("График ещё не зафиксирован")]
    ScheduleNotFinalized,
    #[msg("Превышено максимальное число платежей")]
    TooManyPeriods,
    #[msg("Операция недопустима в текущем состоянии кампании")]
    InvalidDealState,
    #[msg("Сбор ещё не начался")]
    FundingNotStarted,
    #[msg("Сбор уже закрыт")]
    FundingClosed,
    #[msg("Сбор ещё не завершён")]
    FundingStillOpen,
    #[msg("Сумма на адресе пополнения меньше минимального взноса")]
    BelowMinTicket,
    #[msg("Нет места для зачисления: достигнут hard cap или max ticket")]
    NoCapacity,
    #[msg("Средства не поступили")]
    NothingReceived,
    #[msg("Поступила не вся ожидаемая сумма")]
    InsufficientReceived,
    #[msg("Нечего выводить")]
    NothingToWithdraw,
    #[msg("Нечего обрабатывать")]
    NothingToProcess,
    #[msg("Недостаточно средств на адресе погашения")]
    InsufficientRepayBalance,
    #[msg("Вывод на адрес заблокирован")]
    WhitelistDisabled,
    #[msg("С момента смены адреса вывода не прошло 48 часов")]
    AddressChangeDelayNotPassed,
    #[msg("Порог дефолта не достигнут")]
    DefaultThresholdNotReached,
    #[msg("Досрочное погашение недоступно для этой схемы")]
    PrepaymentNotAllowed,
    #[msg("Частичное досрочное погашение возможно только в дату платежа")]
    NotPaymentDate,
    #[msg("Есть просрочка или пеня")]
    HasOverdue,
    #[msg("Есть аванс по будущим платежам")]
    HasAdvance,
    #[msg("Неверная сумма досрочного погашения")]
    InvalidPrepaymentAmount,
    #[msg("Неверная сумма")]
    InvalidAmount,
    #[msg("Переполнение при вычислении")]
    MathOverflow,
    #[msg("Кошелёк заёмщика не может быть токен-счётом или нулевым ключом")]
    InvalidBorrowerWallet,
    #[msg("После дедлайна отмена доступна только по истечении льготного срока")]
    CancelGracePeriodActive,
}
