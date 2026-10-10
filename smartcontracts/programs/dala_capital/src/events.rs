use anchor_lang::prelude::*;

use crate::state::{EntityType, ScheduleType};

#[event]
pub struct PlatformInitialized {
    pub admin: Pubkey,
    pub operator: Pubkey,
    pub whitelist_authority: Pubkey,
    pub treasury: Pubkey,
}

#[event]
pub struct PlatformUpdated {
    pub admin: Pubkey,
    pub operator: Pubkey,
    pub whitelist_authority: Pubkey,
    pub treasury: Pubkey,
}

#[event]
pub struct MintAllowed {
    pub mint: Pubkey,
}

#[event]
pub struct MintRemoved {
    pub mint: Pubkey,
}

#[event]
pub struct UserCreated {
    pub user_id: [u8; 16],
    pub entity_type: EntityType,
    pub withdrawal_address: Pubkey,
    pub whitelist_status: bool,
}

#[event]
pub struct WithdrawalAddressChanged {
    pub user_id: [u8; 16],
    pub withdrawal_address: Pubkey,
}

#[event]
pub struct WhitelistChanged {
    pub user_id: [u8; 16],
    pub whitelist_status: bool,
}

#[event]
pub struct CampaignCreated {
    pub campaign_id: u64,
    pub mint: Pubkey,
    pub borrower_wallet: Pubkey,
    pub soft_cap: u64,
    pub hard_cap: u64,
    pub funding_start: i64,
    pub funding_deadline: i64,
    pub schedule_type: ScheduleType,
    pub annual_rate_bps: u32,
}

#[event]
pub struct BorrowerWalletChanged {
    pub campaign_id: u64,
    pub old_wallet: Pubkey,
    pub new_wallet: Pubkey,
}

#[event]
pub struct SchedulePeriodsAdded {
    pub campaign_id: u64,
    pub total_periods: u8,
}

#[event]
pub struct ScheduleFinalized {
    pub campaign_id: u64,
    pub period_count: u8,
}

#[event]
pub struct CampaignCancelled {
    pub campaign_id: u64,
    pub total_raised: u64,
}

#[event]
pub struct DepositOpened {
    pub campaign_id: u64,
    pub user_id: [u8; 16],
    pub deposit_token: Pubkey,
}

#[event]
pub struct Invested {
    pub campaign_id: u64,
    pub user_id: [u8; 16],
    pub amount: u64,
    pub position_principal: u64,
    pub total_raised: u64,
}

#[event]
pub struct FundingClosed {
    pub campaign_id: u64,
    pub total_raised: u64,
    pub platform_fee: u64,
    pub payout_amount: u64,
}

#[event]
pub struct FundingFailed {
    pub campaign_id: u64,
    pub total_raised: u64,
}

#[event]
pub struct RepaymentProcessed {
    pub campaign_id: u64,
    pub received: u64,
    pub recovery: u64,
    pub interest: u64,
    pub principal: u64,
    pub penalty: u64,
    pub advance: u64,
    pub repaid: bool,
}

#[event]
pub struct DefaultMarked {
    pub campaign_id: u64,
    pub days_past_due: i64,
    pub principal: u64,
    pub interest: u64,
    pub penalty: u64,
}

#[event]
pub struct RecoveryCostRecorded {
    pub campaign_id: u64,
    pub amount: u64,
    pub total_costs: u64,
}

#[event]
pub struct EarlyRepayment {
    pub campaign_id: u64,
    pub full: bool,
    pub principal: u64,
    pub interest: u64,
    pub penalty: u64,
    pub prepayment_fee: u64,
    pub total: u64,
}

#[event]
pub struct PayoutWithdrawn {
    pub campaign_id: u64,
    pub user_id: [u8; 16],
    pub principal: u64,
    pub interest: u64,
    pub penalty: u64,
    pub prepayment_fee: u64,
    pub amount: u64,
}

#[event]
pub struct RefundWithdrawn {
    pub campaign_id: u64,
    pub user_id: [u8; 16],
    pub amount: u64,
}

#[event]
pub struct DepositWithdrawn {
    pub campaign_id: u64,
    pub user_id: [u8; 16],
    pub amount: u64,
    pub closed: bool,
}
