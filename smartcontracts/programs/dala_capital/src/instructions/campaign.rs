use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::DalaError;
use crate::events::*;
use crate::state::{Deal, DealState, Period, Platform, ScheduleType};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct CampaignParams {
    pub soft_cap: u64,
    pub hard_cap: u64,
    pub min_ticket: u64,
    /// 0 = без ограничения.
    pub max_ticket: u64,
    pub funding_start: i64,
    /// Дедлайн сбора и начало первого процентного периода.
    pub funding_deadline: i64,
    pub schedule_type: ScheduleType,
    pub annual_rate_bps: u32,
    /// 12, 4, 2 или 1.
    pub periods_per_year: u8,
    pub penalty_rate_bps: u32,
    /// Клиент по умолчанию подставляет 90 для аннуитета и 30 для купона.
    pub default_threshold_days: u16,
    /// Только для аннуитета, для купона должна быть 0.
    pub prepayment_fee_bps: u32,
    pub platform_fee_bps: u32,
    /// Через сколько дней после дедлайна админ может отменить кампанию, если сбор не закрыт.
    /// Клиент по умолчанию подставляет 7.
    pub cancel_grace_days: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct PeriodInput {
    pub due_ts: i64,
    /// Доля тела в платеже, масштаб `SCALE`.
    pub principal_fraction: u64,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct CreateCampaign<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        has_one = admin @ DalaError::Unauthorized,
    )]
    pub platform: Box<Account<'info, Platform>>,

    #[account(
        init,
        payer = admin,
        space = 8 + Deal::INIT_SPACE,
        seeds = [DEAL_SEED, platform.key().as_ref(), &campaign_id.to_le_bytes()],
        bump,
    )]
    pub deal: Box<Account<'info, Deal>>,

    #[account(
        constraint = platform.allowed_mints.contains(&mint.key()) @ DalaError::MintNotAllowed,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: кошелёк заёмщика, например адрес пополнения на бирже. Может ещё не существовать.
    /// Не должен быть токен-счётом: ATA токен-счёта — потерянные деньги.
    #[account(
        constraint = borrower_wallet.key() != Pubkey::default() @ DalaError::InvalidBorrowerWallet,
        constraint = *borrower_wallet.owner != anchor_spl::token::ID
            && *borrower_wallet.owner != anchor_spl::token_2022::ID @ DalaError::InvalidBorrowerWallet,
    )]
    pub borrower_wallet: UncheckedAccount<'info>,

    /// CHECK: PDA адреса погашения, данных не хранит.
    #[account(seeds = [REPAY_SEED, deal.key().as_ref()], bump)]
    pub repay_owner: UncheckedAccount<'info>,

    /// `init_if_needed`: адрес ATA вычисляется из номера кампании, и посторонний может создать его
    /// заранее, чтобы заблокировать создание кампании. Хозяин всё равно PDA кампании — это
    /// проверяют ограничения ниже; учёт опирается на разницу балансов, лишние токены — пыль.
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = mint,
        associated_token::authority = deal,
        associated_token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// `init_if_needed` — по той же причине. Токены, присланные заранее, засчитываются как погашение.
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = mint,
        associated_token::authority = repay_owner,
        associated_token::token_program = token_program,
    )]
    pub repay_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Создаёт кампанию без графика. График загружается частями через `add_schedule_periods`
