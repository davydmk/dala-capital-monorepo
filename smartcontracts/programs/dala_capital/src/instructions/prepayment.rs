use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::DalaError;
use crate::events::*;
use crate::math::{add, sub};
use crate::state::{Deal, DealState, Platform, ScheduleType};
use crate::token_utils::transfer;

#[event_cpi]
#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct Prepay<'info> {
    pub operator: Signer<'info>,

    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        has_one = operator @ DalaError::Unauthorized,
    )]
    pub platform: Box<Account<'info, Platform>>,

    #[account(
        mut,
        seeds = [DEAL_SEED, platform.key().as_ref(), &campaign_id.to_le_bytes()],
        bump = deal.bump,
        has_one = platform @ DalaError::Unauthorized,
        has_one = vault @ DalaError::InvalidPubkey,
    )]
    pub deal: Box<Account<'info, Deal>>,

    /// CHECK: PDA адреса погашения, подписывает перевод в волт.
    #[account(seeds = [REPAY_SEED, deal.key().as_ref()], bump = deal.repay_bump)]
    pub repay_owner: UncheckedAccount<'info>,

    #[account(mut, address = deal.repay_account @ DalaError::InvalidPubkey)]
    pub repay_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = deal.mint @ DalaError::WrongMint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
}

fn require_prepayable(deal: &Deal) -> Result<()> {
    require!(deal.state == DealState::Active, DalaError::InvalidDealState);
    require!(
        deal.schedule_type == ScheduleType::Annuity,
        DalaError::PrepaymentNotAllowed
    );
    Ok(())
}

/// Переводит ровно `amount` с адреса погашения в волт. Досрочное погашение требует
/// точного поступления: частично исполненная операция не имеет смысла.
fn pull_exact(ctx: &mut Context<Prepay>, amount: u64) -> Result<()> {
    require!(
        ctx.accounts.repay_token.amount >= amount,
        DalaError::InsufficientRepayBalance
    );

    let deal_key = ctx.accounts.deal.key();
    let repay_bump = [ctx.accounts.deal.repay_bump];
    let repay_seeds: &[&[u8]] = &[REPAY_SEED, deal_key.as_ref(), &repay_bump];

    let before = ctx.accounts.vault.amount;
    transfer(
        &ctx.accounts.token_program,
        ctx.accounts.repay_token.to_account_info(),
        &ctx.accounts.mint,
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.repay_owner.to_account_info(),
        &[repay_seeds],
        amount,
    )?;
    ctx.accounts.vault.reload()?;
    let received = sub(ctx.accounts.vault.amount, before)?;
    require!(received == amount, DalaError::InsufficientReceived);
    Ok(())
}

/// Полное досрочное погашение в любой день по заявке заёмщика.
pub fn handle_prepay_full(mut ctx: Context<Prepay>, campaign_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_prepayable(&ctx.accounts.deal)?;

    ctx.accounts.deal.accrue(now)?;
    let quote = ctx.accounts.deal.quote_full_prepayment(now)?;
    require!(quote.total > 0, DalaError::NothingToProcess);

    pull_exact(&mut ctx, quote.total)?;

    let alloc = {
        let deal = &mut ctx.accounts.deal;
        let alloc = deal.apply_full_prepayment(&quote)?;
        deal.credit_investors(&alloc)?;
        alloc
    };

    emit_cpi!(EarlyRepayment {
        campaign_id,
        full: true,
        principal: alloc.principal,
        interest: alloc.interest,
        penalty: alloc.penalty,
        prepayment_fee: alloc.prepayment_fee,
        total: quote.total,
    });
    Ok(())
}

/// Частичное досрочное погашение тела в дату платежа одним траншем.
///
/// С адреса погашения берётся уже причитающееся (сегодняшний платёж, просрочка, пеня)
/// плюс `principal_amount` и комиссия. Сначала проводится причитающееся, затем досрочная часть.
/// Недоступно при авансе и вне суток с даты платежа.
pub fn handle_prepay_partial(
    mut ctx: Context<Prepay>,
    campaign_id: u64,
    principal_amount: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_prepayable(&ctx.accounts.deal)?;

    ctx.accounts.deal.accrue(now)?;
    let due = ctx.accounts.deal.due_obligations()?;
    let fee = ctx.accounts.deal.partial_prepayment_fee(principal_amount)?;
    let total = add(add(due, principal_amount)?, fee)?;

    pull_exact(&mut ctx, total)?;

    let alloc = {
        let deal = &mut ctx.accounts.deal;
        let alloc = deal.prepay_partial_settling_due(now, principal_amount)?;
        require!(alloc.to_investors()? == total, DalaError::MathOverflow);
        deal.credit_investors(&alloc)?;
        alloc
    };

    emit_cpi!(EarlyRepayment {
        campaign_id,
        full: false,
        principal: alloc.principal,
        interest: alloc.interest,
        penalty: alloc.penalty,
        prepayment_fee: alloc.prepayment_fee,
        total,
    });
    Ok(())
}
