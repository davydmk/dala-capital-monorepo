# Dala Capital

Private credit on Solana. Kazakhstani SMEs raise USDC from offshore investors who never connect a wallet: each investor gets a personal deposit address, transfers tokens to it, and the platform credits the campaign on-chain. Money and the payment schedule live in the contract — the platform only executes operations and explains them to a human.

Two loan shapes. A **loan** amortises on an annuity schedule, and the investor's share exists only inside the contract. A **bond** pays coupons with principal at maturity, the holder owns a registered Token-2022 note, and its corporate actions are serviced by a separate program: record date, holder list, entitlement calculation, holder vote.

**Live stand: [app.dala-capital.live](https://app.dala-capital.live)** — devnet, real transactions on Solana.

[Русская версия README](README.ru.md) · [KASE side track: technical overview](KASE.md) · [Deployment](deploy/README.md)

## Layout

| Folder | What's inside |
|---|---|
| `smartcontracts/` | Two Anchor programs. `dala_capital` — campaigns, deposits, schedules, repayments, prepayment, default and recovery. `dala_actions` — bond issuance and the corporate-actions journal |
| `backend/` | NestJS and PostgreSQL: cabinets for three roles, a client for both programs, mirrors of the contract's arithmetic, and pre-flight checks before every transaction |
| `frontend/` | Next.js: admin, investor and borrower cabinets |

## How it works

**Only the contract moves money.** The platform signs transactions with service keys but custodies nothing: deposits sit in the campaign vault, and payouts are distributed by accumulators in the same transaction in which the borrower pays. Settlement is T+0 because settlement *is* the trade.

**Four keys with different rights**, named after the functions they perform on a securities market: the registrar maintains the holder register and withdrawal whitelist, the issuing agent places the issue and declares corporate actions, the paying agent settles and credits, the treasury receives fees. In the contract they are `whitelist`, `admin`, `operator` and `treasury`.

**The contract's arithmetic is mirrored in the backend.** A deal's fields are only accurate as of its last accrual timestamp, and the program exposes no read-only instructions — so the formulas are reimplemented and checked against reference numbers from the contract's own tests.

**The holder register is stored off-chain; its hash goes on-chain.** Keeping the full list in an account would be expensive and pointless: the published list can be recomputed by anyone and verified against the anchored digest.

**A move cannot half-apply.** When a holder changes their withdrawal address, the note is burned on the old account and minted on the new one in **one transaction** — a half-applied move would leave a holder without evidence of a claim they still hold. The registrar can also reconcile: compare paid-in lots against on-chain balances and re-issue what a failed transaction left missing.

**The register is kept by name.** Notes are minted only to investors' withdrawal addresses and cannot be transferred, so the platform always knows who is behind an address. Identity is written into the snapshot when it is taken, not looked up later, so an extract for a past record date still shows the name of that date. The hash covers accounts, units and amounts — not names: a name is an attribute of the KYC file, and substituting it changes nobody's entitlement. Names are visible to the administrator only; investors see each other as anonymous shares.

**Documents a registrar hands out.** A register extract in CSV — holder, type, country, securities account, units, share of the issue, amount due — with a second, journalled export that adds identifying documents. Corporate-action notices in the ISO 15022 layout: MT564 while declared, MT566 once settled, with `CAEV`/`CAMV` codes and the ISIN. And the whole action journal as a table.

**The bond is registered, not bearer.** Holder token accounts are created frozen, so the note evidences a claim and does not circulate. The registrar holds permanent-delegate rights and burns units on redemption — supply goes to zero, visible in any explorer.

## A note on language

The interface and the code comments are in Russian, and that is deliberate. The borrowers are Kazakhstani companies and the investors are Russian-speaking; localisation here is market fit, not technical debt. The comments carry the reasoning — why a number is computed one way and not another, what the contract deliberately does not do — and translating them would make them worse. This README and [KASE.md](KASE.md) carry everything needed to understand the system in English.

## Running it

Requires Node 24, Docker, and Rust with Anchor 0.31 for the programs.

```bash
# database
cd backend && docker compose up -d

# backend: migrations and start
cd backend && pnpm install && npx prisma migrate dev && pnpm start

# frontend
cd frontend && pnpm install && pnpm dev --port 3100

# programs
cd smartcontracts && anchor build && anchor test
```

Environment variables follow `backend/.env.example`. Role keypairs live in `backend/.secrets/` and never enter the repository.

## Tests

```bash
cd backend && pnpm test && pnpm test:e2e
cd smartcontracts && anchor test
```

Both programs are deployed on devnet and the full lifecycle has been walked through live on realistic amounts: an issue of 1 251 000 USDC with 1 251 notes across three holders, a 75 060 USDC coupon, a holder vote, redemption with burn down to zero supply, and the borrower's overpayment returned. Addresses, numbers and the walkthrough are in [KASE.md](KASE.md).
