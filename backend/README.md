# Backend

NestJS and PostgreSQL. Three cabinets — administrator, investor, borrower — a client for both Solana programs, and the arithmetic of the contract mirrored in TypeScript.

Part of [Dala Capital](../README.md). The contract itself is documented in [smartcontracts/CONTRACT.md](../smartcontracts/CONTRACT.md); the corporate-action design is in [KASE.md](../KASE.md).

## What this service is responsible for

**It signs, it does not custody.** Every movement of money is an instruction of `dala_capital`; the service holds the role keys and sends transactions on behalf of users who never connect a wallet. An investor transfers USDC to a personal deposit address — a PDA of the program — and the platform credits the campaign on-chain.

**It mirrors the contract's arithmetic.** A deal's fields are only accurate as of its last accrual timestamp, and the program exposes no read-only instructions. So interest, penalties, overdue amounts and entitlements are reimplemented here and checked against reference numbers taken from the contract's own tests. Screens must show what the contract will do *before* the transaction is sent.

**It checks before it sends.** Publication, closing, repayment, prepayment, snapshots and settlement all run through pre-flight checks that explain a refusal in words. A contract error code is translated into a sentence for the person reading it, not shown raw.

## Modules

| Folder | What's inside |
|---|---|
| `auth/` | Sessions in an httpOnly cookie, three roles, guards |
| `campaigns/` | Draft wizard, pre-flight checks, publication, closing, default and recovery, schedule construction |
| `investors/` | KYC questionnaire and decisions, deposit addresses, crediting, portfolio, payouts |
| `borrowers/` | Companies, wallets, invitations, loan cabinet: schedule, repayment, early repayment, overpayment refund |
| `bonds/` | Issuance, the corporate-action journal, record-date snapshots, entitlements, voting, register extracts, ISO 15022 notices |
| `solana/` | Clients for both programs: PDAs, instruction calls, reading accounts, explorer links |
| `tasks/` | "Needs attention" per role: what the platform is waiting for from this person right now |
| `prisma/` | Schema and migrations |

Two files carry most of the domain logic and are worth reading first: `src/bonds/entitlements.ts` (coupon, redemption, vote weight, register hash) and `src/borrowers/debt.ts` (accrual, amount due, schedule marking).

## Running it

```bash
docker compose up -d          # PostgreSQL
pnpm install
npx prisma migrate dev
pnpm start
```

The API listens on `http://localhost:3001`. Environment variables follow `.env.example`; role keypairs live in `.secrets/` and never enter the repository.

## Tests

```bash
pnpm test        # unit
pnpm test:e2e    # over HTTP, against a model of the contract
pnpm lint
```

The end-to-end suite replaces the network with a model that moves overdue amounts and decides a campaign's fate by the same rules as the contract — so the tests check behaviour rather than a stub.
