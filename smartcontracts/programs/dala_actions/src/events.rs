use anchor_lang::prelude::*;

use crate::state::{ActionKind, ActionStatus};

/// События — неизменная история выпуска. Состояние живёт в аккаунтах, а эти
/// записи остаются в транзакциях навсегда и доказывают, что и когда было.
#[event]
pub struct BondIssued {
    pub campaign_id: u64,
    pub mint: Pubkey,
    pub face_value: u64,
    pub coupon_rate_bps: u32,
    pub coupons_per_year: u8,
    pub maturity_ts: i64,
    pub max_supply: u64,
}

#[event]
pub struct UnitsMinted {
    pub campaign_id: u64,
    pub holder: Pubkey,
    pub units: u64,
    pub outstanding: u64,
}

#[event]
pub struct UnitsBurned {
    pub campaign_id: u64,
    pub holder: Pubkey,
    pub units: u64,
    pub outstanding: u64,
    /// true — погашение бумаги, false — возврат взноса по несостоявшемуся сбору.
    pub redemption: bool,
}

#[event]
pub struct BondStatusChanged {
    pub campaign_id: u64,
    pub status: BondStatusView,
}

/// Отдельный вид для события: в событиях удобнее плоское перечисление.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub enum BondStatusView {
    Active,
    Defaulted,
    Redeemed,
    Cancelled,
}

#[event]
pub struct ActionDeclared {
    pub campaign_id: u64,
    pub index: u32,
    pub kind: ActionKind,
    pub record_ts: i64,
    pub payment_ts: i64,
    pub amount_per_unit: u64,
}

#[event]
pub struct SnapshotRecorded {
    pub campaign_id: u64,
    pub index: u32,
    pub holders: u32,
    pub units: u64,
    pub total_amount: u64,
    pub register_hash: [u8; 32],
}

#[event]
pub struct ActionSettled {
    pub campaign_id: u64,
    pub index: u32,
    pub kind: ActionKind,
    pub total_amount: u64,
    pub votes_for: u64,
    pub votes_against: u64,
}

#[event]
pub struct ActionClosed {
    pub campaign_id: u64,
    pub index: u32,
    pub status: ActionStatus,
}