/// и фиксируется `finalize_schedule` — целиком он не помещается в одну транзакцию.
pub fn handle_create_campaign(
    ctx: Context<CreateCampaign>,
    campaign_id: u64,
    params: CampaignParams,
) -> Result<()> {
    let p = params;
    require!(
        p.soft_cap > 0 && p.soft_cap <= p.hard_cap,
        DalaError::InvalidCampaignParams
    );
    require!(
        p.min_ticket > 0 && p.min_ticket <= p.soft_cap,
        DalaError::InvalidCampaignParams
    );
    require!(
        p.max_ticket == 0 || p.max_ticket >= p.min_ticket,
        DalaError::InvalidCampaignParams
    );
    require!(
        p.funding_start < p.funding_deadline,
        DalaError::InvalidCampaignParams
    );
    require!(
        matches!(p.periods_per_year, 1 | 2 | 4 | 12),
        DalaError::InvalidCampaignParams
    );
    require!(p.annual_rate_bps > 0, DalaError::InvalidCampaignParams);
    require!(p.default_threshold_days > 0, DalaError::InvalidCampaignParams);
    require!(
        (p.platform_fee_bps as u128) < BPS_DENOMINATOR,
        DalaError::InvalidCampaignParams
    );
    require!(
        (p.prepayment_fee_bps as u128) < BPS_DENOMINATOR,
        DalaError::InvalidCampaignParams
    );
    require!(p.cancel_grace_days > 0, DalaError::InvalidCampaignParams);
    if p.schedule_type == ScheduleType::Coupon {
        require!(p.prepayment_fee_bps == 0, DalaError::InvalidCampaignParams);
    }

    let platform_key = ctx.accounts.platform.key();
    let mint = ctx.accounts.mint.key();
    let borrower_wallet = ctx.accounts.borrower_wallet.key();

    {
        let deal = &mut ctx.accounts.deal;
        deal.platform = platform_key;
        deal.campaign_id = campaign_id;
        deal.mint = mint;
        deal.vault = ctx.accounts.vault.key();
        deal.repay_account = ctx.accounts.repay_token.key();
        deal.borrower_wallet = borrower_wallet;

        deal.soft_cap = p.soft_cap;
        deal.hard_cap = p.hard_cap;
        deal.min_ticket = p.min_ticket;
        deal.max_ticket = p.max_ticket;
        deal.funding_start = p.funding_start;
        deal.funding_deadline = p.funding_deadline;

        deal.schedule_type = p.schedule_type;
        deal.annual_rate_bps = p.annual_rate_bps;
        deal.periods_per_year = p.periods_per_year;
        deal.penalty_rate_bps = p.penalty_rate_bps;
        deal.default_threshold_days = p.default_threshold_days;
        deal.prepayment_fee_bps = p.prepayment_fee_bps;
        deal.platform_fee_bps = p.platform_fee_bps;
        deal.cancel_grace_days = p.cancel_grace_days;

        deal.periods = Vec::new();
        deal.schedule_finalized = false;
        deal.state = DealState::Funding;
        deal.total_raised = 0;
        deal.next_period = 0;
        deal.last_accrual_ts = p.funding_deadline;

        deal.bump = ctx.bumps.deal;
        deal.repay_bump = ctx.bumps.repay_owner;
    }

    let platform = &mut ctx.accounts.platform;
    platform.campaign_count = platform
        .campaign_count
        .checked_add(1)
        .ok_or_else(|| error!(DalaError::MathOverflow))?;

    emit_cpi!(CampaignCreated {
        campaign_id,
        mint,
        borrower_wallet,
        soft_cap: p.soft_cap,
        hard_cap: p.hard_cap,
        funding_start: p.funding_start,
        funding_deadline: p.funding_deadline,
        schedule_type: p.schedule_type,
        annual_rate_bps: p.annual_rate_bps,
    });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct ManageSchedule<'info> {
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

/// Дописывает платежи в конец графика. Даты строго возрастают, первая — позже дедлайна сбора.
pub fn handle_add_schedule_periods(
    ctx: Context<ManageSchedule>,
    campaign_id: u64,
    periods: Vec<PeriodInput>,
) -> Result<()> {
    require!(!periods.is_empty(), DalaError::InvalidSchedule);

    let total_periods = {
        let deal = &mut ctx.accounts.deal;
        require!(deal.state == DealState::Funding, DalaError::InvalidDealState);
        require!(!deal.schedule_finalized, DalaError::ScheduleFinalized);

        for input in periods {
            require!(deal.periods.len() < MAX_PERIODS, DalaError::TooManyPeriods);
            let previous = deal
                .periods
                .last()
                .map(|period| period.due_ts)
                .unwrap_or(deal.funding_deadline);
            require!(input.due_ts > previous, DalaError::InvalidSchedule);

            deal.periods.push(Period {
                due_ts: input.due_ts,
                principal_fraction: input.principal_fraction,
                ..Period::default()
            });
        }
        deal.periods.len() as u8
    };

    emit_cpi!(SchedulePeriodsAdded {
        campaign_id,
        total_periods,
    });
    Ok(())
}

/// Фиксирует график. Без этого зачисление депозитов недоступно,
/// а закрытие сбора переводит кампанию в Failed.
pub fn handle_finalize_schedule(ctx: Context<ManageSchedule>, campaign_id: u64) -> Result<()> {
    let period_count = {
        let deal = &mut ctx.accounts.deal;
        require!(deal.state == DealState::Funding, DalaError::InvalidDealState);
        require!(!deal.schedule_finalized, DalaError::ScheduleFinalized);
        deal.validate_schedule()?;
        deal.schedule_finalized = true;
        deal.periods.len() as u8
    };

    emit_cpi!(ScheduleFinalized {
        campaign_id,
        period_count,
    });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct SetBorrowerWallet<'info> {
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

    /// CHECK: новый кошелёк заёмщика. Те же требования, что при создании кампании.
    #[account(
        constraint = borrower_wallet.key() != Pubkey::default() @ DalaError::InvalidBorrowerWallet,
        constraint = *borrower_wallet.owner != anchor_spl::token::ID
            && *borrower_wallet.owner != anchor_spl::token_2022::ID @ DalaError::InvalidBorrowerWallet,
    )]
    pub borrower_wallet: UncheckedAccount<'info>,
}

/// Меняет кошелёк заёмщика, пока кампания в сборе — в том числе после дедлайна, до закрытия.
/// Для случаев «заёмщик потерял доступ к кошельку» и «биржа сменила депозитный адрес».
pub fn handle_set_borrower_wallet(ctx: Context<SetBorrowerWallet>, campaign_id: u64) -> Result<()> {
    let new_wallet = ctx.accounts.borrower_wallet.key();

    let old_wallet = {
        let deal = &mut ctx.accounts.deal;
        require!(deal.state == DealState::Funding, DalaError::InvalidDealState);
        let old = deal.borrower_wallet;
        deal.borrower_wallet = new_wallet;
        old
    };

    emit_cpi!(BorrowerWalletChanged {
        campaign_id,
        old_wallet,
        new_wallet,
    });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct CancelCampaign<'info> {
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

/// Отмена до дедлайна — в любой момент. После дедлайна судьбу кампании решает `close_funding`;
/// отмена снова доступна, только если за `cancel_grace_days` сбор так и не удалось закрыть
/// (например, счёт заёмщика заморожен эмитентом стейблкоина), чтобы деньги инвесторов не застряли.
pub fn handle_cancel_campaign(ctx: Context<CancelCampaign>, campaign_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let total_raised = {
        let deal = &mut ctx.accounts.deal;
        require!(deal.state == DealState::Funding, DalaError::InvalidDealState);
        let grace_end = deal
            .funding_deadline
            .saturating_add(deal.cancel_grace_days as i64 * SECONDS_PER_DAY);
        require!(
            now < deal.funding_deadline || now >= grace_end,
            DalaError::CancelGracePeriodActive
        );
        deal.state = DealState::Failed;
        deal.total_raised
    };

    emit_cpi!(CampaignCancelled {
        campaign_id,
        total_raised,
    });
    Ok(())
}
