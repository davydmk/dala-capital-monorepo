//! Корпоративные действия по токенизированным облигациям Dala Capital.
//!
//! Программа делает две вещи и сознательно не делает третью.
//!
//! **Бумага.** Выпускает минт облигации с условиями прямо в метаданных,
//! выдаёт бумаги инвестору в момент взноса и гасит их при возврате взноса или
//! погашении займа. Бумага именная: счета держателей заморожены, передать её
//! нельзя — она подтверждает право требования, а не торгуется. Так устроены
//! именные ценные бумаги, и так не ломается контур допуска инвесторов.
//!
//! **Журнал действий.** На каждое корпоративное действие — купон, погашение,
//! голосование, дефолт, взыскание или просто снимок реестра — заводится
//! аккаунт с датой фиксации, хешем реестра держателей, итогами и подписью
//! расчётной транзакции.
//!
//! **Денег здесь нет.** Купон и тело платит `dala_capital`: он это умеет и
//! покрыт тестами. Вторая платёжная система платила бы те же деньги второй раз.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{create_account, CreateAccount};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::spl_token_2022::{
    extension::ExtensionType, state::AccountState, state::Mint as MintState,
};
use anchor_spl::token_interface::{
    burn, default_account_state_initialize, freeze_account, initialize_mint2,
    metadata_pointer_initialize, mint_to, permanent_delegate_initialize, thaw_account,
    token_metadata_initialize, token_metadata_update_field, Burn, DefaultAccountStateInitialize,
    FreezeAccount, InitializeMint2, Mint, MetadataPointerInitialize, MintTo,
    PermanentDelegateInitialize, ThawAccount, Token2022, TokenAccount, TokenMetadataInitialize,
    TokenMetadataUpdateField,
};
use spl_token_metadata_interface::state::Field;

pub mod errors;
pub mod events;
pub mod state;

use errors::ActionsError;
use events::*;
use state::*;

declare_id!("7JZq4xxCLMaRefYwqgqh78skXkWrf4rtU6ArRjiokrjV");

pub const REGISTRY_SEED: &[u8] = b"registry";
pub const MINT_SEED: &[u8] = b"bond";
pub const ACTION_SEED: &[u8] = b"action";

/// Условия выпуска. Приходят из кампании `dala_capital`, но дальше живут
/// самостоятельно: бумага не должна зависеть от того, что мы помним о сделке.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct BondParams {
    pub face_value: u64,
    pub coupon_rate_bps: u32,
    pub coupons_per_year: u8,
    pub maturity_ts: i64,
    pub max_supply: u64,
    pub payment_mint: Pubkey,
    pub operator: Pubkey,
    pub name: String,
    pub symbol: String,
    pub uri: String,
}

#[program]
pub mod dala_actions {
    use super::*;

    /// Выпускает облигацию: создаёт минт с расширениями, пишет в него условия
    /// и заводит реестр. Бумаг пока ноль — выпуск открыт, но никто не вложился.
    pub fn issue_bond(ctx: Context<IssueBond>, campaign_id: u64, params: BondParams) -> Result<()> {
        require!(
            params.face_value > 0
                && params.max_supply > 0
                && params.coupons_per_year > 0
                && params.coupon_rate_bps > 0,
            ActionsError::InvalidBondParams
        );

        let extra = metadata_fields(&params, campaign_id);
        let base_len = ExtensionType::try_calculate_account_len::<MintState>(&[
            ExtensionType::MetadataPointer,
            ExtensionType::PermanentDelegate,
            ExtensionType::DefaultAccountState,
        ])
        .map_err(|_| error!(ActionsError::MathOverflow))?;
        // Метаданные лежат в том же аккаунте и дописываются после создания,
        // поэтому ренту сразу считаем на итоговый размер.
        let metadata_len = metadata_tlv_len(&params, &extra);

        let registry_key = ctx.accounts.registry.key();
        let mint_bump = ctx.bumps.mint;
        let mint_seeds: &[&[u8]] = &[MINT_SEED, registry_key.as_ref(), &[mint_bump]];

        create_account(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                CreateAccount {
                    from: ctx.accounts.authority.to_account_info(),
                    to: ctx.accounts.mint.to_account_info(),
                },
                &[mint_seeds],
            ),
            Rent::get()?.minimum_balance(base_len + metadata_len),
            base_len as u64,
            &ctx.accounts.token_program.key(),
        )?;

