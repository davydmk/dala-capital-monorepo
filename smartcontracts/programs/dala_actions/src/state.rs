use anchor_lang::prelude::*;

/// Жизнь выпуска. `Defaulted` — не конец: право требования живёт, пока идёт
/// взыскание, и бумаги гасятся только когда дело закрыто.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum BondStatus {
    Active,
    Defaulted,
    Redeemed,
    /// Сбор не состоялся: взносы вернулись, бумаги сожжены без погашения.
    /// Без этого состояния аннулированный выпуск в сети неотличим от
    /// пустого нового — у обоих ноль в обращении.
    Cancelled,
}

/// Вид корпоративного действия. Перечисление открытое: дивиденд, выкуп или
/// изменение условий добавляются сюда, а механика снимка и записи не меняется.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ActionKind {
    /// Только снять реестр на дату — без выплат. Нужен регулятору и отчётности.
    Record,
    Coupon,
    Redemption,
    /// Голосование держателей: считается офчейн, сюда ложится итог и хеш бюллетеней.
    Vote,
    Default,
    Recovery,
}

/// Стадии действия. Порядок проверяет программа: записать исполнение, не сняв
/// реестр, нельзя — иначе «кому платили» осталось бы недоказуемым.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ActionStatus {
    Declared,
    Snapshot,
    Settled,
    Closed,
}

/// Выпуск облигации: условия бумаги и сколько её в обращении.
///
/// Те же условия записаны в метаданные минта — там источник правды для
/// внешнего мира, здесь они нужны программе для проверок.
#[account]
#[derive(InitSpace)]
pub struct Registry {
    /// Админ платформы: выпускает бумагу, объявляет и закрывает действия.
    pub authority: Pubkey,
    /// Операторский ключ: кранки выпуска, прожига и снятия реестра.
    pub operator: Pubkey,
    /// Номер кампании в `dala_capital`, по которой выпущена бумага.
    pub campaign_id: u64,
    pub mint: Pubkey,
    /// Расчётный токен кампании: справочно, деньги ходят в `dala_capital`.
    pub payment_mint: Pubkey,
    /// Номинал одной бумаги в минимальных единицах расчётного токена.
    pub face_value: u64,
    pub coupon_rate_bps: u32,
    pub coupons_per_year: u8,
    pub maturity_ts: i64,
    /// Потолок выпуска: максимум сбора кампании, делённый на номинал.
    pub max_supply: u64,
    /// Идентификатор бумаги по ISO 6166; пусто, пока не присвоен. Лежит и
    /// здесь, и в метаданных минта: читать условия выпуска одним запросом
    /// удобнее, а расходиться им неоткуда — пишутся вместе.
    #[max_len(12)]
    pub isin: String,
    /// Всего выпущено за всё время и сколько сейчас в обращении.
    pub issued: u64,
    pub outstanding: u64,
    pub status: BondStatus,
    /// Счётчик корпоративных действий: из него берётся номер следующего.
    pub actions: u32,
    pub bump: u8,
    pub mint_bump: u8,
}

/// Корпоративное действие: объявление, снятый реестр и итог.
#[account]
#[derive(InitSpace)]
pub struct ActionRecord {
    pub registry: Pubkey,
    pub index: u32,
    pub kind: ActionKind,
    /// На кого распространяется действие: реестр снимается по состоянию на эту дату.
    pub record_ts: i64,
    /// Когда действие исполняется.
    pub payment_ts: i64,
    /// Сумма на бумагу; у голосования — одобренный предел расходов на взыскание.
    pub amount_per_unit: u64,
    /// Итоги снятого реестра.
    pub holders: u32,
    pub units: u64,
    pub total_amount: u64,
    /// Хеш опубликованного списка держателей: по нему любой проверит реестр.
    pub register_hash: [u8; 32],
    /// Подпись расчётной транзакции в `dala_capital` — деньги прошли там.
    pub settlement: [u8; 64],
    /// Итог голосования в бумагах; у остальных видов нули.
    pub votes_for: u64,
    pub votes_against: u64,
    pub status: ActionStatus,
    pub bump: u8,
}
