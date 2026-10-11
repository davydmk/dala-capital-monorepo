use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::DalaError;
use crate::events::*;
use crate::state::{Deal, DealState, Platform, Position, UserAccount};
use crate::token_utils::{close, transfer};

#[event_cpi]
#[derive(Accounts)]
#[instruction(campaign_id: u64, user_id: [u8; 16])]
pub struct WithdrawFromVault<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        has_one = operator @ DalaError::Unauthorized,
    )]
    pub platform: Box<Account<'info, Platform>>,

    #[account(
        seeds = [DEAL_SEED, platform.key().as_ref(), &campaign_id.to_le_bytes()],
        bump = deal.bump,
        has_one = platform @ DalaError::Unauthorized,
        has_one = vault @ DalaError::InvalidPubkey,
    )]
    pub deal: Box<Account<'info, Deal>>,

    #[account(
        seeds = [USER_SEED, platform.key().as_ref(), user_id.as_ref()],
        bump = user.bump,
    )]
    pub user: Box<Account<'info, UserAccount>>,

    #[account(
        mut,
        seeds = [POSITION_SEED, deal.key().as_ref(), user_id.as_ref()],
        bump = position.bump,
    )]
    pub position: Box<Account<'info, Position>>,

    /// CHECK: адрес вывода пользователя, сверяется с аккаунтом пользователя.
    #[account(address = user.withdrawal_address @ DalaError::InvalidPubkey)]
    pub withdrawal_owner: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = operator,
        associated_token::mint = mint,
        associated_token::authority = withdrawal_owner,
        associated_token::token_program = token_program,
    )]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = deal.mint @ DalaError::WrongMint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

fn send_from_vault(ctx: &Context<WithdrawFromVault>, campaign_id: u64, amount: u64) -> Result<()> {
    let platform_key = ctx.accounts.platform.key();
    let id_bytes = campaign_id.to_le_bytes();
    let bump = [ctx.accounts.deal.bump];
    let deal_seeds: &[&[u8]] = &[DEAL_SEED, platform_key.as_ref(), &id_bytes, &bump];

    transfer(
        &ctx.accounts.token_program,
        ctx.accounts.vault.to_account_info(),
        &ctx.accounts.mint,
        ctx.accounts.destination.to_account_info(),
        ctx.accounts.deal.to_account_info(),
        &[deal_seeds],
        amount,
    )
}

/// Выводит всю доступную пользователю сумму по четырём статьям.
pub fn handle_withdraw_payout(
    ctx: Context<WithdrawFromVault>,
    campaign_id: u64,
    user_id: [u8; 16],
) -> Result<()> {
    require!(ctx.accounts.user.whitelist_status, DalaError::WhitelistDisabled);

    let (payout, amount) = {
        let deal = &ctx.accounts.deal;
        require!(
            matches!(
                deal.state,
                DealState::Active | DealState::Default | DealState::Repaid
            ),
            DalaError::InvalidDealState
        );
        let payout = ctx.accounts.position.pending_payout(
            deal.acc_principal,
            deal.acc_interest,
            deal.acc_penalty,
            deal.acc_prepayment_fee,
        )?;
        let amount = payout.total()?;
        require!(amount > 0, DalaError::NothingToWithdraw);
        (payout, amount)
    };

    // Чекпоинты сдвигаются до внешнего перевода.
    {
        let acc_principal = ctx.accounts.deal.acc_principal;
        let acc_interest = ctx.accounts.deal.acc_interest;
        let acc_penalty = ctx.accounts.deal.acc_penalty;
        let acc_prepayment_fee = ctx.accounts.deal.acc_prepayment_fee;

        let position = &mut ctx.accounts.position;
        position.checkpoint_principal = acc_principal;
        position.checkpoint_interest = acc_interest;
        position.checkpoint_penalty = acc_penalty;
        position.checkpoint_prepayment_fee = acc_prepayment_fee;
    }

    send_from_vault(&ctx, campaign_id, amount)?;

    emit_cpi!(PayoutWithdrawn {
        campaign_id,
        user_id,
        principal: payout.principal,
        interest: payout.interest,
        penalty: payout.penalty,
        prepayment_fee: payout.prepayment_fee,
        amount,
    });
    Ok(())
}

/// Возврат взноса при несостоявшейся кампании.
pub fn handle_withdraw_refund(
    ctx: Context<WithdrawFromVault>,
    campaign_id: u64,
    user_id: [u8; 16],
) -> Result<()> {
    require!(ctx.accounts.user.whitelist_status, DalaError::WhitelistDisabled);
    require!(
        ctx.accounts.deal.state == DealState::Failed,
        DalaError::InvalidDealState
    );

    let amount = ctx.accounts.position.principal;
    require!(amount > 0, DalaError::NothingToWithdraw);
    ctx.accounts.position.principal = 0;

    send_from_vault(&ctx, campaign_id, amount)?;

    emit_cpi!(RefundWithdrawn {
        campaign_id,
        user_id,
        amount,
    });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(campaign_id: u64, user_id: [u8; 16])]