        // Расширения инициализируются до самого минта — так требует Token-2022.
        default_account_state_initialize(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                DefaultAccountStateInitialize {
                    token_program_id: ctx.accounts.token_program.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
            ),
            &AccountState::Frozen,
        )?;
        permanent_delegate_initialize(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                PermanentDelegateInitialize {
                    token_program_id: ctx.accounts.token_program.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
            ),
            &registry_key,
        )?;
        metadata_pointer_initialize(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                MetadataPointerInitialize {
                    token_program_id: ctx.accounts.token_program.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
            ),
            Some(registry_key),
            Some(ctx.accounts.mint.key()),
        )?;

        let registry_bump = ctx.bumps.registry;
        let id_bytes = campaign_id.to_le_bytes();
        let registry_seeds: &[&[u8]] = &[REGISTRY_SEED, &id_bytes, &[registry_bump]];

        initialize_mint2(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                InitializeMint2 {
                    mint: ctx.accounts.mint.to_account_info(),
                },
            ),
            // Ноль знаков: одна бумага неделима, как и положено облигации.
            0,
            &registry_key,
            Some(&registry_key),
        )?;

        token_metadata_initialize(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TokenMetadataInitialize {
                    program_id: ctx.accounts.token_program.to_account_info(),
                    metadata: ctx.accounts.mint.to_account_info(),
                    update_authority: ctx.accounts.registry.to_account_info(),
                    mint_authority: ctx.accounts.registry.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
                &[registry_seeds],
            ),
            params.name.clone(),
            params.symbol.clone(),
            params.uri.clone(),
        )?;

        for (key, value) in extra {
            token_metadata_update_field(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TokenMetadataUpdateField {
                        program_id: ctx.accounts.token_program.to_account_info(),
                        metadata: ctx.accounts.mint.to_account_info(),
                        update_authority: ctx.accounts.registry.to_account_info(),
                    },
                    &[registry_seeds],
                ),
                Field::Key(key),
                value,
            )?;
        }

        let registry = &mut ctx.accounts.registry;
        registry.authority = ctx.accounts.authority.key();
        registry.operator = params.operator;
        registry.campaign_id = campaign_id;
        registry.mint = ctx.accounts.mint.key();
        registry.payment_mint = params.payment_mint;
        registry.face_value = params.face_value;
        registry.coupon_rate_bps = params.coupon_rate_bps;
        registry.coupons_per_year = params.coupons_per_year;
        registry.maturity_ts = params.maturity_ts;
        registry.max_supply = params.max_supply;
        registry.issued = 0;
        registry.outstanding = 0;
        registry.status = BondStatus::Active;
        registry.actions = 0;
        registry.bump = registry_bump;
        registry.mint_bump = mint_bump;

        emit!(BondIssued {
            campaign_id,
            mint: registry.mint,
            face_value: registry.face_value,
            coupon_rate_bps: registry.coupon_rate_bps,
            coupons_per_year: registry.coupons_per_year,
            maturity_ts: registry.maturity_ts,
            max_supply: registry.max_supply,
        });
        Ok(())
    }

    /// Выдаёт бумаги инвестору сразу после зачтённого взноса.
    ///
    /// Счёт держателя создаётся замороженным — таково условие выпуска, — но на
    /// замороженный счёт нельзя начислить, поэтому регистратор размораживает
    /// его на время начисления и тут же замораживает обратно.
    pub fn mint_to_holder(ctx: Context<HolderUnits>, _campaign_id: u64, units: u64) -> Result<()> {
        require!(units > 0, ActionsError::InvalidAmount);
        require!(
            ctx.accounts.registry.status == BondStatus::Active,
            ActionsError::BondRedeemed
        );
        let issued = ctx
            .accounts
            .registry
            .issued
            .checked_add(units)
            .ok_or_else(|| error!(ActionsError::MathOverflow))?;
        require!(
            issued <= ctx.accounts.registry.max_supply,
            ActionsError::SupplyExceeded
        );

        let seeds = registry_signer(&ctx.accounts.registry);
        let seeds: &[&[u8]] = &[REGISTRY_SEED, &seeds.0, &seeds.1];

        thaw(&ctx, &[seeds])?;
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.holder_token.to_account_info(),
                    authority: ctx.accounts.registry.to_account_info(),
                },
                &[seeds],
            ),
            units,
        )?;
        freeze(&ctx, &[seeds])?;

        let registry = &mut ctx.accounts.registry;
        registry.issued = issued;
        registry.outstanding = registry
            .outstanding
            .checked_add(units)
            .ok_or_else(|| error!(ActionsError::MathOverflow))?;

        emit!(UnitsMinted {
            campaign_id: registry.campaign_id,
            holder: ctx.accounts.holder.key(),
            units,
            outstanding: registry.outstanding,
        });
        Ok(())
    }

    /// Гасит бумаги держателя: при возврате взноса или при погашении займа.
    ///
    /// Прожиг, а не пометка: обнулённый supply виден в любом обозревателе, и
    /// доказывать его нашей программой не нужно. Когда в обращении не остаётся
    /// ничего, выпуск закрывается.
    pub fn burn_from_holder(
        ctx: Context<HolderUnits>,
        _campaign_id: u64,
        units: u64,
        redemption: bool,
    ) -> Result<()> {
        require!(units > 0, ActionsError::InvalidAmount);
        require!(
            ctx.accounts.holder_token.amount >= units,
            ActionsError::NotEnoughUnits
        );

        let seeds = registry_signer(&ctx.accounts.registry);
        let seeds: &[&[u8]] = &[REGISTRY_SEED, &seeds.0, &seeds.1];

        thaw(&ctx, &[seeds])?;
        burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.holder_token.to_account_info(),
                    // Постоянный делегат: регистратор гасит бумагу без подписи
                    // держателя — так и работают принудительные действия.
                    authority: ctx.accounts.registry.to_account_info(),
                },
                &[seeds],
            ),
            units,
        )?;
        freeze(&ctx, &[seeds])?;

        let registry = &mut ctx.accounts.registry;
        registry.outstanding = registry
            .outstanding
            .checked_sub(units)
            .ok_or_else(|| error!(ActionsError::MathOverflow))?;
        if registry.outstanding == 0 && redemption {
            registry.status = BondStatus::Redeemed;
            emit!(BondStatusChanged {
                campaign_id: registry.campaign_id,
                status: BondStatusView::Redeemed,
            });
        }

        emit!(UnitsBurned {
            campaign_id: registry.campaign_id,
            holder: ctx.accounts.holder.key(),
            units,
            outstanding: registry.outstanding,
            redemption,
        });
        Ok(())
    }

    /// Переводит выпуск во взыскание или возвращает в обычное состояние.
    /// Само решение принимается в `dala_capital`, здесь оно отражается на бумаге.
    pub fn set_bond_status(
        ctx: Context<AdminOnly>,
        _campaign_id: u64,
        defaulted: bool,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        require!(
            registry.status != BondStatus::Redeemed,
            ActionsError::BondRedeemed
        );
        registry.status = if defaulted {
            BondStatus::Defaulted
        } else {
            BondStatus::Active
        };
        emit!(BondStatusChanged {
            campaign_id: registry.campaign_id,
            status: if defaulted {
                BondStatusView::Defaulted
            } else {
                BondStatusView::Active
            },
        });
        Ok(())
    }

    /// Объявляет корпоративное действие. Дата фиксации назначается заранее:
    /// держатели должны знать её до того, как реестр снят.
    pub fn declare_action(
        ctx: Context<DeclareAction>,
        _campaign_id: u64,
        index: u32,
        kind: ActionKind,
        record_ts: i64,
        payment_ts: i64,
        amount_per_unit: u64,
    ) -> Result<()> {
        require!(payment_ts >= record_ts, ActionsError::InvalidDates);

        let registry = &mut ctx.accounts.registry;
        registry.actions = registry
            .actions
            .checked_add(1)
            .ok_or_else(|| error!(ActionsError::MathOverflow))?;

        let action = &mut ctx.accounts.action;
        action.registry = registry.key();
        action.index = index;
        action.kind = kind;
        action.record_ts = record_ts;
        action.payment_ts = payment_ts;
        action.amount_per_unit = amount_per_unit;
        action.status = ActionStatus::Declared;
        action.bump = ctx.bumps.action;

        emit!(ActionDeclared {
            campaign_id: registry.campaign_id,
            index,
            kind,
            record_ts,
            payment_ts,
            amount_per_unit,
        });
        Ok(())
    }

    /// Записывает снятый реестр: сколько держателей, сколько бумаг и хеш
    /// списка. Сам список публикуется платформой — по хешу любой проверит,
    /// что реестр не подменили задним числом.
    pub fn record_snapshot(
        ctx: Context<ActionStep>,
        _campaign_id: u64,
        _index: u32,
        holders: u32,
        units: u64,
        total_amount: u64,
        register_hash: [u8; 32],
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let action = &mut ctx.accounts.action;
        require!(
            action.status == ActionStatus::Declared,
            ActionsError::InvalidActionStatus
        );
        require!(
            now >= action.record_ts,
            ActionsError::RecordDateNotReached
        );

        action.holders = holders;
        action.units = units;
        action.total_amount = total_amount;
        action.register_hash = register_hash;
        action.status = ActionStatus::Snapshot;

        emit!(SnapshotRecorded {
            campaign_id: ctx.accounts.registry.campaign_id,
            index: action.index,
            holders,
            units,
            total_amount,
            register_hash,
        });
        Ok(())
    }

    /// Отмечает действие исполненным и прикладывает подпись расчётной
    /// транзакции из `dala_capital`. Деньги прошли там — здесь остаётся
    /// проверяемая ссылка на них. Для голосования сюда же ложится итог.
    pub fn settle_action(
        ctx: Context<ActionStep>,
        _campaign_id: u64,
        _index: u32,
        settlement: [u8; 64],
        votes_for: u64,
        votes_against: u64,
    ) -> Result<()> {
        let action = &mut ctx.accounts.action;
        require!(
            action.status == ActionStatus::Snapshot,
            ActionsError::SnapshotMissing
        );

        action.settlement = settlement;
        action.votes_for = votes_for;
        action.votes_against = votes_against;
        action.status = ActionStatus::Settled;

        emit!(ActionSettled {
            campaign_id: ctx.accounts.registry.campaign_id,
            index: action.index,
            kind: action.kind,
            total_amount: action.total_amount,
            votes_for,
            votes_against,
        });
        Ok(())
    }

    /// Закрывает действие. Снимок реестра закрывается сразу после записи:
    /// у него нет исполнения, он сам по себе результат.
    pub fn close_action(ctx: Context<CloseAction>, _campaign_id: u64, _index: u32) -> Result<()> {
        let action = &mut ctx.accounts.action;
        require!(
            action.status == ActionStatus::Settled
                || (action.kind == ActionKind::Record
                    && action.status == ActionStatus::Snapshot),
            ActionsError::InvalidActionStatus
        );
        action.status = ActionStatus::Closed;

        emit!(ActionClosed {
            campaign_id: ctx.accounts.registry.campaign_id,
            index: action.index,
            status: ActionStatus::Closed,
        });
        Ok(())
    }
}

