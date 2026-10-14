# Architecture

Why the system is shaped the way it is. The instruction-level reference is
[smartcontracts/CONTRACT.md](../smartcontracts/CONTRACT.md); the corporate-action
design is [KASE.md](../KASE.md). This document is about the decisions those two
inherit.

![Architecture](architecture.svg)

## The shape of it

Three roles — administrator, investor, borrower — one backend, two Anchor
programs.

| Program | Owns |
|---|---|
| `dala_capital` | Money. Campaigns, deposits, schedules, repayments, prepayment, default and recovery |
| `dala_actions` | The paper. Bond issuance and the corporate-action journal: record dates, register hashes, settlement references, vote results |

**The dependency runs one way.** `dala_actions` never moves funds and never
calls `dala_capital`. It is called from campaign publication, from crediting a
deposit and from a refund — and that is all. A bond's coupon is paid by
`dala_capital`, which already knows how to pay investors and is covered by
tests; a second payment system would pay the same money twice.

## Users have no wallets in the program

An investor never connects a wallet and never signs anything. They are given a
**personal deposit address** — a PDA of the program, derived from the campaign
and their user id — and they transfer stablecoin to it from wherever they keep
it, an exchange included. The platform's operator key signs the instruction that
credits the campaign.

This is not a simplification for the demo. It moves a burden: the investors are
offshore, KYC'd, and mostly not crypto-native, and a lost seed phrase would mean
a lost claim. In exchange the platform takes on the duty to be honest about what
it signs — which is why the contract, not the platform, decides what each
signature may do:

- withdrawals go **only** to an address the investor registered and the
  registrar approved, and the contract checks it;
- a changed withdrawal address closes withdrawals for 48 hours;
- the operator can move money **through** the contract's rules and nowhere else.

## Settlement without iterating over holders

When a borrower repays, the contract does not loop over investors. The amount is
pushed into **accumulators** on the deal, and each investor's share is derived
from their own position when they claim.

```
distribute(acc, carry, amount, total_raised):
    acc   += (amount × SCALE + carry) / total_raised
    carry  = (amount × SCALE + carry) % total_raised

pending(principal, acc, checkpoint):
    share  = principal × (acc − checkpoint) / SCALE
```

`SCALE` is 10¹², the accumulator is per unit of raised principal, and a
position's `checkpoint` is its watermark — what it has already taken.

Three consequences, and they are the point:

**Settlement happens inside the borrower's own payment transaction.** There is
no settlement cycle to wait for, because there is nothing to settle later:
T+0 here is the shape of the mechanism, not a service-level promise.

**The number of holders changes nothing** — not the cost, not the time, not the
transaction size. One thousand investors cost the same as one.

**Nothing is created or lost.** Division rounds down and the remainder lives in
`carry` until the next distribution, so the sum of claims never exceeds what was
paid, and the dust is not quietly kept by anyone.

## Four buckets, one order

Principal, interest, penalty and the prepayment fee are tracked separately —
four accumulators on the deal, four checkpoints on each position. A payment is
allocated in a fixed order, oldest obligation first:

1. scheduled interest of matured periods,
2. interest accrued on overdue principal,
3. principal of matured periods,
4. penalty,
5. whatever is left goes forward as an advance against future periods.

Because the buckets never merge, every payout can be shown as what it is —
*this much principal returned, this much interest earned, this much penalty* —
on the investor's screen and in the register extract.

## The contract's arithmetic, mirrored

A deal's stored fields are accurate only as of `last_accrual_ts`: interest and
penalty accrue per second, and the chain learns about it only when a transaction
touches the deal. The program also exposes no read-only instructions.

So the backend reimplements the same arithmetic in TypeScript and checks it
against reference numbers taken from the contract's own tests. The screen must
be able to say what the contract *will* do before the transaction is sent — what
is due now, what a partial prepayment would do to the schedule, how much a
holder is entitled to. When the mirror and the chain disagree, the chain is
right and the mirror is the bug.

## What the platform's keys can and cannot do

Four keys, named after the functions they perform on a securities market.

| Key | May | May not |
|---|---|---|
| Registrar (`whitelist`) | Create user accounts, open and close withdrawals, confirm withdrawal addresses, mint and burn notes | Move stablecoin |
| Issuing agent (`admin`) | Create campaigns, issue bonds, declare corporate actions, mark default | Pay, settle, or withdraw |
| Paying agent (`operator`) | Credit deposits, close funding, process repayments, settle actions, return a borrower's overpayment | Send funds anywhere the contract does not direct them |
| Treasury | Receive fees | Sign anything |

A stolen operator key is a serious incident — it could credit, close and settle
at the wrong moment — but it cannot redirect money: destinations are PDAs and
approved addresses, derived and checked by the program. It cannot mint notes
beyond the issue's ceiling, snapshot a register before its record date, settle
an action without a snapshot, or burn notes while the loan is unpaid. Those are
contract invariants, not platform policy.

Before mainnet the service keys are replaced by a multisig. On devnet they live
on the deployment server, which is the honest price of a public stand.

## Two instruments, one engine

The bond is the track's subject, but it is the second shape of the same loan.

| | Loan | Bond |
|---|---|---|
| Schedule | Annuity: equal payments, principal amortised throughout | Coupons on schedule, principal at maturity |
| Investor's claim | Exists only inside the contract, as a position | A registered Token-2022 note, plus the position behind it |
| Corporate actions | None | Record dates, register snapshots, entitlements, votes, redemption |

Both run on the same accounting: the same four buckets, the same accumulators,
the same payout path. A bond campaign is a coupon schedule with paper issued on
top of it — which is why the bond side could be added without touching how money
moves.
