use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::DalaError;
use crate::events::*;
use crate::math::{add, mul_div, sub, to_u64};
use crate::state::{Deal, DealState, Platform, Position, UserAccount};
use crate::token_utils::transfer;

#[event_cpi]
#[derive(Accounts)]
#[instruction(campaign_id: u64, user_id: [u8; 16])]
pub struct OpenDeposit<'info> {
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

    /// CHECK: PDA адреса пополнения, данных не хранит.
    #[account(seeds = [DEPOSIT_SEED, deal.key().as_ref(), user_id.as_ref()], bump)]
    pub deposit_owner: UncheckedAccount<'info>,

    #[account(address = deal.mint @ DalaError::WrongMint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// `init_if_needed`: ATA для любого владельца может создать кто угодно,
    /// и это не должно блокировать открытие адреса.
    #[account(
        init_if_needed,
        payer = operator,
        associated_token::mint = mint,
        associated_token::authority = deposit_owner,
        associated_token::token_program = token_program,
    )]
    pub deposit_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_open_deposit(
    ctx: Context<OpenDeposit>,
    campaign_id: u64,
    user_id: [u8; 16],
) -> Result<()> {
    require!(
        ctx.accounts.deal.state == DealState::Funding,
        DalaError::InvalidDealState
    );

    let deposit_token = ctx.accounts.deposit_token.key();
    emit_cpi!(DepositOpened {
        campaign_id,
        user_id,
        deposit_token,
    });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(campaign_id: u64, user_id: [u8; 16])]
pub struct Invest<'info> {
    #[account(mut)]
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

    #[account(
        seeds = [USER_SEED, platform.key().as_ref(), user_id.as_ref()],
        bump = user.bump,
    )]
    pub user: Box<Account<'info, UserAccount>>,

    #[account(
        init_if_needed,
        payer = operator,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, deal.key().as_ref(), user_id.as_ref()],
        bump,
    )]
    pub position: Box<Account<'info, Position>>,

    /// CHECK: PDA адреса пополнения, подписывает перевод в волт.
    #[account(seeds = [DEPOSIT_SEED, deal.key().as_ref(), user_id.as_ref()], bump)]
    pub deposit_owner: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = deposit_owner,
        associated_token::token_program = token_program,
    )]
    pub deposit_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = deal.mint @ DalaError::WrongMint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Переводит поступление с адреса пополнения в волт кампании и зачисляет в позицию.
/// Оператор вызывает на каждое поступление после проверки отправителя на бэкенде.
pub fn handle_invest(ctx: Context<Invest>, campaign_id: u64, user_id: [u8; 16]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let (min_ticket, max_ticket, hard_cap, total_raised) = {
        let deal = &ctx.accounts.deal;
        require!(deal.state == DealState::Funding, DalaError::InvalidDealState);
        require!(deal.schedule_finalized, DalaError::ScheduleNotFinalized);
        require!(now >= deal.funding_start, DalaError::FundingNotStarted);
        require!(now < deal.funding_deadline, DalaError::FundingClosed);
        (deal.min_ticket, deal.max_ticket, deal.hard_cap, deal.total_raised)
    };

    let balance = ctx.accounts.deposit_token.amount;
    require!(balance > 0, DalaError::NothingToProcess);

    // min_ticket сверяется с суммой на адресе, а не с зачисленной: иначе остаток
    // до hard_cap меньше min_ticket нельзя было бы добрать никогда.
    let current = ctx.accounts.position.principal;
    if current == 0 {
        require!(balance >= min_ticket, DalaError::BelowMinTicket);
    }

    let mut capacity = sub(hard_cap, total_raised)?;
    if max_ticket > 0 {
        capacity = capacity.min(max_ticket.saturating_sub(current));
    }
    let fill = balance.min(capacity);
    require!(fill > 0, DalaError::NoCapacity);

    let deal_key = ctx.accounts.deal.key();
    let deposit_bump = [ctx.bumps.deposit_owner];
    let deposit_seeds: &[&[u8]] = &[
        DEPOSIT_SEED,
        deal_key.as_ref(),
        user_id.as_ref(),
        &deposit_bump,
    ];

    let before = ctx.accounts.vault.amount;
    transfer(
        &ctx.accounts.token_program,
        ctx.accounts.deposit_token.to_account_info(),
        &ctx.accounts.mint,
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.deposit_owner.to_account_info(),
        &[deposit_seeds],
        fill,
    )?;
    ctx.accounts.vault.reload()?;
    let received = sub(ctx.accounts.vault.amount, before)?;
    require!(received > 0, DalaError::NothingReceived);

    let position_principal = {
        let position = &mut ctx.accounts.position;
        // Значения определены сидами, запись идемпотентна для существующей позиции.
        position.deal = deal_key;
        position.user_id = user_id;
        position.bump = ctx.bumps.position;
        position.principal = add(position.principal, received)?;
        position.principal
    };

    let total_raised = {
        let deal = &mut ctx.accounts.deal;
        deal.total_raised = add(deal.total_raised, received)?;
        deal.total_raised
    };

    emit_cpi!(Invested {
        campaign_id,
        user_id,
        amount: received,
        position_principal,
        total_raised,
    });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct CloseFunding<'info> {
    /// Только оператор: перевод заёмщику проходит после того, как бэкенд подтвердил адрес.
    /// Платит за создание ATA заёмщика, если её нет.
    #[account(mut)]
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
        has_one = borrower_wallet @ DalaError::InvalidPubkey,
    )]
    pub deal: Box<Account<'info, Deal>>,

    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = deal.mint @ DalaError::WrongMint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: кошелёк заёмщика, сверяется с кампанией.
    pub borrower_wallet: UncheckedAccount<'info>,

    /// ATA заёмщика. Создаётся, если её нет: например, биржа закрыла пустой депозитный счёт.
    #[account(
        init_if_needed,
        payer = operator,
        associated_token::mint = mint,
        associated_token::authority = borrower_wallet,
        associated_token::token_program = token_program,
    )]
    pub payout_destination: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = treasury_token.owner == platform.treasury @ DalaError::Unauthorized,
        constraint = treasury_token.mint == deal.mint @ DalaError::WrongMint,
    )]
    pub treasury_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Закрывает сбор после дедлайна. Вызывает только оператор — после того, как бэкенд
