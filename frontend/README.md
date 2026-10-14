# Frontend

Next.js 16, React 19, Tailwind 4, TanStack Query. Three cabinets in one application: administrator, investor, borrower.

Part of [Dala Capital](../README.md). The live stand is at [app.dala-capital.live](https://app.dala-capital.live).

## Cabinets

| Route | Who | What is there |
|---|---|---|
| `/admin` | Registrar and issuing agent | Dashboard with what needs attention |
| `/admin/campaigns`, `/admin/campaigns/[id]` | | Draft wizard, pre-flight checks, publication, closing, default and recovery, the roster of investors by name |
| `/admin/bonds`, `/admin/bonds/[id]` | | Issues, the corporate-action journal stage by stage, the holder register by name, register extracts and ISO 15022 notices |
| `/admin/investors`, `/admin/borrowers` | | KYC decisions, on-chain accounts and withdrawal whitelist, companies and their wallets |
| `/investor`, `/investor/portfolio` | Investor | Participations, what has been paid, what is claimable now |
| `/investor/campaigns/[id]` | | A campaign, the deposit address, the schedule, anonymous shares of other investors |
| `/investor/bonds` | | Own notes, terms read from the mint, the ISIN, voting on corporate actions |
| `/borrower/loan`, `/borrower/pay` | Borrower | Schedule, debt breakdown, repayment address, early repayment, overpayment refund |

`/preview/[role]` renders a cabinet without data — useful when designing screens.

## How it talks to the backend

Requests go to the application's own origin under `/api` and are proxied to NestJS, so the session cookie stays first-party and does not depend on CORS or `SameSite`.

In development the proxy is the `rewrites` entry in `next.config.ts`, pointed at `API_URL`. In production that same prefix is stripped and forwarded by Caddy — Next resolves rewrites at build time, which would freeze the backend address into the image. See [deploy/README.md](../deploy/README.md).

## Running it

```bash
pnpm install
pnpm dev --port 3100
```

The backend is expected at `http://localhost:3001`; override with `API_URL`.

```bash
pnpm lint
npx tsc --noEmit
```

## A note on language

The interface is in Russian, and so are the code comments. The borrowers are Kazakhstani companies and the investors are Russian-speaking: localisation here is market fit, not technical debt. The comments carry the reasoning — why a number is computed one way and not another — and translating them would make them worse.
