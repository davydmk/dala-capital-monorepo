use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::DalaError;
use crate::events::*;
use crate::math::{add, sub};
use crate::state::{Allocation, Deal, DealState, Platform};
use crate::token_utils::transfer;

#[event_cpi]
#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct ProcessRepayment<'info> {
    pub caller: Signer<'info>,

    #[account(seeds = [PLATFORM_SEED], bump = platform.bump)]
    pub platform: Box<Account<'info, Platform>>,

    #[account(
        mut,
        seeds = [DEAL_SEED, platform.key().as_ref(), &campaign_id.to_le_bytes()],
        bump = deal.bump,
        has_one = platform @ DalaError::Unauthorized,
        has_one = vault @ DalaError::InvalidPubkey,
    )]
    pub deal: Box<Account<'info, Deal>>,

    /// CHECK: PDA адреса погашения, подписывает переводы.
    #[account(seeds = [REPAY_SEED, deal.key().as_ref()], bump = deal.repay_bump)]
    pub repay_owner: UncheckedAccount<'info>,

    #[account(mut, address = deal.repay_account @ DalaError::InvalidPubkey)]
    pub repay_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = treasury_token.owner == platform.treasury @ DalaError::Unauthorized,
        constraint = treasury_token.mint == deal.mint @ DalaError::WrongMint,
    )]
    pub treasury_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = deal.mint @ DalaError::WrongMint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Забирает поступление с адреса погашения и распределяет.
///
/// До дефолта кто угодно проводит только уже причитающееся: просрочку и пеню.
/// Аванс в счёт будущих платежей проводит только оператор — иначе деньги, присланные
/// под досрочное погашение, мог бы превратить в аванс посторонний вызов раньше оператора.
///
/// В дефолте — только оператор, чтобы расходы на взыскание успели быть внесены до распределения.
pub fn handle_process_repayment(ctx: Context<ProcessRepayment>, campaign_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let state = ctx.accounts.deal.state;
    match state {
        DealState::Active => {}
        DealState::Default => require_keys_eq!(
            ctx.accounts.caller.key(),
            ctx.accounts.platform.operator,
            DalaError::Unauthorized
        ),
        _ => return err!(DalaError::InvalidDealState),
    }

    ctx.accounts.deal.accrue(now)?;

    let deal_key = ctx.accounts.deal.key();
    let repay_bump = [ctx.accounts.deal.repay_bump];
    let repay_seeds: &[&[u8]] = &[REPAY_SEED, deal_key.as_ref(), &repay_bump];
    let balance = ctx.accounts.repay_token.amount;

    let mut alloc = Allocation::default();
    let mut received_total = 0u64;

    if state == DealState::Active {
        let is_operator = ctx.accounts.caller.key() == ctx.accounts.platform.operator;
        let limit = if is_operator {
            ctx.accounts.deal.active_obligations()?
        } else {
            ctx.accounts.deal.due_obligations()?
        };
        let amount = balance.min(limit);
        require!(amount > 0, DalaError::NothingToProcess);

        let received = move_to_vault(&ctx, repay_seeds, amount)?;
        ctx.accounts.vault.reload()?;
        alloc = ctx.accounts.deal.allocate_active(received)?;
        require!(is_operator || alloc.advance == 0, DalaError::Unauthorized);
        received_total = received;
    } else {
        let recovery = balance.min(ctx.accounts.deal.recovery_outstanding()?);
        let debt = sub(balance, recovery)?.min(ctx.accounts.deal.default_debt()?);
        require!(recovery > 0 || debt > 0, DalaError::NothingToProcess);

        // Расходы на взыскание — прямо в казну, минуя волт.
        if recovery > 0 {
            let before = ctx.accounts.treasury_token.amount;
            transfer(
                &ctx.accounts.token_program,
                ctx.accounts.repay_token.to_account_info(),
                &ctx.accounts.mint,
                ctx.accounts.treasury_token.to_account_info(),
                ctx.accounts.repay_owner.to_account_info(),
                &[repay_seeds],
                recovery,
            )?;
            ctx.accounts.treasury_token.reload()?;
            let got = sub(ctx.accounts.treasury_token.amount, before)?;

            let deal = &mut ctx.accounts.deal;
            deal.recovery_reimbursed = add(deal.recovery_reimbursed, got)?;
            alloc.recovery = got;
            received_total = add(received_total, got)?;
        }

        if debt > 0 {
            let received = move_to_vault(&ctx, repay_seeds, debt)?;
            ctx.accounts.vault.reload()?;
            let debt_alloc = ctx.accounts.deal.allocate_default_debt(received)?;
            alloc.interest = debt_alloc.interest;
            alloc.principal = debt_alloc.principal;
            alloc.penalty = debt_alloc.penalty;
            received_total = add(received_total, received)?;
        }
    }

    let repaid = {
        let deal = &mut ctx.accounts.deal;
        deal.credit_investors(&alloc)?;
        let settled = match deal.state {
            DealState::Active => deal.active_fully_paid(),
            DealState::Default => deal.default_fully_paid(),
            _ => false,
        };
        if settled {
            deal.state = DealState::Repaid;
        }
        settled
    };

    emit_cpi!(RepaymentProcessed {
        campaign_id,
        received: received_total,
        recovery: alloc.recovery,
        interest: alloc.interest,
        principal: alloc.principal,
        penalty: alloc.penalty,
        advance: alloc.advance,
        repaid,
    });
    Ok(())
}

