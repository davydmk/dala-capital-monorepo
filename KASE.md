# Dala Capital — Corporate Actions for Tokenized Bonds

Technical overview for the **KASE × Superteam Kazakhstan** side track.

Dala Capital is a working private-credit platform on Solana: Kazakhstani SMEs raise USDC from offshore investors who never connect a wallet. This side track extends it with the part that matters after issuance — **servicing a tokenized bond through its lifecycle**: identify holders on a record date, calculate entitlements, execute or initiate the action, and record the outcome on-chain.

Everything described here is live on **devnet** and reproducible from this repository.

---

## 1. What already existed, and what this track added

The platform had the hard part: a lending program with coupon schedules, a holder register, on-chain distribution and settlement. A coupon campaign **is** a bond — interest on schedule, principal at maturity.

Three things were missing, and they are what this track added:

| Missing | Added |
|---|---|
| The instrument itself — an investor's claim lived only inside our program | A Token-2022 bond, minted to the holder, with terms written into the mint |
| A record-date mechanism | Declared record dates, register snapshots, hash anchored on-chain |
| A way to mark bonds redeemed | Burn on redemption — supply goes to zero, visible in any explorer |

**The existing lending program was not modified by a single line.** Nine live devnet campaigns kept running throughout.

---

## 2. Architecture

Two Anchor programs, deliberately separated:

| Program | Address (devnet) | Responsibility |
|---|---|---|
| `dala_capital` | `JCLPbcLwdYJs1UJgL6LK1nhYRUcGk5ziFPx55nVL9akB` | Loans: funding, schedules, repayments, distribution to investors, default and recovery |
| `dala_actions` | `7JZq4xxCLMaRefYwqgqh78skXkWrf4rtU6ArRjiokrjV` | The bond itself and the corporate-actions journal |

```
Investor pays USDC ─► dala_capital: position + accumulator distribution
                           │
                           └─► dala_actions: mint bond units to the holder

Borrower repays ─────► dala_capital: coupon/principal distributed on-chain
                           │
                           └─► dala_actions: action record (record date,
                                register hash, settlement signature)
```

**`dala_actions` holds no money.** Coupons and principal are paid by `dala_capital`, which already does this and is covered by tests. A second settlement system would have paid the same money twice. The actions program owns the paper and the audit record; the settlement reference is the `dala_capital` transaction signature, stored in the action account.

This is a deliberate design decision, not a shortcut: in real market infrastructure the paying agent and the registrar are different functions, and the registrar records what the paying agent did.

---

## 3. The instrument

A **Token-2022 mint created by the program itself** (PDA, so nobody can register a counterfeit), with three standard extensions:

| Extension | Why |
|---|---|
| `DefaultAccountState = Frozen` | Holder accounts are created frozen — the bond is **registered, not bearer**. It evidences a claim; it does not circulate |
| `PermanentDelegate = registry PDA` | The registrar burns bonds without the holder signing, exactly as a CSD executes a mandatory corporate action |
| `MetadataPointer` + `TokenMetadata` | **Terms live inside the mint**: ISIN, face value, coupon rate, coupons per year, maturity, issuer campaign |

The **ISIN** is validated against ISO 6166 — twelve characters, country prefix, Luhn check digit — before it is written, because metadata is immutable after issuance: a wrong identifier would stay wrong forever. It is optional (an issue may not have one yet), but never accepted malformed, and it is shown on the issue page, on the holder's tile and in the register extract.

Metadata is not decoration. A holder can verify the terms of their own bond in any wallet or explorer without trusting our program, our backend, or our UI. The registry account duplicates these fields for on-chain arithmetic, but the mint is the source of truth for the outside world.

### Why non-transferable

Kazakhstani corporate bonds are **registered securities**: title passes through the registrar, which checks both sides, not peer-to-peer between wallets. A freely transferable token would also break the platform's AFSA perimeter — a coupon could land on an unverified holder.

Underneath, an investor's economic position in `dala_capital` is itself non-transferable. If the token moved while the position did not, the token would be lying about who owns the claim.

**Honest consequence:** while transfers are closed, the register on the record date always equals the register at payment. The mechanism is real and verifiable — the date is declared in advance, the register is snapshotted against it, and its hash is committed on-chain before settlement — but it is not yet load-bearing. It becomes load-bearing the day registrar-mediated transfers open, which is a ~40-line instruction, not a redesign.

### Minting and burning a frozen account