// ── Вспомогательное ─────────────────────────────────────────────────────────

/// Сиды подписи реестра: номер кампании и bump, вынесенные во владение
/// вызывающего, — иначе временные значения не доживут до CPI.
fn registry_signer(registry: &Account<'_, Registry>) -> ([u8; 8], [u8; 1]) {
    (registry.campaign_id.to_le_bytes(), [registry.bump])
}

fn thaw(ctx: &Context<HolderUnits>, seeds: &[&[&[u8]]]) -> Result<()> {
    thaw_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        ThawAccount {
            account: ctx.accounts.holder_token.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.registry.to_account_info(),
        },
        seeds,
    ))
}

fn freeze(ctx: &Context<HolderUnits>, seeds: &[&[&[u8]]]) -> Result<()> {
    freeze_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        FreezeAccount {
            account: ctx.accounts.holder_token.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.registry.to_account_info(),
        },
        seeds,
    ))
}

/// Дополнительные поля метаданных: условия бумаги, записанные в неё саму.
fn metadata_fields(params: &BondParams, campaign_id: u64) -> Vec<(String, String)> {
    vec![
        ("face_value".to_string(), params.face_value.to_string()),
        ("coupon_bps".to_string(), params.coupon_rate_bps.to_string()),
        (
            "coupons_per_year".to_string(),
            params.coupons_per_year.to_string(),
        ),
        ("maturity".to_string(), params.maturity_ts.to_string()),
        ("campaign".to_string(), campaign_id.to_string()),
    ]
}