/// Переводит `amount` с адреса погашения в волт и возвращает фактически полученную сумму.
fn move_to_vault(ctx: &Context<ProcessRepayment>, repay_seeds: &[&[u8]], amount: u64) -> Result<u64> {
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
    let vault_info = ctx.accounts.vault.to_account_info();
    let after = {
        let data = vault_info.try_borrow_data()?;
        let account = anchor_spl::token_interface::TokenAccount::try_deserialize(&mut &data[..])?;
        account.amount
    };
    let received = sub(after, before)?;
    require!(received > 0, DalaError::NothingReceived);
    Ok(received)
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct MarkDefault<'info> {
    pub caller: Signer<'info>,

    #[account(seeds = [PLATFORM_SEED], bump = platform.bump)]
    pub platform: Box<Account<'info, Platform>>,

    #[account(
        mut,
        seeds = [DEAL_SEED, platform.key().as_ref(), &campaign_id.to_le_bytes()],
        bump = deal.bump,
        has_one = platform @ DalaError::Unauthorized,
    )]
    pub deal: Box<Account<'info, Deal>>,
}

/// Вызвать может кто угодно: программа проверяет только, что просрочка достигла порога.
pub fn handle_mark_default(ctx: Context<MarkDefault>, campaign_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let (days_past_due, principal, interest, penalty) = {
        let deal = &mut ctx.accounts.deal;
        require!(deal.state == DealState::Active, DalaError::InvalidDealState);
        deal.accrue(now)?;

        let days_past_due = deal.days_past_due(now);
        require!(
            days_past_due >= deal.default_threshold_days as i64,
            DalaError::DefaultThresholdNotReached
        );

        deal.enter_default()?;
        (
            days_past_due,
            deal.default_principal,
            deal.default_interest,
            deal.penalty,
        )
    };

    emit_cpi!(DefaultMarked {
        campaign_id,
        days_past_due,
        principal,
        interest,
        penalty,
    });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct RecordRecoveryCost<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        has_one = admin @ DalaError::Unauthorized,
    )]
    pub platform: Box<Account<'info, Platform>>,

    #[account(
        mut,
        seeds = [DEAL_SEED, platform.key().as_ref(), &campaign_id.to_le_bytes()],
        bump = deal.bump,
        has_one = platform @ DalaError::Unauthorized,
    )]
    pub deal: Box<Account<'info, Deal>>,
}

/// Вносится после фактической оплаты расходов платформой. Суммы складываются.
pub fn handle_record_recovery_cost(
    ctx: Context<RecordRecoveryCost>,
    campaign_id: u64,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, DalaError::InvalidAmount);
    let now = Clock::get()?.unix_timestamp;

    let total_costs = {
        let deal = &mut ctx.accounts.deal;
        require!(deal.state == DealState::Default, DalaError::InvalidDealState);
        deal.accrue(now)?;
        deal.recovery_costs = add(deal.recovery_costs, amount)?;
        deal.recovery_costs
    };

    emit_cpi!(RecoveryCostRecorded {
        campaign_id,
        amount,
        total_costs,
    });
    Ok(())
}
