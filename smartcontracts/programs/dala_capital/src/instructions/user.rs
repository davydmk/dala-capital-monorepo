use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::DalaError;
use crate::events::*;
use crate::state::{EntityType, Platform, UserAccount};

#[event_cpi]
#[derive(Accounts)]
#[instruction(user_id: [u8; 16])]
pub struct CreateUser<'info> {
    #[account(mut)]
    pub whitelist_authority: Signer<'info>,

    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        has_one = whitelist_authority @ DalaError::Unauthorized,
    )]
    pub platform: Account<'info, Platform>,

    #[account(
        init,
        payer = whitelist_authority,
        space = 8 + UserAccount::INIT_SPACE,
        seeds = [USER_SEED, platform.key().as_ref(), user_id.as_ref()],
        bump,
    )]
    pub user: Account<'info, UserAccount>,

    pub system_program: Program<'info, System>,
}

/// Вызывается после прохождения KYC на бэкенде.
pub fn handle_create_user(
    ctx: Context<CreateUser>,
    user_id: [u8; 16],
    entity_type: EntityType,
    withdrawal_address: Pubkey,
    whitelist_status: bool,
) -> Result<()> {
    require_keys_neq!(withdrawal_address, Pubkey::default(), DalaError::InvalidPubkey);

    {
        let platform_key = ctx.accounts.platform.key();
        let user = &mut ctx.accounts.user;
        user.platform = platform_key;
        user.user_id = user_id;
        user.entity_type = entity_type;
        user.withdrawal_address = withdrawal_address;
        user.whitelist_status = whitelist_status;
        user.withdrawal_address_changed_at = 0;
        user.bump = ctx.bumps.user;
    }

    emit_cpi!(UserCreated {
        user_id,
        entity_type,
        withdrawal_address,
        whitelist_status,
    });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(user_id: [u8; 16])]
pub struct SetWithdrawalAddress<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        has_one = admin @ DalaError::Unauthorized,
    )]
    pub platform: Account<'info, Platform>,

    #[account(
        mut,
        seeds = [USER_SEED, platform.key().as_ref(), user_id.as_ref()],
        bump = user.bump,
    )]
    pub user: Account<'info, UserAccount>,
}

/// Новый адрес сразу блокируется: включить whitelist можно только через `ADDRESS_CHANGE_DELAY`.
pub fn handle_set_withdrawal_address(
    ctx: Context<SetWithdrawalAddress>,
    user_id: [u8; 16],
    withdrawal_address: Pubkey,
) -> Result<()> {
    require_keys_neq!(withdrawal_address, Pubkey::default(), DalaError::InvalidPubkey);
    let now = Clock::get()?.unix_timestamp;

    {
        let user = &mut ctx.accounts.user;
        user.withdrawal_address = withdrawal_address;
        user.whitelist_status = false;
        user.withdrawal_address_changed_at = now;
    }

    emit_cpi!(WithdrawalAddressChanged {
        user_id,
        withdrawal_address,
    });
    emit_cpi!(WhitelistChanged {
        user_id,
        whitelist_status: false,
    });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(user_id: [u8; 16])]
pub struct SetWhitelistStatus<'info> {
    pub whitelist_authority: Signer<'info>,

    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        has_one = whitelist_authority @ DalaError::Unauthorized,
    )]
    pub platform: Account<'info, Platform>,

    #[account(
        mut,
        seeds = [USER_SEED, platform.key().as_ref(), user_id.as_ref()],
        bump = user.bump,
    )]
    pub user: Account<'info, UserAccount>,
}

pub fn handle_set_whitelist_status(
    ctx: Context<SetWhitelistStatus>,
    user_id: [u8; 16],
    whitelist_status: bool,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    {
        let user = &mut ctx.accounts.user;
        if whitelist_status && user.withdrawal_address_changed_at != 0 {
            require!(
                now >= user
                    .withdrawal_address_changed_at
                    .saturating_add(ADDRESS_CHANGE_DELAY),
                DalaError::AddressChangeDelayNotPassed
            );
        }
        user.whitelist_status = whitelist_status;
    }

    emit_cpi!(WhitelistChanged {
        user_id,
        whitelist_status,
    });
    Ok(())
}