pub struct WithdrawDeposit<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        has_one = operator @ DalaError::Unauthorized,
    )]
    pub platform: Box<Account<'info, Platform>>,

    #[account(
        seeds = [DEAL_SEED, platform.key().as_ref(), &campaign_id.to_le_bytes()],
        bump = deal.bump,
        has_one = platform @ DalaError::Unauthorized,
    )]
    pub deal: Box<Account<'info, Deal>>,

    #[account(
        seeds = [USER_SEED, platform.key().as_ref(), user_id.as_ref()],
        bump = user.bump,
    )]
    pub user: Box<Account<'info, UserAccount>>,

    /// CHECK: PDA адреса пополнения, подписывает перевод и закрытие.
    #[account(seeds = [DEPOSIT_SEED, deal.key().as_ref(), user_id.as_ref()], bump)]
    pub deposit_owner: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = deposit_owner,
        associated_token::token_program = token_program,
    )]
    pub deposit_token: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: адрес вывода пользователя, сверяется с аккаунтом пользователя.
    #[account(address = user.withdrawal_address @ DalaError::InvalidPubkey)]
    pub withdrawal_owner: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = operator,
        associated_token::mint = mint,
        associated_token::authority = withdrawal_owner,
        associated_token::token_program = token_program,
    )]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = deal.mint @ DalaError::WrongMint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Выводит всё, что лежит на адресе пополнения и не зачислено в кампанию.
/// Если сбор уже не идёт, пустой ATA пополнения закрывается, рента возвращается оператору.
pub fn handle_withdraw_deposit(
    mut ctx: Context<WithdrawDeposit>,
    campaign_id: u64,
    user_id: [u8; 16],
) -> Result<()> {
    require!(ctx.accounts.user.whitelist_status, DalaError::WhitelistDisabled);

    let amount = ctx.accounts.deposit_token.amount;
    require!(amount > 0, DalaError::NothingToWithdraw);

    let deal_key = ctx.accounts.deal.key();
    let deposit_bump = [ctx.bumps.deposit_owner];
    let deposit_seeds: &[&[u8]] = &[
        DEPOSIT_SEED,
        deal_key.as_ref(),
        user_id.as_ref(),
        &deposit_bump,
    ];

    transfer(
        &ctx.accounts.token_program,
        ctx.accounts.deposit_token.to_account_info(),
        &ctx.accounts.mint,
        ctx.accounts.destination.to_account_info(),
        ctx.accounts.deposit_owner.to_account_info(),
        &[deposit_seeds],
        amount,
    )?;

    ctx.accounts.deposit_token.reload()?;
    let closed = ctx.accounts.deal.state != DealState::Funding
        && ctx.accounts.deposit_token.amount == 0;
    if closed {
        close_deposit(&mut ctx, deposit_seeds)?;
    }

    emit_cpi!(DepositWithdrawn {
        campaign_id,
        user_id,
        amount,
        closed,
    });
    Ok(())
}

fn close_deposit(ctx: &mut Context<WithdrawDeposit>, deposit_seeds: &[&[u8]]) -> Result<()> {
    close(
        &ctx.accounts.token_program,
        ctx.accounts.deposit_token.to_account_info(),
        ctx.accounts.operator.to_account_info(),
        ctx.accounts.deposit_owner.to_account_info(),
        &[deposit_seeds],
    )
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct WithdrawRepayExcess<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        has_one = operator @ DalaError::Unauthorized,
    )]
    pub platform: Box<Account<'info, Platform>>,

    #[account(
        seeds = [DEAL_SEED, platform.key().as_ref(), &campaign_id.to_le_bytes()],
        bump = deal.bump,
        has_one = platform @ DalaError::Unauthorized,
    )]
    pub deal: Box<Account<'info, Deal>>,

    /// CHECK: PDA адреса погашения, подписывает перевод.
    #[account(seeds = [REPAY_SEED, deal.key().as_ref()], bump = deal.repay_bump)]
    pub repay_owner: UncheckedAccount<'info>,

    #[account(mut, address = deal.repay_account @ DalaError::InvalidPubkey)]
    pub repay_token: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: кошелёк заёмщика из кампании, сверяется со сделкой.
    #[account(address = deal.borrower_wallet @ DalaError::InvalidPubkey)]
    pub borrower_wallet: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = operator,
        associated_token::mint = mint,
        associated_token::authority = borrower_wallet,
        associated_token::token_program = token_program,
    )]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = deal.mint @ DalaError::WrongMint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Возвращает заёмщику то, что осталось на адресе погашения сверх долга.
///
/// Платить ровно по копейке неудобно, и присылают с запасом. Пока заём идёт,
/// излишек — это аванс в счёт будущих платежей, и трогать его нельзя. А когда
/// заём закрыт, забирать его больше нечему: без этой инструкции деньги
/// остались бы на PDA навсегда.
pub fn handle_withdraw_repay_excess(
    ctx: Context<WithdrawRepayExcess>,
    campaign_id: u64,
) -> Result<()> {
    require!(
        ctx.accounts.deal.state == DealState::Repaid,
        DalaError::InvalidDealState
    );

    let amount = ctx.accounts.repay_token.amount;
    require!(amount > 0, DalaError::NothingToWithdraw);

    let deal_key = ctx.accounts.deal.key();
    let repay_bump = [ctx.accounts.deal.repay_bump];
    let repay_seeds: &[&[u8]] = &[REPAY_SEED, deal_key.as_ref(), &repay_bump];

    transfer(
        &ctx.accounts.token_program,
        ctx.accounts.repay_token.to_account_info(),
        &ctx.accounts.mint,
        ctx.accounts.destination.to_account_info(),
        ctx.accounts.repay_owner.to_account_info(),
        &[repay_seeds],
        amount,
    )?;

    emit_cpi!(RepayExcessWithdrawn {
        campaign_id,
        amount,
    });
    Ok(())
}