/// Сколько места займут метаданные в аккаунте минта: тип и длина TLV плюс сами
/// поля. Считаем заранее, потому что рента вносится при создании аккаунта, а
/// метаданные дописываются уже после.
fn metadata_tlv_len(params: &BondParams, extra: &[(String, String)]) -> usize {
    let mut len = 32 + 32; // update_authority + mint
    len += 4 + params.name.len() + 4 + params.symbol.len() + 4 + params.uri.len();
    len += 4; // длина вектора дополнительных полей
    for (key, value) in extra {
        len += 4 + key.len() + 4 + value.len();
    }
    2 + 4 + len
}

// ── Аккаунты ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct IssueBond<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Registry::INIT_SPACE,
        seeds = [REGISTRY_SEED, &campaign_id.to_le_bytes()],
        bump,
    )]
    pub registry: Account<'info, Registry>,

    /// CHECK: минт создаётся вручную — с расширениями и метаданными,
    /// которых типизированный `init` не умеет.
    #[account(mut, seeds = [MINT_SEED, registry.key().as_ref()], bump)]
    pub mint: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct HolderUnits<'info> {
    #[account(mut, constraint = operator.key() == registry.operator @ ActionsError::Unauthorized)]
    pub operator: Signer<'info>,

    #[account(
        mut,
        seeds = [REGISTRY_SEED, &campaign_id.to_le_bytes()],
        bump = registry.bump,
    )]
    pub registry: Account<'info, Registry>,

    #[account(
        mut,
        address = registry.mint @ ActionsError::Unauthorized,
        mint::token_program = token_program,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: держатель бумаги — владелец токен-счёта, подпись не нужна.
    pub holder: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = operator,
        associated_token::mint = mint,
        associated_token::authority = holder,
        associated_token::token_program = token_program,
    )]
    pub holder_token: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct AdminOnly<'info> {
    #[account(constraint = authority.key() == registry.authority @ ActionsError::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [REGISTRY_SEED, &campaign_id.to_le_bytes()],
        bump = registry.bump,
    )]
    pub registry: Account<'info, Registry>,
}

