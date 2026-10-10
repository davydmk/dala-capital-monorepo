use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Platform {
    /// Мультисиг: роли, токены, кампании, смена адресов вывода, расходы на взыскание.
    pub admin: Pubkey,
    /// Горячий ключ: зачисления, выводы, досрочные погашения, обработка платежей в дефолте.
    pub operator: Pubkey,
    /// Создание пользователей и переключение whitelist.
    pub whitelist_authority: Pubkey,
    /// Владелец токен-счетов казны.
    pub treasury: Pubkey,
    /// Разрешённые токены. Размер должен совпадать с `MAX_ALLOWED_MINTS`.
    #[max_len(8)]
    pub allowed_mints: Vec<Pubkey>,
    pub campaign_count: u64,
    pub bump: u8,
}
