//! Dala Capital V2 — кампании займов в стейблкоинах на Solana.
//!
//! Пользователи и заёмщики не подключают кошельки: пользователь пополняет персональный
//! адрес пополнения кампании, заёмщик — адрес погашения кампании. Операции от имени
//! пользователей подписывает ключ оператора, выплаты уходят только на одобренный
//! адрес вывода пользователя.
//!
//! График — аннуитет или купон. Поступления заёмщика распределяются между инвесторами
//! пропорционально вкладам, раздельно по статьям: тело, проценты, пеня, комиссия
//! за досрочное погашение.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;
pub mod token_utils;

pub use instructions::*;
pub use state::{EntityType, ScheduleType};

declare_id!("JCLPbcLwdYJs1UJgL6LK1nhYRUcGk5ziFPx55nVL9akB");

#[program]
pub mod dala_capital {
    use super::*;

    // ── Платформа ──────────────────────────────────────────────────────────

    pub fn init_platform(
        ctx: Context<InitPlatform>,
        admin: Pubkey,
        operator: Pubkey,
        whitelist_authority: Pubkey,
        treasury: Pubkey,
    ) -> Result<()> {
        instructions::platform::handle_init_platform(
            ctx,
            admin,
            operator,
            whitelist_authority,
            treasury,
        )
    }

    pub fn update_platform(
        ctx: Context<UpdatePlatform>,
        new_admin: Option<Pubkey>,
        new_operator: Option<Pubkey>,
        new_whitelist_authority: Option<Pubkey>,
        new_treasury: Option<Pubkey>,
    ) -> Result<()> {
        instructions::platform::handle_update_platform(
            ctx,
            new_admin,
            new_operator,
            new_whitelist_authority,
            new_treasury,
        )
    }

    pub fn allow_mint(ctx: Context<AllowMint>) -> Result<()> {
        instructions::platform::handle_allow_mint(ctx)
    }

    pub fn remove_mint(ctx: Context<RemoveMint>, mint: Pubkey) -> Result<()> {
        instructions::platform::handle_remove_mint(ctx, mint)
    }

    // ── Пользователи ───────────────────────────────────────────────────────

    pub fn create_user(
        ctx: Context<CreateUser>,
        user_id: [u8; 16],
        entity_type: EntityType,
        withdrawal_address: Pubkey,
        whitelist_status: bool,
    ) -> Result<()> {
        instructions::user::handle_create_user(
            ctx,
            user_id,
            entity_type,
            withdrawal_address,
            whitelist_status,
        )
    }

    pub fn set_withdrawal_address(
        ctx: Context<SetWithdrawalAddress>,
        user_id: [u8; 16],
        withdrawal_address: Pubkey,
    ) -> Result<()> {
        instructions::user::handle_set_withdrawal_address(ctx, user_id, withdrawal_address)
    }

    pub fn set_whitelist_status(
        ctx: Context<SetWhitelistStatus>,
        user_id: [u8; 16],
        whitelist_status: bool,
    ) -> Result<()> {
        instructions::user::handle_set_whitelist_status(ctx, user_id, whitelist_status)
    }

    // ── Кампания ───────────────────────────────────────────────────────────

    pub fn create_campaign(
        ctx: Context<CreateCampaign>,
        campaign_id: u64,
        params: CampaignParams,
    ) -> Result<()> {
        instructions::campaign::handle_create_campaign(ctx, campaign_id, params)
    }

    pub fn add_schedule_periods(
        ctx: Context<ManageSchedule>,
        campaign_id: u64,
        periods: Vec<PeriodInput>,
    ) -> Result<()> {
        instructions::campaign::handle_add_schedule_periods(ctx, campaign_id, periods)
    }

    pub fn finalize_schedule(ctx: Context<ManageSchedule>, campaign_id: u64) -> Result<()> {
        instructions::campaign::handle_finalize_schedule(ctx, campaign_id)
    }

    pub fn cancel_campaign(ctx: Context<CancelCampaign>, campaign_id: u64) -> Result<()> {
        instructions::campaign::handle_cancel_campaign(ctx, campaign_id)
    }

    pub fn set_borrower_wallet(ctx: Context<SetBorrowerWallet>, campaign_id: u64) -> Result<()> {
        instructions::campaign::handle_set_borrower_wallet(ctx, campaign_id)
    }

    // ── Сбор ───────────────────────────────────────────────────────────────

    pub fn open_deposit(
        ctx: Context<OpenDeposit>,
        campaign_id: u64,
        user_id: [u8; 16],
    ) -> Result<()> {
        instructions::funding::handle_open_deposit(ctx, campaign_id, user_id)
    }

    pub fn invest(ctx: Context<Invest>, campaign_id: u64, user_id: [u8; 16]) -> Result<()> {
        instructions::funding::handle_invest(ctx, campaign_id, user_id)
    }

    pub fn close_funding(ctx: Context<CloseFunding>, campaign_id: u64) -> Result<()> {
        instructions::funding::handle_close_funding(ctx, campaign_id)
    }

    // ── Погашение и дефолт ─────────────────────────────────────────────────

    pub fn process_repayment(ctx: Context<ProcessRepayment>, campaign_id: u64) -> Result<()> {
        instructions::repayment::handle_process_repayment(ctx, campaign_id)
    }

    pub fn mark_default(ctx: Context<MarkDefault>, campaign_id: u64) -> Result<()> {
        instructions::repayment::handle_mark_default(ctx, campaign_id)
    }

    pub fn record_recovery_cost(
        ctx: Context<RecordRecoveryCost>,
        campaign_id: u64,
        amount: u64,
    ) -> Result<()> {
        instructions::repayment::handle_record_recovery_cost(ctx, campaign_id, amount)
    }

    pub fn prepay_full(ctx: Context<Prepay>, campaign_id: u64) -> Result<()> {
        instructions::prepayment::handle_prepay_full(ctx, campaign_id)
    }

    pub fn prepay_partial(
        ctx: Context<Prepay>,
        campaign_id: u64,
        principal_amount: u64,
    ) -> Result<()> {
        instructions::prepayment::handle_prepay_partial(ctx, campaign_id, principal_amount)
    }

    // ── Выводы ─────────────────────────────────────────────────────────────

    pub fn withdraw_payout(
        ctx: Context<WithdrawFromVault>,
        campaign_id: u64,
        user_id: [u8; 16],
    ) -> Result<()> {
        instructions::withdraw::handle_withdraw_payout(ctx, campaign_id, user_id)
    }

    pub fn withdraw_refund(
        ctx: Context<WithdrawFromVault>,
        campaign_id: u64,
        user_id: [u8; 16],
    ) -> Result<()> {
        instructions::withdraw::handle_withdraw_refund(ctx, campaign_id, user_id)
    }

    pub fn withdraw_deposit(
        ctx: Context<WithdrawDeposit>,
        campaign_id: u64,
        user_id: [u8; 16],
    ) -> Result<()> {
        instructions::withdraw::handle_withdraw_deposit(ctx, campaign_id, user_id)
    }
}