#[derive(Accounts)]
#[instruction(campaign_id: u64, index: u32)]
pub struct DeclareAction<'info> {
    #[account(mut, constraint = authority.key() == registry.authority @ ActionsError::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [REGISTRY_SEED, &campaign_id.to_le_bytes()],
        bump = registry.bump,
    )]
    pub registry: Account<'info, Registry>,

    #[account(
        init,
        payer = authority,
        space = 8 + ActionRecord::INIT_SPACE,
        seeds = [ACTION_SEED, registry.key().as_ref(), &index.to_le_bytes()],
        bump,
    )]
    pub action: Account<'info, ActionRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(campaign_id: u64, index: u32)]
pub struct ActionStep<'info> {
    #[account(constraint = operator.key() == registry.operator @ ActionsError::Unauthorized)]
    pub operator: Signer<'info>,

    #[account(
        seeds = [REGISTRY_SEED, &campaign_id.to_le_bytes()],
        bump = registry.bump,
    )]
    pub registry: Account<'info, Registry>,

    #[account(
        mut,
        seeds = [ACTION_SEED, registry.key().as_ref(), &index.to_le_bytes()],
        bump = action.bump,
        constraint = action.registry == registry.key() @ ActionsError::Unauthorized,
    )]
    pub action: Account<'info, ActionRecord>,
}

#[derive(Accounts)]
#[instruction(campaign_id: u64, index: u32)]
pub struct CloseAction<'info> {
    #[account(constraint = authority.key() == registry.authority @ ActionsError::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [REGISTRY_SEED, &campaign_id.to_le_bytes()],
        bump = registry.bump,
    )]
    pub registry: Account<'info, Registry>,

    #[account(
        mut,
        seeds = [ACTION_SEED, registry.key().as_ref(), &index.to_le_bytes()],
        bump = action.bump,
        constraint = action.registry == registry.key() @ ActionsError::Unauthorized,
    )]
    pub action: Account<'info, ActionRecord>,
}
