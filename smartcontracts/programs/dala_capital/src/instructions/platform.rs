use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::DalaError;
use crate::events::*;
use crate::state::Platform;

#[event_cpi]
#[derive(Accounts)]
pub struct InitPlatform<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Platform::INIT_SPACE,
        seeds = [PLATFORM_SEED],
        bump,
    )]
    pub platform: Account<'info, Platform>,

    pub system_program: Program<'info, System>,
}

/// `admin` передаётся аргументом: деплоить можно горячим ключом, а админом сразу поставить мультисиг.
pub fn handle_init_platform(
    ctx: Context<InitPlatform>,
    admin: Pubkey,
    operator: Pubkey,
    whitelist_authority: Pubkey,
    treasury: Pubkey,
) -> Result<()> {
    for key in [admin, operator, whitelist_authority, treasury] {
        require_keys_neq!(key, Pubkey::default(), DalaError::InvalidPubkey);
    }

    {
        let platform = &mut ctx.accounts.platform;
        platform.admin = admin;
        platform.operator = operator;
        platform.whitelist_authority = whitelist_authority;
        platform.treasury = treasury;
        platform.allowed_mints = Vec::new();
        platform.campaign_count = 0;
        platform.bump = ctx.bumps.platform;
    }

    emit_cpi!(PlatformInitialized {
        admin,
        operator,
        whitelist_authority,
        treasury,
    });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct UpdatePlatform<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        has_one = admin @ DalaError::Unauthorized,
    )]
    pub platform: Account<'info, Platform>,
}

/// `None` — оставить как есть. После смены казны нужно заново вызвать `allow_mint`
/// для каждого токена, чтобы создать токен-счета новой казны.
pub fn handle_update_platform(
    ctx: Context<UpdatePlatform>,
    new_admin: Option<Pubkey>,
    new_operator: Option<Pubkey>,
    new_whitelist_authority: Option<Pubkey>,
    new_treasury: Option<Pubkey>,
) -> Result<()> {
    let (admin, operator, whitelist_authority, treasury) = {
        let platform = &mut ctx.accounts.platform;
        if let Some(key) = new_admin {
            require_keys_neq!(key, Pubkey::default(), DalaError::InvalidPubkey);
            platform.admin = key;
        }
        if let Some(key) = new_operator {
            require_keys_neq!(key, Pubkey::default(), DalaError::InvalidPubkey);
            platform.operator = key;
        }
        if let Some(key) = new_whitelist_authority {
            require_keys_neq!(key, Pubkey::default(), DalaError::InvalidPubkey);
            platform.whitelist_authority = key;
        }
        if let Some(key) = new_treasury {
            require_keys_neq!(key, Pubkey::default(), DalaError::InvalidPubkey);
            platform.treasury = key;
        }
        (
            platform.admin,
            platform.operator,
            platform.whitelist_authority,
            platform.treasury,
        )
    };

    emit_cpi!(PlatformUpdated {
        admin,
        operator,
        whitelist_authority,
        treasury,
    });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct AllowMint<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        has_one = admin @ DalaError::Unauthorized,
    )]
    pub platform: Account<'info, Platform>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: владелец токен-счёта казны, сверяется с платформой.
    #[account(address = platform.treasury @ DalaError::InvalidPubkey)]
    pub treasury: UncheckedAccount<'info>,

    /// Создаётся вместе с разрешением токена: закрытие сбора может вызвать кто угодно,
    /// и оплачивать создание счёта казны ему не придётся.
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = mint,
        associated_token::authority = treasury,
        associated_token::token_program = token_program,
    )]
    pub treasury_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Идемпотентна: для уже разрешённого токена только создаёт недостающий счёт казны.
pub fn handle_allow_mint(ctx: Context<AllowMint>) -> Result<()> {
    let mint = ctx.accounts.mint.key();
    {
        let platform = &mut ctx.accounts.platform;
        if !platform.allowed_mints.contains(&mint) {
            require!(
                platform.allowed_mints.len() < MAX_ALLOWED_MINTS,
                DalaError::TooManyMints
            );
            platform.allowed_mints.push(mint);
        }
    }

    emit_cpi!(MintAllowed { mint });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct RemoveMint<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        has_one = admin @ DalaError::Unauthorized,
    )]
    pub platform: Account<'info, Platform>,
}

/// Уже созданные кампании в этом токене не затрагиваются.
pub fn handle_remove_mint(ctx: Context<RemoveMint>, mint: Pubkey) -> Result<()> {
    ctx.accounts.platform.allowed_mints.retain(|m| *m != mint);
    emit_cpi!(MintRemoved { mint });
    Ok(())
}
