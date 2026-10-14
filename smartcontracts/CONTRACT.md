# The contract, documented

**English** · [Русский](CONTRACT.ru.md)

A reference for developers and AI agents seeing this repository for the first time. It describes what the program does, how the accounts and the accounting are laid out, and what every instruction expects.

The functional requirements live in a separate internal document and are not part of this repository. Where this document and the code disagree, **the code is right** — fix the document.

---

## 1. What the program does

A Solana program (Anchor 0.31) for loan campaigns denominated in stablecoins (USDC, USDT):

1. Collects investors' money into a campaign and hands the proceeds to the borrower, less the platform fee.
2. Keeps a repayment schedule — **annuity** or **coupon** (interest on schedule, principal at the end).
3. Accepts the borrower's payments and distributes them among investors pro rata to their contributions, kept apart by item: **principal, interest, penalty, prepayment fee**.
4. Accounts for arrears, penalty interest, default, recovery costs and prepayment.
5. Sends a user's money **only** to their approved withdrawal address.

**The key design decision:** users and borrowers have no wallets in the program. A user transfers stablecoin to a personal **deposit address** (a PDA of the program), a borrower to the campaign's **repayment address**. Every operation on a user's behalf is signed by the platform's **operator key** on the backend's instruction.

**The second one:** payouts are not iterated. When a borrower repays, the amount is added to accumulators on the deal, and each investor's share is derived from their position when they claim — so one transaction settles any number of holders (section 6.6).

---

## 2. Quick start

### Where things live

```
programs/dala_capital/src/
├── lib.rs                  entry point: 23 instructions, delegating into instructions/
├── constants.rs            PDA seeds, SCALE, accrual bases, limits
├── errors.rs               DalaError (codes 6000+)
├── events.rs               events, emitted through emit_cpi!
├── math.rs                 checked arithmetic, accumulator distribution
├── token_utils.rs          transfer_checked / close_account through token_interface
├── state/
│   ├── platform.rs         Platform — roles, allowed tokens
│   ├── user.rs             UserAccount — withdrawal address, whitelist
│   ├── position.rs         Position — a user's share in a campaign, payout calculation
│   ├── deal.rs             Deal — campaign parameters, schedule, accounting state
│   ├── accounting.rs       all of the accounting logic (impl Deal)
│   └── accounting_tests.rs accounting unit tests
└── instructions/
    ├── platform.rs         init_platform, update_platform, allow_mint, remove_mint
    ├── user.rs             create_user, set_withdrawal_address, set_whitelist_status
    ├── campaign.rs         create_campaign, add_schedule_periods, finalize_schedule, set_borrower_wallet, cancel_campaign
    ├── funding.rs          open_deposit, invest, close_funding
    ├── repayment.rs        process_repayment, mark_default, record_recovery_cost
    ├── prepayment.rs       prepay_full, prepay_partial
    └── withdraw.rs         withdraw_payout, withdraw_refund, withdraw_deposit
tests/                      integration tests (TypeScript + LiteSVM)
```

**The layout rule:** instructions contain nothing but account validation, token transfers and event emission. All debt arithmetic lives in `state/accounting.rs`, and it is covered by unit tests that need no blockchain.

### Building and testing

Tooling: Anchor CLI 0.31.1, Solana (Agave) 4.2.2, Node 18+. On Windows, through WSL.

```bash
anchor build                                   # program + IDL + TS types
cargo test -p dala_capital --lib               # accounting unit tests
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts   # integration tests (after anchor build)
```

The integration tests need no validator: they load `target/deploy/dala_capital.so` into LiteSVM and drive the clock themselves.

### Invariants that must not break

1. **Money leaves the vault** only to the borrower and the treasury at `close_funding`, and to users at the ATA of their withdrawal address. There is no other path, rounding dust included.
2. **Money on a deposit address** goes only into its own campaign's vault or to the user's withdrawal address.
3. **Money on a repayment address** goes only into its own campaign's vault or to the treasury against recovery costs.
4. **The sum of all `pending` across positions ≤ the vault balance.** Guaranteed by rounding the accumulators down.
5. **A payout to a user** requires the operator's signature, `whitelist_status == true` and a destination equal to the ATA of the withdrawal address.
6. **State changes before the external transfer** (checks-effects-interactions). Solana's transaction atomicity rolls everything back if the transfer fails.
7. **All arithmetic is checked**, intermediate values are `u128`.

---

## 3. Roles

| Role | Where it is stored | Key | Rights |
|---|---|---|---|
| **admin** | `Platform.admin` | multisig | updating roles and the treasury, allowed tokens, creating and cancelling campaigns, uploading the schedule, changing the borrower's wallet before funding closes, changing a withdrawal address, recording recovery costs |
| **operator** | `Platform.operator` | hot key on the server | opening deposit addresses, crediting deposits, closing funding, all user withdrawals, processing an advance, processing payments in default, prepayment |
| **whitelist_authority** | `Platform.whitelist_authority` | ordinary key | creating user accounts, toggling the whitelist |
| **treasury** | `Platform.treasury` | multisig (owner of the token accounts) | signs no instruction of the program; only receives fees and cost reimbursement |
| **anyone** | — | any signer | `process_repayment` before default — only what is already due; `mark_default` |

Neither the operator nor the whitelist authority holds admin rights, and only the admin can replace their keys, through `update_platform`. There is no emergency mode in which withdrawals work without the operator.

---

## 4. Accounts and addresses

### 4.1. PDAs and ATAs

