use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum EntityType {
    Individual,
    Legal,
}

#[account]
#[derive(InitSpace)]
pub struct UserAccount {
    pub platform: Pubkey,
    pub user_id: [u8; 16],
    /// Хранится для бэкенда, логика программы его не использует.
    pub entity_type: EntityType,
    /// Единственный адрес для любых выплат пользователю (владелец, не токен-счёт).
    pub withdrawal_address: Pubkey,
    pub whitelist_status: bool,
    /// 0 для нового аккаунта.
    pub withdrawal_address_changed_at: i64,
    pub bump: u8,
}