A frozen account can neither receive nor release tokens, so `mint_to_holder` and `burn_from_holder` internally **thaw → act → freeze**. Three CPIs instead of one, and no window in which the bond could be moved.

---

## 4. Record date and entitlement calculation

### The flow

```
declare_action(kind, record_ts, payment_ts, amount_per_unit)   ← admin, in advance
        │   holders see it from this moment
        ▼
record_snapshot(holders, units, total, register_hash)          ← operator, only after record_ts
        │   the program rejects a snapshot taken before the record date
        ▼
settle_action(settlement_signature, votes…)                    ← operator, after dala_capital paid
        │   cannot run without a snapshot — the program enforces the order
        ▼
close_action()                                                 ← admin
```

### Entitlement formulas

Implemented as pure functions in `backend/src/bonds/entitlements.ts`, unit-tested against the exact example from the track brief:

```
coupon per unit     = face_value × coupon_rate_bps / 10 000 / coupons_per_year
redemption per unit = face_value + final coupon (if due on the same date)
holder entitlement  = units_on_record_date × amount_per_unit
vote weight         = units_on_record_date
```

Brief's example: 10 bonds × $1 000 × 10% ÷ 2 = **$500** coupon, **$10 000** principal at maturity, plus any final coupon. Both are asserted in `entitlements.spec.ts`.

Division always rounds down. A cent that does not divide evenly stays with the issuer rather than being created out of thin air.

### Where the register comes from

Balances are read **from the chain**, per holder, with `getMultipleAccountsInfo` — one request for the whole register. The list of candidate holders comes from the platform's own records (who opened a deposit address for this campaign), because public RPCs do not serve `getProgramAccounts` for Token-2022 (the program is excluded from secondary indexes) and rate-limit `getTokenLargestAccounts`. The platform narrows *where to look*; it cannot fake *what is there*.

### What goes on-chain, and why only a hash

The snapshot writes to the action account: holder count, total units, total amount, and the **SHA-256 of the canonical register**. The register itself is published at `GET /bonds/:id/register/:index`.

Anyone can recompute the hash from the published list, recompute every entitlement from it, and verify each weight against on-chain balances. Writing one account per holder would have cost ~100× more rent and added nothing to verifiability.

**Known limitation, stated plainly:** a hash does not prevent the platform from dropping a ballot or a holder *before* hashing. Mitigated — holders see their own record and the list is published before closing — not eliminated. Full protection means holder-signed, on-chain ballots, which requires wallet login in the investor cabinet.

### The register is kept by name, not by address

A registrar knows its holders by name; that is the job. Bonds are minted only to investors' withdrawal addresses and cannot be transferred, so the platform always knows who is behind an address — it reads the link from its own deposit records.

Identity — name, holder type, country — is written **into the snapshot at the moment it is taken**, not looked up when the document is read. Otherwise an extract for a past record date would show the holder under a name they have since changed.

**The hash covers the distribution of rights, not the identity:** account, token account, units, amount. A name is an attribute of the KYC file; substituting it changes nobody's entitlement and is refuted by the file itself — exactly as at a registrar, where holder details are amended on application. The extract says so in its own header, so the question does not have to be asked. A unit test asserts that adding names to the rows leaves the fingerprint unchanged.

**Names are visible to the administrator only.** Investors see each other as anonymous shares; an end-to-end test asserts that no name reaches an investor's response.

### Repairing the register

A move between two addresses — what happens when a holder changes their withdrawal address — burns on one account and mints on the other. Both go in **one transaction**, because a half-applied move would leave a holder with no evidence of a claim they still legally hold. We learned this the hard way on devnet: the two legs were separate transactions, the second was not confirmed within thirty seconds, and 251 units were burned and never re-issued.

The registrar also has a **reconcile** action: it compares each holder's paid-in lots against their on-chain balance and re-issues what is missing. A confirmation timeout says nothing about whether a transaction landed, so a registrar that cannot repair its own register is not a registrar. Surplus units are never burned by it — that is not a connectivity glitch, that is something to look into by hand.

### What the registrar hands out

| Document | Contents |
|---|---|
| Register extract, `GET /bonds/:id/register/:index/csv` | Issue and ISIN, record date, list hash and what it covers; then number, holder, type, country, securities account, token account, units, share of the issue, amount due |
| The same with `?full=1` | Adds the identifying document and date of birth, taken from the KYC file **as of export** and labelled as such; the export itself is written to the admin journal |
| Corporate-action notice, `…/actions/:index/notice` | ISO 15022 layout: MT564 while the action is declared, MT566 once settled, with `CAEV`/`CAMV` codes, `:35B:ISIN`, eligible units, record and payment dates, the register hash and the settlement signature. Not a SWIFT message — no network blocks, no BIC, no validation — and said so plainly in the file's own header comment |
| Action journal, `GET /bonds/:id/journal/csv` | Every action of the issue with the same ISO 15022 codes, statuses, dates, amounts, holder counts, hashes and settlement signatures |