| Account | Seeds / derivation | Stores data | Created by |
|---|---|---|---|
| Platform | `["platform"]` | yes | `init_platform` |
| Deal | `["deal", platform, campaign_id: u64 LE]` | yes | `create_campaign` |
| UserAccount | `["user", platform, user_id: [u8;16]]` | yes | `create_user` |
| Position | `["pos", deal, user_id]` | yes | `invest` (first crediting) |
| deposit owner | `["deposit", deal, user_id]` | **no** | — (an ATA owner only) |
| repay owner | `["repay", deal]` | **no** | — (an ATA owner only) |
| Vault | ATA(owner = Deal PDA, campaign mint) | token account | `create_campaign` (`init_if_needed`) |
| Repayment address | ATA(repay owner, campaign mint) | token account | `create_campaign` (`init_if_needed`) |
| Deposit address | ATA(deposit owner, campaign mint) | token account | `open_deposit` (`init_if_needed`) |
| Treasury token account | ATA(treasury, mint) | token account | `allow_mint` |
| Borrower's account | ATA(borrower wallet, campaign mint) | token account | `close_funding` (`init_if_needed`) |
| Withdrawal destination | ATA(user's withdrawal address, campaign mint) | token account | any withdrawal instruction (`init_if_needed`) |

Every ATA of the program is created with `init_if_needed`. Their addresses are predictable, and an outsider can create the account in advance. Had the program insisted on creating it itself, an outsider could block the creation of a campaign or the opening of a deposit address. The owner of a pre-created ATA is still the PDA it has to be: the address is derived from the owner, and without the PDA's signature nobody can change the owner, appoint a delegate or close the account. Anchor additionally checks the owner and the mint. Tokens sent in advance stay in the vault as dust (the accounting works off balance differences), and on the repayment address they count as a payment.

`user_id` is 16 random bytes (UUID v4) from the backend's database. It is neither a sequence number nor derived from personal data: seeds are public.

For topping up, the user is shown **the ATA of the deposit address**, or the `deposit owner` — exchanges send to the owner's address and derive the ATA themselves. The ATA has to exist beforehand, created by `open_deposit`.

### 4.2. Platform

| Field | Type | Meaning |
|---|---|---|
| `admin`, `operator`, `whitelist_authority`, `treasury` | `Pubkey` | roles |
| `allowed_mints` | `Vec<Pubkey>`, up to 8 | allowed tokens |
| `campaign_count` | `u64` | number of campaigns created |
| `bump` | `u8` | |

### 4.3. UserAccount

| Field | Type | Meaning |
|---|---|---|
| `platform` | `Pubkey` | |
| `user_id` | `[u8; 16]` | |
| `entity_type` | `EntityType` | `Individual` / `Legal`. Stored for the backend; the logic does not use it |
| `withdrawal_address` | `Pubkey` | the only payout destination — an owner, not a token account |
| `whitelist_status` | `bool` | `false` blocks every withdrawal by the user |
| `withdrawal_address_changed_at` | `i64` | when the address was last changed, 0 for a new account |
| `bump` | `u8` | |

### 4.4. Position

| Field | Type | Meaning |
|---|---|---|
| `deal`, `user_id` | | whose share, and in which campaign |
| `principal` | `u64` | the sum of contributions. Fixed once funding closes; zeroed when a contribution is refunded |
| `checkpoint_principal / _interest / _penalty / _prepayment_fee` | `u128` | the campaign's accumulators as of the last withdrawal |
| `bump` | `u8` | |

### 4.5. Deal

**Parameters** (set at creation, never changed):

| Field | Meaning |
|---|---|
| `mint`, `vault`, `repay_account` | the campaign's token, the vault, the repayment ATA |
| `borrower_wallet` | the borrower's wallet — an owner, not a token account. A deposit address at an exchange, for instance |
| `soft_cap`, `hard_cap`, `min_ticket`, `max_ticket` | funding limits; `max_ticket = 0` means no cap |
| `funding_start`, `funding_deadline` | the funding window. **The deadline is the start of the first interest period** |
| `schedule_type` | `Annuity` / `Coupon` |
| `annual_rate_bps`, `periods_per_year` | annual rate; periods per year: 12, 4, 2, 1 |
| `penalty_rate_bps` | annual penalty rate |
| `default_threshold_days` | the default threshold, in days |
| `prepayment_fee_bps` | prepayment fee (annuity only) |
| `platform_fee_bps` | the platform's fee on the amount raised |
| `cancel_grace_days` | how many days after the deadline the admin may cancel a campaign that was never closed |
| `periods: Vec<Period>` | the schedule, up to 60 payments |
| `schedule_finalized` | the schedule is fixed |

**Period:**

| Field | When it is filled in |
|---|---|
| `due_ts` | when the schedule is uploaded |
| `principal_fraction` | when the schedule is uploaded, scaled by `SCALE` |
| `principal_amount`, `interest_amount` | at `close_funding`; recomputed on a partial prepayment |
| `principal_paid`, `interest_paid` | as incoming money is allocated |

**Accounting state:**

| Field | Meaning |
|---|---|
| `state` | `Funding`, `Failed`, `Active`, `Default`, `Repaid` |
| `total_raised` | the amount raised; the denominator of the distribution |
| `next_period` | the first period whose date has not arrived yet |
| `overdue_principal`, `overdue_scheduled_interest` | unpaid principal and interest of matured payments (before default) |
| `extra_interest` | interest at the loan rate, accrued on overdue principal (before default) |
| `penalty` | accrued and unpaid penalty interest |
| `default_principal`, `default_interest` | the debt after default |
| `interest_carry`, `penalty_carry`, `last_accrual_ts` | accrual bookkeeping |
| `recovery_costs`, `recovery_reimbursed` | recovery costs and how much of them has been reimbursed |
| `acc_principal / _interest / _penalty / _prepayment_fee` | distribution accumulators, scaled by `SCALE` |
| `carry_*` | the remainders of the accumulators' division |

---

## 5. The life of a campaign

```
                  create_campaign
                        │
                        ▼
   add_schedule_periods ×N → finalize_schedule
                        │
                        ▼
                    Funding ──── cancel_campaign (before the deadline or after the grace period) ────▶ Failed
                        │                                              ▲
             close_funding (after the deadline)                        │
                        ├── schedule not finalized or < soft_cap ──────┘
                        ▼
                     Active ──── mark_default (arrears ≥ threshold) ──▶ Default
                        │                                                │
      all payments / prepay_full                                 full recovery
                        ▼                                                ▼
                     Repaid ◀─────────────────────────────────────────────┘
```

| State | What is available |
|---|---|
| `Funding` | uploading the schedule, opening deposit addresses, `invest`, `cancel_campaign`, `close_funding` after the deadline, `withdraw_deposit` |
| `Failed` | `withdraw_refund`, `withdraw_deposit` |
| `Active` | `process_repayment` (anyone — what is due; the operator — an advance as well), `mark_default`, `prepay_full` / `prepay_partial` (annuity), `withdraw_payout`, `withdraw_deposit` |
| `Default` | `process_repayment` (operator only), `record_recovery_cost`, `withdraw_payout`, `withdraw_deposit`. **Terminal** — the only way out is `Repaid` |
| `Repaid` | `withdraw_payout`, `withdraw_deposit`. An excess on the repayment address is not processed |

"Arrears" is not a separate state but a condition computed inside `Active`: `days_past_due > 0`.

---

## 6. The accounting model

All of the logic is in `state/accounting.rs`. Amounts are in the token's smallest units, and division always rounds down.

### 6.1. The schedule

- The first interest period starts at `funding_deadline`, whenever `close_funding` happens to be called.
- Payment dates and principal fractions (`principal_fraction`, scaled by `SCALE = 10¹²`) are computed by the backend from the loan agreement: for an annuity, the fractions that make the payments equal; for a coupon, all of the principal in the last payment. The program checks only the structure: dates increase, the fractions sum to `SCALE`.
- At `close_funding`:
  - `principal_amount[k] = floor(total_raised × fraction[k] / SCALE)`, with the last payment taking up the difference;
  - `interest_amount[k] = floor(principal_outstanding_at_start × annual_rate_bps / (10 000 × periods_per_year))`.

### 6.2. Accrual (`accrue`)

Runs at the start of every instruction that changes the debt. It walks the dates from `last_accrual_ts` to `now`:

1. A payment date that has arrived: the period's unpaid principal and interest move into `overdue_principal` and `overdue_scheduled_interest`.
2. Between dates, by actual elapsed time on a 360-day basis:
   - on overdue principal — interest at the loan rate → `extra_interest`;
   - on overdue principal and overdue interest — penalty interest at `penalty_rate_bps` → `penalty`;
   - nothing accrues on the penalty itself.

**Interest on overdue principal and penalty interest are different items.**

| | Interest on overdue principal | Penalty |
|---|---|---|
| Meaning | the price of using money that was not returned | a sanction for missing the date |
| Rate | `annual_rate_bps` | `penalty_rate_bps` |
| Base | overdue principal | overdue principal + overdue interest |
| Item on the investor's side | interest | penalty |

Scheduled interest is computed as if everything had been paid on time, so without separate interest the borrower would be using the unreturned principal for free. The split also matters legally — a court may reduce a penalty but not the interest for the use of money — and for tax accounting.

The formula: `amount × rate_bps × seconds / (10 000 × 360 × 86 400)`, with the remainder of the division carried forward.

**In `Default`** scheduled payments no longer mature: interest at the loan rate and penalty interest accrue on `default_principal`, and penalty interest on `default_interest`.

### 6.3. Allocating an incoming payment

**Before default** (`allocate_active`):

1. interest of matured payments, oldest first;
2. `extra_interest`;
3. principal of matured payments, oldest first;
4. penalty;
5. **an advance** — the next payments in order, interest then principal within each. The schedule does not change.

Steps 1–4 are what is already due (`due_obligations`), and anyone may process them. Step 5 is for the operator only: a call by an outsider takes no more than what is due off the repayment address. That way money sent for a prepayment cannot be turned into an advance by someone calling ahead of the operator.

**In default:** recovery costs (→ treasury, bypassing the vault) → interest → principal → penalty.

Every part is distributed to investors immediately — the money is available to withdraw when it arrives, not on the payment date.

### 6.4. Days past due and default

- Days past due are counted from the date of the **oldest** matured payment that is not fully paid.
- `mark_default` is allowed once days past due ≥ `default_threshold_days`. The whole unpaid principal becomes `default_principal`, unpaid interest becomes `default_interest`, and the scheduled interest of periods that have not matured is no longer owed.

### 6.5. Prepayment (annuity only)

**Full** — on any day:
```
overdue interest + overdue principal + penalty
+ interest of the current period for the actual seconds on the outstanding principal (less any interest advance)
+ the outstanding principal (less any principal advance)
+ floor(outstanding principal × prepayment_fee_bps / 10 000)
```

**Partial** — only within 24 hours of the date of the last matured payment, and only with no advance outstanding. It is done in a single transfer: what is already due is settled first off the repayment address (today's payment, arrears, penalty), and then the principal is prepaid. The principal of the remaining payments is reduced pro rata, interest is recomputed from the new outstanding, and the dates stay where they were. The fee is charged on the amount prepaid.

Both operations require exactly the right amount to have arrived on the repayment address (`received == total`).

### 6.6. Distribution among investors

Four accumulators per campaign: principal, interest, penalty, prepayment fee. The denominator is `total_raised`.

```
when distributing an amount a:   acc += (a × SCALE + carry) / total_raised,   carry = the remainder
available to a position:         pending = floor(principal × (acc − checkpoint) / SCALE)
```

The cost of a distribution does not depend on the number of investors. Rounding down guarantees `Σ pending ≤ what came in`.

---

## 7. Instruction reference

In every instruction that emits events, the last two accounts are `event_authority` (the PDA `["__event_authority"]`) and `program` — required by `#[event_cpi]`; the Anchor client supplies them itself in `.accounts()`.

Notation in the accounts column: **s** — signer, **w** — mutable, **init** — created by the instruction.

### 7.1. Summary

| Instruction | Called by | In short |
|---|---|---|
| `init_platform` | anyone (once) | create the platform and its roles |
| `update_platform` | admin | change admin / operator / whitelist authority / treasury |
| `allow_mint` | admin | allow a token, create the treasury's token account |
| `remove_mint` | admin | disallow a token for new campaigns |
| `create_user` | whitelist authority | create a user after KYC |
| `set_withdrawal_address` | admin | change the withdrawal address; the whitelist is switched off |
| `set_whitelist_status` | whitelist authority | enable / disable withdrawals |
| `create_campaign` | admin | create a campaign, its vault and its repayment address |
| `add_schedule_periods` | admin | append payments to the schedule |
| `finalize_schedule` | admin | fix the schedule |
| `set_borrower_wallet` | admin | change the borrower's wallet while the campaign is funding |
| `cancel_campaign` | admin | cancel funding before the deadline or after the grace period |
| `open_deposit` | operator | create a user's deposit address |
| `invest` | operator | credit a deposit into the campaign |
| `close_funding` | operator | close funding after the deadline |
| `process_repayment` | anyone — what is due; operator — an advance, and in default | process money on the repayment address |
| `mark_default` | anyone | move the loan into default on the arrears threshold |
| `record_recovery_cost` | admin | record recovery costs |
| `prepay_full` | operator | full prepayment |
| `prepay_partial` | operator | partial prepayment |
| `withdraw_payout` | operator | withdraw loan payouts |
| `withdraw_refund` | operator | refund a contribution after failed funding |
| `withdraw_deposit` | operator | withdraw what was not credited from a deposit address |

### 7.2. Platform

#### `init_platform`

| | |
|---|---|
| **Purpose** | Creates the platform singleton. Called once per deployment |
| **Called by** | anyone willing to pay for the account. `admin` is an argument — you can deploy with a hot key and set a multisig as admin straight away |
| **Arguments** | `admin: Pubkey`, `operator: Pubkey`, `whitelist_authority: Pubkey`, `treasury: Pubkey` |
| **Accounts** | `payer` s,w · `platform` w,init · `system_program` |
| **Conditions** | no key is `Pubkey::default()`; the platform does not exist yet |
| **Result** | a Platform with its roles and an empty token list |
| **Event** | `PlatformInitialized` |
| **Errors** | `InvalidPubkey` |

#### `update_platform`

| | |
|---|---|
| **Purpose** | Changes roles and the treasury. `None` leaves a field as it is |
| **Called by** | admin |
| **Arguments** | `new_admin`, `new_operator`, `new_whitelist_authority`, `new_treasury`: `Option<Pubkey>` |
| **Accounts** | `admin` s · `platform` w |
| **Conditions** | the new keys are not `Pubkey::default()` |
| **Result** | the roles are updated. After changing the treasury, call `allow_mint` for every token to create its token accounts |
| **Event** | `PlatformUpdated` |
| **Errors** | `Unauthorized`, `InvalidPubkey` |

#### `allow_mint`

| | |
|---|---|
| **Purpose** | Allows a token for campaigns and creates the treasury's token account for it. Idempotent |
| **Called by** | admin |
| **Arguments** | — |
| **Accounts** | `admin` s,w · `platform` w · `mint` · `treasury` (= `platform.treasury`) · `treasury_token` w,init_if_needed (the treasury's ATA) · `token_program` · `associated_token_program` · `system_program` |
| **Conditions** | fewer than 8 tokens on the list (if the token is new) |
| **Result** | the token is in `allowed_mints`, the treasury's ATA exists |
| **Event** | `MintAllowed` |
| **Errors** | `Unauthorized`, `InvalidPubkey`, `TooManyMints` |

#### `remove_mint`

| | |
|---|---|
| **Purpose** | Removes a token from the allowed list. Existing campaigns are untouched |
| **Called by** | admin |
| **Arguments** | `mint: Pubkey` |
| **Accounts** | `admin` s · `platform` w |
| **Event** | `MintRemoved` |
| **Errors** | `Unauthorized` |

### 7.3. Users

#### `create_user`

| | |
|---|---|
| **Purpose** | Creates a user account after KYC on the backend |
| **Called by** | whitelist authority (pays the rent) |
| **Arguments** | `user_id: [u8; 16]`, `entity_type: EntityType`, `withdrawal_address: Pubkey`, `whitelist_status: bool` |
| **Accounts** | `whitelist_authority` s,w · `platform` · `user` w,init · `system_program` |
| **Conditions** | `withdrawal_address` is not `Pubkey::default()`; `user_id` is not taken |
| **Result** | a UserAccount; `withdrawal_address_changed_at = 0`, so the whitelist may be set to `true` immediately |
| **Event** | `UserCreated` |
| **Errors** | `Unauthorized`, `InvalidPubkey` |

#### `set_withdrawal_address`

| | |
|---|---|
| **Purpose** | Changes a user's withdrawal address |
| **Called by** | admin |
| **Arguments** | `user_id: [u8; 16]`, `withdrawal_address: Pubkey` |
| **Accounts** | `admin` s · `platform` · `user` w |
| **Result** | the new address, `whitelist_status = false`, `withdrawal_address_changed_at = now`. Withdrawals can be re-enabled after 48 hours |
| **Events** | `WithdrawalAddressChanged`, `WhitelistChanged` |
| **Errors** | `Unauthorized`, `InvalidPubkey` |

#### `set_whitelist_status`

| | |
|---|---|
| **Purpose** | Enables or disables a user's withdrawals |
| **Called by** | whitelist authority |
| **Arguments** | `user_id: [u8; 16]`, `whitelist_status: bool` |
| **Accounts** | `whitelist_authority` s · `platform` · `user` w |
| **Conditions** | `false` — always; `true` — if the address has never changed, or ≥ 48 hours have passed since `withdrawal_address_changed_at` |
| **Event** | `WhitelistChanged` |
| **Errors** | `Unauthorized`, `AddressChangeDelayNotPassed` |

### 7.4. Campaign

#### `create_campaign`

| | |
|---|---|
| **Purpose** | Creates a campaign without a schedule, together with its vault and repayment address |
| **Called by** | admin (pays the rent) |
| **Arguments** | `campaign_id: u64`, `params: CampaignParams` (table below) |
| **Accounts** | `admin` s,w · `platform` w · `deal` w,init · `mint` · `borrower_wallet` (the borrower's wallet, which need not exist yet) · `repay_owner` (PDA) · `vault` w,init_if_needed (the campaign's ATA) · `repay_token` w,init_if_needed (the repayment ATA) · `token_program` · `associated_token_program` · `system_program` |
| **Conditions** | the token is allowed; the borrower's wallet is neither the zero key nor a token account; `0 < soft_cap ≤ hard_cap`; `0 < min_ticket ≤ soft_cap`; `max_ticket == 0` or `≥ min_ticket`; `funding_start < funding_deadline`; `periods_per_year ∈ {1,2,4,12}`; `annual_rate_bps > 0`; `default_threshold_days > 0`; `platform_fee_bps < 10 000`; `prepayment_fee_bps < 10 000`; `cancel_grace_days > 0`; for a coupon, `prepayment_fee_bps == 0` |
| **Result** | a Deal in `Funding`, `schedule_finalized = false`; `campaign_count += 1` |
| **Event** | `CampaignCreated` |
| **Errors** | `Unauthorized`, `MintNotAllowed`, `InvalidBorrowerWallet`, `InvalidCampaignParams` |

**CampaignParams**

| Field | Type | Meaning |
|---|---|---|
| `soft_cap`, `hard_cap` | `u64` | the minimum for success and the maximum to raise |
| `min_ticket` | `u64` | a user's minimum first investment |
| `max_ticket` | `u64` | the maximum position, 0 means no cap |
| `funding_start`, `funding_deadline` | `i64` | the funding window; the deadline is the start of the first interest period |
| `schedule_type` | `ScheduleType` | `Annuity` / `Coupon` |
| `annual_rate_bps` | `u32` | annual rate |
| `periods_per_year` | `u8` | 12, 4, 2, 1 |
| `penalty_rate_bps` | `u32` | annual penalty rate |
| `default_threshold_days` | `u16` | the default threshold; the client defaults to 90 for an annuity, 30 for a coupon |
| `prepayment_fee_bps` | `u32` | the prepayment fee (annuity) |
| `platform_fee_bps` | `u32` | the platform's fee on the amount raised |
| `cancel_grace_days` | `u16` | how many days after the deadline the admin may cancel a campaign that was never closed; the client defaults to 7 |

#### `add_schedule_periods`

| | |
|---|---|
| **Purpose** | Appends payments to the end of the schedule. A whole schedule does not fit into one transaction — upload it in chunks of about 20 |
| **Called by** | admin |
| **Arguments** | `campaign_id: u64`, `periods: Vec<PeriodInput { due_ts: i64, principal_fraction: u64 }>` |
| **Accounts** | `admin` s · `platform` · `deal` w |
| **Conditions** | `Funding`; the schedule is not fixed; `periods` is not empty; at most 60 in total; dates strictly increasing, the first one later than `funding_deadline` |
| **Event** | `SchedulePeriodsAdded` |
| **Errors** | `Unauthorized`, `InvalidDealState`, `ScheduleFinalized`, `InvalidSchedule`, `TooManyPeriods` |

#### `finalize_schedule`

| | |
|---|---|
| **Purpose** | Fixes the schedule. Without it `invest` is unavailable, and `close_funding` moves the campaign to `Failed` |
| **Called by** | admin |
| **Arguments** | `campaign_id: u64` |
| **Accounts** | `admin` s · `platform` · `deal` w |
| **Conditions** | `Funding`; not fixed yet; 1–60 payments; the fractions sum to `SCALE`; for a coupon every fraction is 0 except the last |
| **Event** | `ScheduleFinalized` |
| **Errors** | `Unauthorized`, `InvalidDealState`, `ScheduleFinalized`, `InvalidSchedule` |

#### `cancel_campaign`

| | |
|---|---|
| **Purpose** | Cancels funding |
| **Called by** | admin |
| **Arguments** | `campaign_id: u64` |
| **Accounts** | `admin` s · `platform` · `deal` w |
| **Conditions** | `Funding`; `now < funding_deadline` **or** `now ≥ funding_deadline + cancel_grace_days`. The second window is an insurance policy for the case where funding could never be closed: the borrower's account frozen by the stablecoin issuer, or the treasury's account closed. Normally `close_funding` is called right after the deadline and the campaign leaves `Funding` before that window opens |
| **Result** | `Failed`; investors take their contributions back through `withdraw_refund` |
| **Event** | `CampaignCancelled` |
| **Errors** | `Unauthorized`, `InvalidDealState`, `CancelGracePeriodActive` |

#### `set_borrower_wallet`

| | |
|---|---|
| **Purpose** | Changes the borrower's wallet: the borrower lost access to it, or the exchange changed the deposit address |
| **Called by** | admin |
| **Arguments** | `campaign_id: u64` |
| **Accounts** | `admin` s · `platform` · `deal` w · `borrower_wallet` (the new wallet) |
| **Conditions** | `Funding` — including after the deadline, before funding is closed; the new wallet is neither the zero key nor a token account |
| **Result** | `deal.borrower_wallet` is the new wallet; `close_funding` will send the money to its ATA |
| **Event** | `BorrowerWalletChanged` (the old and the new address) |
| **Errors** | `Unauthorized`, `InvalidDealState`, `InvalidBorrowerWallet` |

This is a trusted action: the admin multisig can redirect the loan amount. Every change is visible in the events.

### 7.5. Funding

#### `open_deposit`

| | |
|---|---|
| **Purpose** | Creates the ATA of a user's deposit address for a campaign. Idempotent |
| **Called by** | operator (pays the rent) |
| **Arguments** | `campaign_id: u64`, `user_id: [u8; 16]` |
| **Accounts** | `operator` s,w · `platform` · `deal` · `user` · `deposit_owner` (PDA) · `mint` · `deposit_token` w,init_if_needed · `token_program` · `associated_token_program` · `system_program` |
| **Conditions** | `Funding`; the user exists |
| **Event** | `DepositOpened` |
| **Errors** | `Unauthorized`, `InvalidDealState`, `WrongMint` |

#### `invest`

| | |
|---|---|
| **Purpose** | Moves what arrived on a deposit address into the vault and credits it to the position. Called for every incoming transfer, once the backend has checked the sender |
| **Called by** | operator |
| **Arguments** | `campaign_id: u64`, `user_id: [u8; 16]` |
| **Accounts** | `operator` s,w · `platform` · `deal` w · `user` · `position` w,init_if_needed · `deposit_owner` · `deposit_token` w · `vault` w · `mint` · `token_program` · `system_program` |
| **Conditions** | `Funding`; the schedule is fixed; `funding_start ≤ now < funding_deadline`; the deposit address has a balance > 0; if the position is empty, the balance is ≥ `min_ticket` |
| **Result** | `min(balance, hard_cap − total_raised, max_ticket − principal)` is credited; the rest stays on the deposit address |
| **Event** | `Invested` |
| **Errors** | `Unauthorized`, `InvalidDealState`, `ScheduleNotFinalized`, `FundingNotStarted`, `FundingClosed`, `NothingToProcess`, `BelowMinTicket`, `NoCapacity`, `NothingReceived` |

#### `close_funding`

| | |
|---|---|
| **Purpose** | Closes funding |
| **Called by** | the operator only — after the backend has confirmed with the borrower that the wallet is current. Otherwise an outsider could send the loan amount to an address the borrower has lost access to. Pays for the borrower's ATA if it does not exist |
| **Arguments** | `campaign_id: u64` |
| **Accounts** | `operator` s,w · `platform` · `deal` w · `vault` w · `mint` · `borrower_wallet` (= `deal.borrower_wallet`) · `payout_destination` w,init_if_needed (the borrower's ATA) · `treasury_token` w (owner = the treasury, the campaign's mint) · `token_program` · `associated_token_program` · `system_program` |
| **Conditions** | `Funding` and `now ≥ funding_deadline` |
| **Result** | the borrower's ATA is created if missing — the exchange may have closed an empty deposit account. If the schedule is not fixed or `total_raised < soft_cap` → `Failed`. Otherwise: `floor(total_raised × platform_fee_bps / 10 000)` → the treasury, the rest → the borrower; the schedule's amounts are computed; `Active`, with accrual starting at `funding_deadline`. Exactly `total_raised` is transferred, anything above it stays in the vault. If the transfer is impossible (the borrower's account is frozen) the transaction fails and the campaign stays in `Funding` — it can be cancelled after the grace period |
| **Events** | `FundingClosed` or `FundingFailed` |
| **Errors** | `InvalidDealState`, `FundingStillOpen`, `Unauthorized`, `WrongMint` |

### 7.6. Repayment and default

#### `process_repayment`

| | |
|---|---|
| **Purpose** | Processes the money sitting on the repayment address |
| **Called by** | in `Active` — anyone, but only for what is already due (arrears and penalty); an advance against future payments is for the operator only. In `Default` — the operator only, so that recovery costs can be recorded before anything is distributed |
| **Arguments** | `campaign_id: u64` |
| **Accounts** | `caller` s · `platform` · `deal` w · `repay_owner` · `repay_token` w · `vault` w · `treasury_token` w · `mint` · `token_program` |
| **Conditions** | `Active` or `Default`; there is money on the repayment address; for an outsider's call in `Active`, something must be due |
| **Result** | accrual up to `now`. The operator takes no more than all remaining obligations, an outsider no more than what is due; the rest stays on the repayment address. Allocation is in section 6.3. On full repayment → `Repaid` |
| **Event** | `RepaymentProcessed` (broken down: costs, interest, principal, penalty, advance, and the `repaid` flag) |
| **Errors** | `InvalidDealState`, `Unauthorized`, `NothingToProcess`, `NothingReceived` |

#### `mark_default`

| | |
|---|---|
| **Purpose** | Moves the loan into default |
| **Called by** | any signer |
| **Arguments** | `campaign_id: u64` |
| **Accounts** | `caller` s · `platform` · `deal` w |
| **Conditions** | `Active`; after accrual, days past due ≥ `default_threshold_days` |
| **Result** | `Default`; the whole outstanding principal becomes overdue; scheduled payments stop |
| **Event** | `DefaultMarked` |
| **Errors** | `InvalidDealState`, `DefaultThresholdNotReached` |

#### `record_recovery_cost`

| | |
|---|---|
| **Purpose** | Records recovery costs the platform has actually paid |
| **Called by** | admin |
| **Arguments** | `campaign_id: u64`, `amount: u64` |
| **Accounts** | `admin` s · `platform` · `deal` w |
| **Conditions** | `Default`; `amount > 0`. There is no cap on the amount |
| **Result** | `recovery_costs += amount`; reimbursed first out of the next incoming money |
| **Event** | `RecoveryCostRecorded` |
| **Errors** | `Unauthorized`, `InvalidDealState`, `InvalidAmount` |

### 7.7. Prepayment

The accounts of both instructions: `operator` s · `platform` · `deal` w · `repay_owner` · `repay_token` w · `vault` w · `mint` · `token_program`.

#### `prepay_full`

| | |
|---|---|
| **Purpose** | Full prepayment at the borrower's request |
| **Called by** | operator |
| **Arguments** | `campaign_id: u64` |
| **Conditions** | `Active`; an annuity; the repayment address holds at least the amount payable (section 6.5); exactly that amount arrives |
| **Result** | `Repaid`; principal → the principal accumulator, interest → interest, the fee → the prepayment-fee accumulator |
| **Event** | `EarlyRepayment { full: true }` |
| **Errors** | `Unauthorized`, `InvalidDealState`, `PrepaymentNotAllowed`, `NothingToProcess`, `InsufficientRepayBalance`, `InsufficientReceived` |

#### `prepay_partial`

| | |
|---|---|
| **Purpose** | Partial prepayment of principal, in one transfer together with today's payment |
| **Called by** | operator |
| **Arguments** | `campaign_id: u64`, `principal_amount: u64` |
| **Conditions** | `Active`; an annuity; `now` is within 24 hours of the date of the last matured payment and payments remain ahead; no advance outstanding; `0 < principal_amount < outstanding principal`; the repayment address holds at least what is due + `principal_amount` + the fee |
| **Result** | what is due is settled first (today's payment, arrears, penalty), then the prepaid part: the principal of the remaining payments is reduced pro rata, interest is recomputed, the dates stay |
| **Event** | `EarlyRepayment { full: false }` |
| **Errors** | `Unauthorized`, `InvalidDealState`, `PrepaymentNotAllowed`, `NotPaymentDate`, `HasAdvance`, `InvalidPrepaymentAmount`, `InsufficientRepayBalance`, `InsufficientReceived` |

### 7.8. Withdrawals

The common rules: only the operator signs, and only when the user presses the button; the destination is only the ATA of the user's withdrawal address (created at the operator's expense if missing); `whitelist_status = true` is required; the whole available amount is withdrawn; state changes before the transfer.

The accounts of `withdraw_payout` and `withdraw_refund`: `operator` s,w · `platform` · `deal` · `user` · `position` w · `withdrawal_owner` (= `user.withdrawal_address`) · `destination` w,init_if_needed · `vault` w · `mint` · `token_program` · `associated_token_program` · `system_program`.

#### `withdraw_payout`

| | |
|---|---|
| **Purpose** | Withdraws everything distributed to the user on the loan |
| **Called by** | operator |
| **Arguments** | `campaign_id: u64`, `user_id: [u8; 16]` |
| **Conditions** | the whitelist is on; `Active`, `Default` or `Repaid`; the available amount is > 0 |
| **Result** | the total of the four items → the withdrawal address; the position's checkpoints are set to the campaign's accumulators |
| **Event** | `PayoutWithdrawn` (principal, interest, penalty, prepayment fee, total) |
| **Errors** | `Unauthorized`, `WhitelistDisabled`, `InvalidDealState`, `NothingToWithdraw`, `InvalidPubkey` |

#### `withdraw_refund`

| | |
|---|---|
| **Purpose** | Returns a contribution after a campaign fails |
| **Called by** | operator |
| **Arguments** | `campaign_id: u64`, `user_id: [u8; 16]` |
| **Conditions** | the whitelist is on; `Failed`; `position.principal > 0` |
| **Result** | `principal` → the withdrawal address, `principal = 0` |
| **Event** | `RefundWithdrawn` |
| **Errors** | `Unauthorized`, `WhitelistDisabled`, `InvalidDealState`, `NothingToWithdraw`, `InvalidPubkey` |

#### `withdraw_deposit`

| | |
|---|---|
| **Purpose** | Withdraws everything sitting on a deposit address that was not credited to the campaign |
| **Called by** | operator |
| **Arguments** | `campaign_id: u64`, `user_id: [u8; 16]` |
| **Accounts** | `operator` s,w · `platform` · `deal` · `user` · `deposit_owner` · `deposit_token` w · `withdrawal_owner` · `destination` w,init_if_needed · `mint` · `token_program` · `associated_token_program` · `system_program` |
| **Conditions** | the whitelist is on; the deposit address has a balance > 0; any campaign state |
| **Result** | the whole balance → the withdrawal address. If funding is over and the deposit ATA is empty, it is closed and the rent goes back to the operator |
| **Event** | `DepositWithdrawn` (with the `closed` flag) |
| **Errors** | `Unauthorized`, `WhitelistDisabled`, `NothingToWithdraw`, `InvalidPubkey` |

---

## 8. Events

Emitted through `emit_cpi!`: the instruction passes the event's data to `event_authority`, and it shows up among the transaction's inner instructions. For the backend's indexer, parsing the program's inner instructions is enough.

| Event | When | Fields |
|---|---|---|
| `PlatformInitialized` | `init_platform` | `admin`, `operator`, `whitelist_authority`, `treasury` |
| `PlatformUpdated` | `update_platform` | the same, after the change |
| `MintAllowed` / `MintRemoved` | `allow_mint` / `remove_mint` | `mint` |
| `UserCreated` | `create_user` | `user_id`, `entity_type`, `withdrawal_address`, `whitelist_status` |
| `WithdrawalAddressChanged` | `set_withdrawal_address` | `user_id`, `withdrawal_address` |
| `WhitelistChanged` | `set_withdrawal_address`, `set_whitelist_status` | `user_id`, `whitelist_status` |
| `CampaignCreated` | `create_campaign` | `campaign_id`, `mint`, `payout_destination`, `soft_cap`, `hard_cap`, `funding_start`, `funding_deadline`, `schedule_type`, `annual_rate_bps` |
| `BorrowerWalletChanged` | `set_borrower_wallet` | `campaign_id`, `old_wallet`, `new_wallet` |
| `SchedulePeriodsAdded` | `add_schedule_periods` | `campaign_id`, `total_periods` |
| `ScheduleFinalized` | `finalize_schedule` | `campaign_id`, `period_count` |
| `CampaignCancelled` | `cancel_campaign` | `campaign_id`, `total_raised` |
| `DepositOpened` | `open_deposit` | `campaign_id`, `user_id`, `deposit_token` |
| `Invested` | `invest` | `campaign_id`, `user_id`, `amount`, `position_principal`, `total_raised` |
| `FundingClosed` | `close_funding`, success | `campaign_id`, `total_raised`, `platform_fee`, `payout_amount` |
| `FundingFailed` | `close_funding`, failure | `campaign_id`, `total_raised` |
| `RepaymentProcessed` | `process_repayment` | `campaign_id`, `received`, `recovery`, `interest`, `principal`, `penalty`, `advance`, `repaid` |
| `DefaultMarked` | `mark_default` | `campaign_id`, `days_past_due`, `principal`, `interest`, `penalty` |
| `RecoveryCostRecorded` | `record_recovery_cost` | `campaign_id`, `amount`, `total_costs` |
| `EarlyRepayment` | `prepay_full`, `prepay_partial` | `campaign_id`, `full`, `principal`, `interest`, `penalty`, `prepayment_fee`, `total` |
| `PayoutWithdrawn` | `withdraw_payout` | `campaign_id`, `user_id`, `principal`, `interest`, `penalty`, `prepayment_fee`, `amount` |
| `RefundWithdrawn` | `withdraw_refund` | `campaign_id`, `user_id`, `amount` |
| `DepositWithdrawn` | `withdraw_deposit` | `campaign_id`, `user_id`, `amount`, `closed` |

In `RepaymentProcessed`: `received = recovery + interest + principal + penalty`. The `advance` field is not a separate item but the part of `interest + principal` that went against future payments. In `EarlyRepayment` and `PayoutWithdrawn` the items add up to `total` and `amount` respectively. Every amount in an event matches the actual transfers to the unit (checked in `tests/random.ts`).

There is no separate event for a payment falling due: that happens inside accrual. Read the current state of the debt from the `Deal` account.

---

## 9. Errors

The code is 6000 + the ordinal in `DalaError`.

| Code | Name | When |
|---|---|---|
| 6000 | `InvalidPubkey` | a zero key; an account does not match the expected address (vault, withdrawal address, repayment ATA) |
| 6001 | `Unauthorized` | the signer does not hold the role; the wrong owner of the treasury's token account |
| 6002 | `MintNotAllowed` | the token is not in `allowed_mints` |
| 6003 | `TooManyMints` | more than 8 allowed tokens |
| 6004 | `WrongMint` | the account's mint does not match the campaign's |
| 6005 | `InvalidCampaignParams` | the `create_campaign` parameters failed validation |
| 6006 | `InvalidSchedule` | dates not increasing, the first one not later than the deadline, fractions not summing to `SCALE`, a coupon with principal outside the last payment |
| 6007 | `ScheduleFinalized` | the schedule is already fixed |
| 6008 | `ScheduleNotFinalized` | `invest` before the schedule was fixed |
| 6009 | `TooManyPeriods` | more than 60 payments |
| 6010 | `InvalidDealState` | the instruction is unavailable in the campaign's current state |
| 6011 | `FundingNotStarted` | `invest` before `funding_start` |
| 6012 | `FundingClosed` | `invest` or `cancel_campaign` after the deadline |
| 6013 | `FundingStillOpen` | `close_funding` before the deadline |
| 6014 | `BelowMinTicket` | a first investment below `min_ticket` |
| 6015 | `NoCapacity` | `hard_cap` or `max_ticket` reached |
| 6016 | `NothingReceived` | the transfer did not change the recipient's balance |
| 6017 | `InsufficientReceived` | prepayment: less than the required amount arrived |
| 6018 | `NothingToWithdraw` | there is nothing to withdraw |
| 6019 | `NothingToProcess` | there is nothing to credit or process |
| 6020 | `InsufficientRepayBalance` | the repayment address does not hold enough for the prepayment |
| 6021 | `WhitelistDisabled` | a withdrawal with `whitelist_status = false` |
| 6022 | `AddressChangeDelayNotPassed` | enabling the whitelist less than 48 hours after an address change |
| 6023 | `DefaultThresholdNotReached` | the arrears are below the threshold |
| 6024 | `PrepaymentNotAllowed` | prepayment on a coupon |
| 6025 | `NotPaymentDate` | partial prepayment away from a payment date, or with no future payments |
| 6026 | `HasOverdue` | an internal check of the partial prepayment; it cannot be reached through `prepay_partial` — arrears and penalty are settled in the same operation |
| 6027 | `HasAdvance` | partial prepayment with an advance outstanding |
| 6028 | `InvalidPrepaymentAmount` | a partial prepayment amount outside `(0, outstanding principal)` |
| 6029 | `InvalidAmount` | a zero recovery-cost amount |
| 6030 | `MathOverflow` | an overflow or a division by zero |
| 6031 | `InvalidBorrowerWallet` | the borrower's wallet is the zero key or a token account |
| 6032 | `CancelGracePeriodActive` | cancelling after the deadline but before the grace period is over |

---

## 10. Scenarios for the backend

### Starting the platform
1. `init_platform` — admin, operator, whitelist authority, treasury.
2. `allow_mint` for USDC and USDT.

### A new user
1. KYC on the backend, generate a `user_id` (UUID v4).
2. `create_user` with the withdrawal address and `whitelist_status = true`.

### A campaign
1. `create_campaign` with the parameters from the loan agreement. The borrower's wallet is their own wallet address, or a USDC/USDT deposit address on Solana at an exchange — **not** a token account address. Exchanges that require a memo will not do: a transfer from the contract carries none.
2. The backend computes the dates and principal fractions; `add_schedule_periods` in chunks of about 20.
3. `finalize_schedule`.

### Investing
1. The user picks a campaign → `open_deposit` → show the deposit address.
2. The backend watches the deposit ATA (an RPC provider's webhook or an account subscription).
3. For every incoming transfer: AML check on the sender → `invest`.
4. If not all of it was credited (`hard_cap`, `max_ticket`), or the amount is below `min_ticket`, the remainder waits on the address and the user withdraws it with a button (`withdraw_deposit`).

### Closing funding
1. Before the deadline, ask the borrower to confirm the wallet is current: they may have lost access to it, or the exchange may have changed the deposit address.
2. Address confirmed → the operator calls `close_funding` straight away.
3. Address changed → the borrower reports the new one, the admin calls `set_borrower_wallet`, then the operator closes funding.

Only the operator can close funding, so no outsider can send the money to a stale address. Interest runs from the deadline either way, so being late with the call costs the borrower money.

If `close_funding` fails on the transfer to the borrower (a frozen account) and the problem cannot be fixed within `cancel_grace_days` — `cancel_campaign`, after which investors take their contributions back through `withdraw_refund`.

### Servicing the loan
1. The borrower transfers the payment to the campaign's repayment address before the payment date.
2. The backend calls `process_repayment` immediately with the operator's key — that way a payment made in advance is processed too. A call by an outsider, the borrower included, only processes matured payments and arrears: if the backend is down, the money can still be processed on the payment date and no penalty accrues.
3. The user presses "withdraw" → `withdraw_payout`.

### Prepayment
The borrower requests it in their cabinet, transfers the amount to the repayment address, and the operator calls `prepay_full` or `prepay_partial`. Both instructions settle what is already due themselves, so the borrower sends today's payment and the prepaid part in a single transfer. An outsider's `process_repayment` cannot turn that money into an advance: it takes only what is due. The operator, however, must not call `process_repayment` ahead of the prepayment — otherwise the excess becomes an advance, a partial prepayment becomes unavailable, and on a full one the borrower overpays interest.

### Default and recovery
1. Once the arrears reach the threshold — `mark_default` (anyone may call it).
2. The platform pays the lawyers and the court fee → `record_recovery_cost` **before** processing any incoming money.
3. Recovered money arrives on the repayment address → the operator calls `process_repayment`.

### The backend's keys for processing incoming money
The contract does not know why money arrived on the repayment address — only the backend does, from the borrower's request. The recommended scheme:

| Key | When it is used | What it processes |
|---|---|---|
| **an ordinary key** (not the operator) | routine processing of every incoming transfer | only what is already due; anything above it stays on the address |
| **the operator** | only on an explicit action by the borrower | an advance (`process_repayment`) or a prepayment (`prepay_partial`, `prepay_full`) |

That way money above the payment waits on the address by default, until the borrower says what it is: an advance or a prepayment.

### Changing a withdrawal address
1. `set_withdrawal_address` → withdrawals are blocked, the user is notified.
2. After 48 hours → `set_whitelist_status(true)`.

---

## 11. Limitations and quirks

- **Foreign tokens** on deposit and repayment addresses, and **an overpayment after full repayment**, are not processed by the program and stay where they are.
- **Rounding dust and tokens sent directly into the vault** stay in the vault forever: there is deliberately no instruction to take money out of the vault other than paying users. Every withdrawal rounds a payout down by less than 1 unit (a micro-USDC) on each of the four items. An investor who has withdrawn 10 times is short by at most ~40 micro-USDC.
- **The borrower's wallet** is changed by the admin alone, and only while the campaign is funding. After funding closes it is not needed. If the address cannot be fixed, or the account is frozen, the campaign is cancelled after the grace period and the contributions go back to the investors.
- **There is no emergency withdrawal.** If the operator and every signer of the multisig are unavailable at once, the funds stay in the program.
- **Positions are never closed.** This is what allows recovered money to be distributed at any later time.
- **Limits:** 60 payments in a schedule, 8 allowed tokens. Changing them requires a new version of the program: account sizes are fixed at creation.
- **`entity_type`** is stored but unused by the program; tax withholding is not implemented.
- **Exchanges and PDAs.** Deposit addresses are off-curve PDAs. Binance, Coinbase, OKX, Kraken, Backpack and Swissborg will send to such addresses; Bybit and Bitget will not, and their users need an intermediate wallet. Support depends on the region.
- **The program's upgrade authority** is handed to a multisig with a timelock before mainnet — that happens at deployment, with no change to the code.

---

## 12. Tests

### Accounting unit tests — `programs/dala_capital/src/state/accounting_tests.rs`

They work directly on the `Deal` struct, with no blockchain. The reference figures are a 100,000 USDC loan, 12 months, 10% a year, 20% penalty.

| Test | What it checks |
|---|---|
| `annuity_schedule_matches_reference` | a payment of ≈ 8,791.59, interest of 833.33, ≈ 51,244.54 outstanding after 6 payments, principal equal to the amount raised |
| `coupon_schedule_matches_reference` | coupons of 833.33, a final payment of 100,833.33 |
| `schedule_validation_rejects_bad_fractions` | fractions not summing to `SCALE`, coupon principal outside the last payment |
| `rounding_leaves_no_principal_behind` | the schedule's principal equals the amount raised exactly, for an awkward amount |
| `underpayment_goes_to_interest_then_principal` | an underpayment: interest first, the shortfall becomes overdue principal |
| `penalty_and_interest_accrue_on_overdue` | a penalty of ≈ 21.06 over 10 days, plus interest on the overdue principal |
| `next_payment_first_closes_overdue_and_penalty` | the next payment closes the arrears and the penalty, the rest is an advance |
| `overpayment_is_advance_for_next_payments` | 20,000 covers payments 1–2 and ≈ 2,416.82 of payment 3 |
| `single_underpayment_never_reaches_default` | one underpayment never leads to default |
| `systematic_underpayment_defaults_around_month_seven` | 5,000 a month instead of 8,791.59 → the 90-day threshold around month 7 |
| `full_payment_by_schedule_repays_loan` | paying on schedule repays the loan |
| `due_obligations_exclude_future_payments` | nothing is due before a payment date; payments that have not matured are not part of what is due |
| `default_accelerates_principal_and_keeps_accruing` | default accelerates the principal, interest and penalty keep growing |
| `default_distribution_order_and_settlement` | the order in default; settlement requires the costs to be reimbursed |
| `full_prepayment_on_payment_date` | full prepayment: ≈ 51,244.54 outstanding, a 1% fee |
| `full_prepayment_charges_interest_for_actual_days` | interest of ≈ 213.52 for 15 days |
| `partial_prepayment_reduces_payments_keeps_dates` | 20,000 prepaid → a payment of ≈ 5,360, the dates unchanged |
| `partial_prepayment_in_one_transfer_settles_todays_payment_first` | one transfer: today's payment first, then the prepaid part, no advance |
| `partial_prepayment_rejected_*` | away from a payment date, with an advance, with arrears |
| `distribution_is_pro_rata` | 50/30/20 → interest of 416.67 / 250 / 166.67 |
| `payouts_never_exceed_inflows` | the invariant: payouts ≤ inflows, on awkward amounts |

### Accounting fuzzing — `programs/dala_capital/src/state/fuzz_tests.rs`

2,000 random scenarios. Each one: a random campaign (annuity or coupon, 1–60 payments, 1, 2, 4 or 12 periods a year, a rate, a penalty rate, a default threshold, a prepayment fee, an amount raised, 1–5 investors) and up to 120 random operations with random jumps in time: payments by the operator and by outsiders, partial and full prepayment, moving into default, recovery costs, recovery. At the end the loan is driven to repayment.

After every step it checks that:
- everything taken from the borrower is fully allocated: to investors by item, plus reimbursement of the costs;
- an outsider's call never creates an advance;
- on each item, payouts to positions do not exceed what came in, and what is left undistributed is no more than `the number of positions + total_raised / SCALE + 1` units: the per-position rounding down plus the accumulator's remainder, which carries into the next distribution;
- what is due never exceeds the whole debt; no more principal is paid out than was raised, and on repayment exactly all of it is;
- a partial prepayment fails only with `NotPaymentDate`, `HasAdvance` or `InvalidPrepaymentAmount`.

On a failure the message carries the scenario's seed.

So that the fuzzing does not run idle, the test collects statistics on the operations performed and fails if some branch ran too rarely. A typical run: ~30,000 steps, ~7,000 operator payments and ~1,700 outsider ones, ~5,500 advances, ~470 accepted and ~1,200 rejected partial prepayments, ~650 full prepayments, ~630 defaults and ~4,000 payments in default; schedules reach the 60th payment.

### Integration tests — `tests/dala_capital.ts`

The program from `target/deploy` is loaded into LiteSVM and time is moved with `setClock`. The helpers are in `tests/helpers.ts`: building instructions with the Anchor client, sending them through `@solana/kit`, and writing token accounts directly to imitate transfers from exchanges.

| Block | Scenarios |
|---|---|
| Platform and roles | `update_platform` by the admin only; the old operator rejected after a replacement; a campaign in a disallowed token |
| Users | changing a withdrawal address blocks withdrawals for 48 hours; only the whitelist authority toggles the whitelist |
| Funding | the borrower's ATA created at closing; a frozen borrower account → cancellation after the grace period and refunds; a token account cannot be the borrower's wallet; the fee to the treasury and exactly the amount raised to the borrower, anything extra left in the vault; `min_ticket`; partial crediting above `hard_cap` and withdrawal of the remainder; `max_ticket`; without a fixed schedule; cancellation before the deadline and refunds; closing an empty deposit ATA after a failure |
| Repayment | the 50/30/20 distribution and withdrawals; withdrawal only to the withdrawal address and only with the whitelist on; an empty repayment address |
| Processing incoming money | before a payment date an outsider processes nothing while the operator processes an advance; an outsider processes only what is due, and the remainder goes into a partial prepayment |
| Default | the 90-day threshold; processing by the operator only; recovery costs to the treasury first |
| Prepayment | partial, then full, with everything received paid out to investors; partial in one transfer together with today's payment; partial away from the date; no prepayment on a coupon |

### End-to-end scenarios — `tests/scenarios.ts`

| Block | Scenarios |
|---|---|
| Full cycles | annuity: 12 payments on schedule → "Repaid", investors receive exactly principal and interest, processing is rejected afterwards; coupon: 11 coupons and a final payment with the principal; default with full recovery → "Repaid", costs reimbursed to the treasury, the excess left on the repayment address; a 10-day penalty — the penalty and the interest on arrears match the formula, and the penalty reaches investors as its own item |
| Account substitution | crediting into the vault or from the deposit address of another campaign; processing money from another campaign's repayment address; paying out on someone else's position or from another campaign's vault; closing funding with a foreign treasury account or a foreign borrower wallet |

### Combinations of conditions — `tests/edge_cases.ts`

| Block | Scenarios |
|---|---|
| Prepayment | full with an advance outstanding — the advance is credited; full with arrears and a penalty — the amount matches the formula to the unit; partial when the previous payment is also overdue; unavailable in default |
| Whitelist, address, treasury | a disabled whitelist blocks both a refund and a deposit withdrawal; after an address change and 48 hours the payout goes to the new address and the old one is rejected; after changing the treasury the old account is rejected, and after `allow_mint` the fee goes to the new one |
| The borrower's wallet | an outsider cannot close funding; after the deadline the admin changes the wallet and the operator closes funding to the new address; only the admin can change the wallet, never to a token account and only while funding |
| Default and distribution | coupon: a 30-day default threshold; seven investors with awkward amounts withdrawing in different months of a full cycle |

### Operational scenarios — `tests/operations.ts`

| Block | Scenarios |
|---|---|
| Operations | partial recovery in default, a withdrawal, more money arriving — the second withdrawal takes only the increment; changing the operator mid-loan — the new one withdraws and handles the default, the old one is rejected; a deposit made after funding closed is returned and the deposit address is closed |
| Arrears and default: exact amounts | The test reimplements the program's accrual (interest on overdue principal, penalty, carrying the remainders of division) and checks the events to the unit. A 100,000 loan, 12 months, 10%, 20% penalty. **Three payments missed**, and 10 days after the third everything is settled in one transfer: an outsider processes exactly what is due — 27,229.47, of which 266.38 is interest on arrears and 588.32 is penalty; the rest of the transfer waits for the next date; the loan returns to the schedule and is repaid with no new penalty. **Recovery costs of 5,000 exceeding what was recovered:** the first 3,000 go to the treasury and nothing to the investors; of the next 4,000, 2,000 goes to the treasury and 2,000 to the investors. **Default after four payments made:** 67,766.85 of principal to recover, the interest of matured payments 5–8 plus 2,258.90 of interest on arrears, and 883.74 of penalty; the interest of payments 9–12 is no longer owed; after full recovery the investors together receive everything to within 12 rounding units |
| Time boundaries | crediting before the start / a second before the deadline / at the deadline; a payment exactly on the second of the date with no penalty and a second later with one; default a second before the threshold and exactly on it; a partial prepayment in the last second of the payment date's day and a second later |

### Limits — `tests/limits.ts`

A 60-payment schedule. Transaction sizes: creating a campaign — 622 bytes, uploading 20 payments — 613 bytes, against a limit of 1,232.

Compute consumption in the worst cases, against the default limit of 200,000 units:

| Operation | Units |
|---|---|
| `process_repayment` after all 60 payments have matured | 129,295 |
| `prepay_full` after 59 missed payments | 127,190 |
| `mark_default` after all 60 dates | 111,020 |
| `close_funding` | 106,716 |
| `prepay_partial` recomputing 59 payments | 99,236 |
| `withdraw_payout` | 77,072 |
| `process_repayment` in default | 49,613 |

Requesting an extra compute budget is unnecessary.

### Input and state validation — `tests/validation.ts`

| Block | Scenarios |
|---|---|
| Campaign parameters | 15 invalid combinations → `InvalidCampaignParams` (soft/hard cap, tickets, start ≥ deadline, periods a year ∉ {1, 2, 4, 12}, a zero rate / threshold / grace period, 100% fees, a coupon with a prepayment fee); boundary values pass; a non-admin, a duplicate id, a zero borrower wallet |
| Uploading the schedule | an empty chunk; a date not later than the deadline; dates out of order within a chunk and between chunks; a 61st payment; finalizing with no payments, with fractions summing to more or less than `SCALE`, a coupon with principal outside the last payment; changes after finalizing; a foreign admin; crediting before finalizing |
| The wrong state | for funding, an active loan, a failure, default and repayment — every instruction that does not belong is rejected with `InvalidDealState` (or `FundingStillOpen`) and balances do not move; on a repaid loan a payout still works; zero amounts → `NothingToProcess`, `InvalidPrepaymentAmount`, `InvalidAmount` |
| Allowed tokens | 8 tokens pass, the 9th → `TooManyMints`; allowing one twice does not duplicate it; removing one frees the slot; only the admin removes; a campaign in a removed token keeps working |
| Pre-created addresses | a deposit address created and funded by an outsider before `open_deposit` — opening succeeds and the money is credited; withdrawal and borrower accounts created in advance get in the way of nothing; a vault and a repayment address created and funded before `create_campaign` — the campaign is created, the borrower receives exactly what was raised, the extra stays in the vault as dust, and tokens on the repayment address count as a payment |

### Random scenarios through the program — `tests/random.ts`

Unlike the accounting fuzzing, this works against the real program in LiteSVM rather than the struct, so it catches mistakes in instructions, transfers and events. By default 40 scenarios with seed 20260918; override with `RANDOM_SEED` and `RANDOM_SCENARIOS`.

Each scenario has three parts:
1. A random campaign: annuity or coupon, 1–24 payments, a rate, a penalty rate, a default threshold, fees, `max_ticket`, 1–6 investors with awkward amounts, and sometimes a failed funding.
2. A borrower profile: punctual, patchy, or barely paying.
3. 20–90 random operations with jumps in time. At the end the loan is driven to repayment and the investors withdraw everything.

Every transaction is checked:
- **successful** — exactly one event, its items adding up to the total (for `RepaymentProcessed`, `received = recovery + interest + principal + penalty`, with `advance` ≤ `interest + principal`); the movement on every token account (vault, repayment address, borrower, treasury, deposit and withdrawal addresses) matches the event to the unit, and no other account moves; the payout in `PayoutWithdrawn` on each item equals the amount computed outside the program from the accumulators and checkpoints; the platform fee is `floor(total_raised × bps / 10 000)`;
- **rejected** — only with the error expected for that operation, and balances do not move.

After every step it checks that:
- the sum of all token accounts equals everything that came in from outside;
- the sum of the positions equals `total_raised`;
- the vault covers what is due to investors, with an excess of no more than `4 × (positions + withdrawals) + total_raised / SCALE + 1` units;
- after a failed funding and all refunds the vault is empty;
- at the end every investor has received their principal, short by no more than "the number of their withdrawals + 1" units (micro-USDC).

Like the fuzzing, the test collects statistics and fails if a branch never ran: a failed funding, ending in default, accepted full and partial prepayments, default, recovery costs, processing by the operator and by an outsider, withdrawals. A run of 150 scenarios with a different seed: 29 failed fundings, 34 defaults, 19 full and 32 partial prepayments.

**Important for developers:** the program's heap is 32 KB, and allocated memory is not released until the transaction ends. Do not build errors eagerly (`ok_or(error!(...))`) inside loops and arithmetic — only lazily, with `ok_or_else(|| error!(...))`. Otherwise the program runs out of memory on a long schedule.

To run:

```bash
anchor build
npm run test:unit
npm run test:integration
```