/// подтвердил у заёмщика актуальность кошелька: иначе посторонний мог бы отправить
/// сумму займа на адрес, к которому заёмщик потерял доступ.
///
/// Начало графика — дедлайн сбора, независимо от того, когда вызвана эта инструкция.
/// Если адрес устарел — админ меняет его через `set_borrower_wallet`. Если перевод
/// невозможен (счёт заморожен) — кампанию можно отменить после льготного срока.
pub fn handle_close_funding(ctx: Context<CloseFunding>, campaign_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let (total_raised, soft_cap, finalized, fee_bps, deadline, deal_bump) = {
        let deal = &ctx.accounts.deal;
        require!(deal.state == DealState::Funding, DalaError::InvalidDealState);
        require!(now >= deal.funding_deadline, DalaError::FundingStillOpen);
        (
            deal.total_raised,
            deal.soft_cap,
            deal.schedule_finalized,
            deal.platform_fee_bps,
            deal.funding_deadline,
            deal.bump,
        )
    };

    if !finalized || total_raised < soft_cap {
        ctx.accounts.deal.state = DealState::Failed;
        ctx.accounts.deal.funding_closed_ts = now;
        emit_cpi!(FundingFailed {
            campaign_id,
            total_raised,
        });
        return Ok(());
    }

    let platform_fee = to_u64(mul_div(
        total_raised as u128,
        fee_bps as u128,
        BPS_DENOMINATOR,
    )?)?;
    let payout_amount = sub(total_raised, platform_fee)?;

    let platform_key = ctx.accounts.platform.key();
    let id_bytes = campaign_id.to_le_bytes();
    let bump = [deal_bump];
    let deal_seeds: &[&[u8]] = &[DEAL_SEED, platform_key.as_ref(), &id_bytes, &bump];

    // Переводится ровно собранная сумма, а не весь баланс волта.
    if platform_fee > 0 {
        transfer(
            &ctx.accounts.token_program,
            ctx.accounts.vault.to_account_info(),
            &ctx.accounts.mint,
            ctx.accounts.treasury_token.to_account_info(),
            ctx.accounts.deal.to_account_info(),
            &[deal_seeds],
            platform_fee,
        )?;
    }
    transfer(
        &ctx.accounts.token_program,
        ctx.accounts.vault.to_account_info(),
        &ctx.accounts.mint,
        ctx.accounts.payout_destination.to_account_info(),
        ctx.accounts.deal.to_account_info(),
        &[deal_seeds],
        payout_amount,
    )?;

    {
        let deal = &mut ctx.accounts.deal;
        deal.build_schedule()?;
        deal.state = DealState::Active;
        deal.next_period = 0;
        deal.last_accrual_ts = deadline;
        // Начало графика считается от дедлайна, а закрыт сбор мог быть позже:
        // это разные моменты, и в журнале нужен именно второй.
        deal.funding_closed_ts = now;
    }

    emit_cpi!(FundingClosed {
        campaign_id,
        total_raised,
        platform_fee,
        payout_amount,
    });
    Ok(())
}