There is no national identifier in the KYC file — Kazakhstan's IIN/BIN does not exist for offshore holders — so identification is the document type and number for an individual and the registration number for a company. The extract labels them as such instead of passing a passport number off as an IIN.

---

## 5. The three required scenarios

### 5.1 Coupon payment — implemented, executed on devnet

Admin declares the coupon with a record date; after that date the operator snapshots the register and commits its hash; the borrower's payment is distributed to investors **on-chain by `dala_capital`**; the settlement signature is written into the action record; the action is closed.

Devnet run (campaign #19, ISIN `KZ0000000021`, mint `5BJzKnHrPTSTnjg7AyJhV5VsrjTNmXaJGZYhsUAdEgEa`, face value 1 000 USDC, 1 251 000 USDC placed with three holders):

```
declared   coupon, 60.00 USDC per unit — 1 000 × 12% ÷ 2
snapshot   3 holders, 1 251 units, 75 060 USDC total
           600 → 36 000 · 400 → 24 000 · 251 → 15 060
           hash 2ed76c64a21651890f06b2689e528cfd0fa33ec81fc806382ac1f18c0c9cebfa
           MT564 :23G:NEWM · :22F::CAEV//INTR · :22F::CAMV//MAND
settled    signature 5Sah7sx9NzhbiRAC… (the dala_capital payment)
           MT566 :23G:CONF with the settlement signature attached
closed     holders withdrew 36 000 / 24 000 / 15 060 to their own addresses
```

The coupon was paid 23 seconds after the due timestamp, so the contract charged a late-payment penalty of 0.01332 USDC at 24% per annum — and distributed it **to the holders**, visible as the fractional tail in what each withdrew. Nothing about it is special-cased; it is the same accrual the loan side has always done.

### 5.2 Bond redemption — implemented, executed on devnet

At maturity the principal (plus any final coupon) is paid by `dala_capital`, and the bonds are **burned** by the registrar through the permanent delegate. When nothing is outstanding, the registry flips to `Redeemed`.

```
declared   redemption, 1 060.00 USDC per unit (face 1 000 + final coupon 60)
snapshot   3 holders, 1 251 units, 1 326 060 USDC total
           MT566 :22F::CAEV//REDM
paid       1 326 060 USDC distributed by dala_capital; holders withdrew in full
burned     3 holders, outstanding 0, registry status = redeemed
mint supply on devnet = 0
```

The borrower overpaid the final instalment by 200 USDC; the leftover sat on the repayment address until `withdraw_repay_excess` returned 199.924709 USDC to the payout wallet. Before that instruction existed the money had no way back at all.

Burn rather than a flag: "redeemed" in our account has to be taken on trust; a zero supply is visible to anyone in any explorer.

### 5.3 Third action: bondholder vote on declaring default — implemented, executed on devnet

Chosen over a generic vote because it is a decision the product actually has to make. Today an administrator declares default alone, although the money at risk is the investors'. The right answer is to ask the holders, weighted by their bonds.

**Voting is off-chain**, in the investor cabinet; weight is the holder's units **on the record date**, not the current balance — otherwise one could vote, exit, and keep the vote. On-chain goes the result in the clear (units for, units against, quorum, approved recovery budget) **plus the hash of the ballot list**.

**The question includes a recovery-cost budget.** Declaring default means the platform starts spending on lawyers, court fees and valuation — and `dala_capital` reimburses those costs **first**, straight to treasury, bypassing the vault. Holders receive only what is left after them, so voting blind would be unfair. The approved ceiling is part of the on-chain record, and actual costs are compared against it afterwards.

```
declared   vote, recovery budget 15 000 USDC — the whole budget, not per unit
snapshot   3 holders, 1 251 units; entitlement per unit is 0 by design
           MT564 :22F::CAEV//BMET · :22F::CAMV//VOLU
voted      600 FOR · 400 AGAINST · 251 FOR
           admin sees the live tally from the ballots before committing it
settled    on-chain: for 851, against 400, turnout 100%, quorum reached
```

Two details the first implementation got wrong and the devnet run caught. The recovery budget is a **total**, and multiplying it by 1 251 units made the register show an absurd obligation; it is now carried in the action itself with a zero per-unit entitlement. And the administrator used to see zeros until the result was committed on-chain, because that is where `votes_for` appears — while the decision of *when* to commit has to be made from the ballots already cast. Both are visible in the code: the tally is computed from the ballots and reconciled against the chain afterwards.

### Bonus: default and recovery as recorded actions

A defaulted bond is **not** burned — the claim still exists, it has moved into recovery. The registry goes to `Defaulted`, recovery receipts are recorded as actions, and the paper is burned only when the case closes. Otherwise the register would carry obligations forever.

---

## 6. Implemented vs. simulated

The track asks for this distinction explicitly.

### Fully implemented on Solana

- Token-2022 bond mint with frozen default state, permanent delegate and on-chain metadata
- Issuance at campaign publication; minting to holders **at the moment of investment**; burning on refund and on redemption
- Corporate-action accounts with declared record dates, enforced ordering, register hash, settlement reference, vote results
- Entitlement calculation (unit-tested against the brief's own numbers)
- Coupon and principal settlement — executed on-chain by `dala_capital`
- Events on every transition (`emit_cpi!`)

### Off-chain, by design

- **The register snapshot itself.** Computed off-chain, published, hash committed on-chain. A per-holder on-chain entitlement account would cost far more and prove no more.
- **Ballots.** Cast in the cabinet; the tally and the ballot-list hash go on-chain. Holder-signed on-chain ballots need wallet login, which this platform deliberately does not have (investors are custodial and KYC'd).
- **Fiat rails.** Out of scope; the platform settles in USDC end to end.

### Simplified, and why

- **Transfers are disabled**, so the record date is not yet economically load-bearing (see §3).
- **The holder candidate list** comes from platform records; balances come from the chain (see §4).
- **Bond issuance is operator-driven**, as everything else in this custodial model: investors never sign.

---

## 7. Reproducing it

```bash
# Contracts (WSL / Linux)
cd dala_capital
anchor build
npm run test:unit          # 25 accounting tests + fuzzing
npm run test:integration   # 99 tests in LiteSVM, incl. 16 for bonds
anchor deploy --provider.cluster devnet --program-name dala_actions

# Backend
cd backend
docker compose up -d && npx prisma migrate deploy
pnpm test                  # 185 unit tests
pnpm test:e2e              # 191 end-to-end tests over HTTP
pnpm start

# Frontend
cd frontendV2
pnpm dev --port 3100
```

Screens: `/admin/bonds` — issues and the action journal with every stage, the holder register by name with links into each KYC file, the list hash and the extracts; `/investor/bonds` — the holder's paper with its ISIN, terms read from the mint, and the default vote.

### Bond test coverage

| Layer | Tests | What they prove |
|---|---|---|
| LiteSVM (`tests/bonds.ts`) | 16 | Metadata written into the mint; bonds appear on investment and burn on refund; **a holder cannot transfer their bond**; a snapshot before the record date is rejected; settlement without a snapshot is rejected; redemption burns and closes the issue; a defaulted bond stays with holders |
| Backend unit (`entitlements.spec.ts`) | 19 | The brief's numbers; rounding never invents a cent; hash is order-independent, changes on any edit, and **does not change when holder names are added to the rows**; quorum and vote weights |
| Backend unit (`mt564.spec.ts`, `validation.spec.ts`, `title.spec.ts`) | 18 | The ISO 15022 layout field by field, NEWM → CONF on settlement, `BMET`/`VOLU` for a vote; ISO 6166 check digit; how a holder is named in a document |
| Backend e2e (`bonds.e2e-spec.ts`) | 36 | Annuity loans issue no paper; the full action lifecycle over HTTP; vote weight comes from the snapshot, not the current balance; **burning is refused while the loan is unpaid**; the extract carries names, shares and the hash disclaimer; the extended export is journalled; **no holder name reaches an investor's response**; roles |

---

## 8. Where this goes next

The pieces that make this production infrastructure rather than a prototype are small and known:

1. **Registrar-mediated transfers** — one instruction; makes the record date load-bearing and opens a secondary market inside the KYC'd circle.
2. **On-chain ballots** signed by holders, once wallet login exists.
3. **An indexer** instead of candidate lists, for issues with hundreds of holders.
4. **Multisig** in place of the server-side admin key before mainnet.

Tokenization does not end at issuance. This is the servicing layer.
