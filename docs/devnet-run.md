# One issue on devnet, transaction by transaction

**English** · [Русский](devnet-run.ru.md)

Issue **#25**, ISIN `KZ0000000088` — 12 000 notes of 10 USDC placed with two
holders — from its creation to the burn of the last note. Thirty-two
transactions over five days, every one of them successful, every one of them
open in a block explorer.

The table is not written by hand. It is generated from the chain by
[`smartcontracts/scripts/devnet-run.mjs`](../smartcontracts/scripts/devnet-run.mjs),
which reads the signatures of the deal account `HaFXbYw9…` and the bond
registry `BMPLecSD…` and takes the name of every instruction from the
transaction's own logs — Anchor writes `Program log: Instruction: …` on each
call. Nothing here can be stated that the chain does not say.

## What to look for

**Rows 1–4 — the issue is born.** A campaign, its schedule, the schedule fixed,
and then `IssueBond` creating a Token-2022 mint with a permanent delegate in the
same transaction.

**Rows 7 and 10 — minting into a frozen account.** `MintToHolder` expands into
`ThawAccount` + `MintTo` + `FreezeAccount`. This is the registered-not-bearer
design in a single line of logs: the note is never movable, not even for the
instant it is issued.

**Rows 12 to 15 — money flows both ways.** The borrower pays, holders withdraw.
Settlement happens inside the borrower's own payment, which is why `WithdrawPayout`
can follow seven minutes later.

**Rows 16–19, 20–23, 26–30 — three corporate actions**, each one the same four
stages in the same order: `DeclareAction`, `RecordSnapshot`, `SettleAction`,
`CloseAction`. A coupon, a bondholder vote, a redemption. The order is enforced
by the program, not by the interface.

**Rows 24–25 — default.** `MarkDefault` on the loan, `SetBondStatus` on the
registry: the claim moves into recovery and the notes stay with their holders.

**Rows 31–32 — the end.** `BurnFromHolder` expands into `ThawAccount` + `Burn` +
`FreezeAccount`, twice, one per holder. After them the mint's supply is zero,
which anyone can check without taking our word for it.

The same run is on video, one recording per role: [Watch it work](../README.md#watch-it-work).
The register behind every snapshot, and the hash that covers it, can be checked
without signing in at [app.dala-capital.live/verify](https://app.dala-capital.live/verify).

## The run

| # | Время, UTC | Инструкции | Транзакция |
|---|---|---|---|
| 1 | 2026-10-15 10:35:39 | `CreateCampaign` | [`4xwZ4acC…`](https://explorer.solana.com/tx/4xwZ4acCVMdL9j7S4kG4zCJqzj2BaE7H42jSQkWZzvBqLmTYSBABDestnZJQwwNrPc7Rc7V1YJx67BuhPGw617sK?cluster=devnet) |
| 2 | 2026-10-15 10:35:40 | `AddSchedulePeriods` | [`3EZTVhEU…`](https://explorer.solana.com/tx/3EZTVhEUjgeAk8o3YTrqgLvpjiN75i1MmaVNebtsWWartPabbxCQLSb1GyFhN3q9o4bvN4mcDmCDRnCF5KjibhHZ?cluster=devnet) |
| 3 | 2026-10-15 10:35:41 | `FinalizeSchedule` | [`5AZAPeBZ…`](https://explorer.solana.com/tx/5AZAPeBZLJsQwg5mrapsKFzKaqwCvozAjX8BfaBgegKHgeLeREKDtVbWvU5cBqJ47fuokSc7H3QyW7mLnpNbCoFd?cluster=devnet) |
| 4 | 2026-10-15 10:35:42 | `IssueBond` + `InitializePermanentDelegate` + `InitializeMint2` | [`4NTdbouW…`](https://explorer.solana.com/tx/4NTdbouWzLNAdw6jG4vrPT5N9vRXYCKj44MJK4Za2fN5wF1jFqH5hoMN9Jw7whqwsktFoUrTMFYH4CkdTfDiUhjS?cluster=devnet) |
| 5 | 2026-10-15 10:40:58 | `OpenDeposit` | [`58khyLYe…`](https://explorer.solana.com/tx/58khyLYeJMLfznUJMdzMpcRisFeDQhwFtdGtzeSyp4JfdLExw8HDP4Ug9uKJ3iG3AkY6hBu41iJAda5dLypvncNY?cluster=devnet) |
| 6 | 2026-10-15 10:41:52 | `Invest` | [`KCZqy1TQ…`](https://explorer.solana.com/tx/KCZqy1TQ2dTXaBP6DMxHVKpdkMSQUKrGf5WhdLdhuGxL5jrRCmSBm72v87equ3pX4s5tNS9yoPAmkiKsbE1fLkA?cluster=devnet) |
| 7 | 2026-10-15 10:41:55 | `MintToHolder` + `GetAccountDataSize` + `InitializeImmutableOwner` + `InitializeAccount3` + `ThawAccount` + `MintTo` + `FreezeAccount` | [`31AeUh9G…`](https://explorer.solana.com/tx/31AeUh9GbV15dyFK4Vje3hyaBjf9vf6ZNZQnUMdZKcGj1oB5cfY6vz35tkbjfVQyaTnAQvy242y2VyTmHAdsqdxe?cluster=devnet) |
| 8 | 2026-10-15 10:49:12 | `OpenDeposit` | [`5jvGizT1…`](https://explorer.solana.com/tx/5jvGizT1BqDce1ese4wbiMgz4Z3YaxwuUtgFUnvrkBoNAUA6dcAhURzFxra9LKTSp7PYiVGzkmixQmeBDVdBG1RT?cluster=devnet) |
| 9 | 2026-10-15 10:49:57 | `Invest` | [`4oGBsG2L…`](https://explorer.solana.com/tx/4oGBsG2L4krzs8wZnjACUdq5ayGAz9dodNXswYYX8msGCD8o17heh4XwE91iWxaBpFswiCvHugXhWWf967cvxJ4q?cluster=devnet) |
| 10 | 2026-10-15 10:49:58 | `MintToHolder` + `GetAccountDataSize` + `InitializeImmutableOwner` + `InitializeAccount3` + `ThawAccount` + `MintTo` + `FreezeAccount` | [`3f3gAH37…`](https://explorer.solana.com/tx/3f3gAH37VmTK7DuDJnSsyihHrqC9riBQphXDAQxu6RCr6TJV8FBo15HuVpFnujEjNctYn7qc4vPhsRbtRsAMMDDR?cluster=devnet) |
| 11 | 2026-10-15 11:31:31 | `CloseFunding` | [`5LzZRnCx…`](https://explorer.solana.com/tx/5LzZRnCx6WkrMSs7YYhD82H2WSVdYUY6ConfGJvurehs5MavgUo2ksT1DgcdzGg3ykYnkb3aBZcdE5EgDPGiKphb?cluster=devnet) |
| 12 | 2026-10-15 11:39:33 | `ProcessRepayment` | [`5GXSKbEu…`](https://explorer.solana.com/tx/5GXSKbEuYrkSUTvcJjwW7YocCDrDTJefBCxZ7ZSZmSGe4T4u3ShdwM5gGBXh45uQsJXECZBFqSExN5caANs2E33m?cluster=devnet) |
| 13 | 2026-10-16 10:19:10 | `WithdrawPayout` | [`62RM52XU…`](https://explorer.solana.com/tx/62RM52XUB1Kv1T77MSaMv6deP4idds14EoMDLP2a8DghYuMDFxwaXk9AwfHVVqWmckJVR3pz2S5nA5Mh9fd4rFFF?cluster=devnet) |
| 14 | 2026-10-16 10:26:19 | `ProcessRepayment` | [`2PhV7oKT…`](https://explorer.solana.com/tx/2PhV7oKTaKpkEQYdDj5fjthFHPsn5W1jUzgdLsm8ywzf1ALwwjbkWGhiD6rc5LKVS2NXLA3MAQnR75RBjaYbyPe9?cluster=devnet) |
| 15 | 2026-10-16 19:14:29 | `WithdrawPayout` | [`2Vn7dDNC…`](https://explorer.solana.com/tx/2Vn7dDNCp4nYRTNwq6C3SGUPqehnXEDKEtkMSmm5aKiwrVNR3zpqh3nYUkzMMX34JDZGrYwXfHxHB5wvyhAxVKmW?cluster=devnet) |
| 16 | 2026-10-17 18:25:38 | `DeclareAction` | [`5YPhGJPA…`](https://explorer.solana.com/tx/5YPhGJPArP6hEUEVtGML5MWdZsKWjUJ9Cft7PHW1KyEVgsDDNQ1QPD1JxLUGGpcKdzBahZwA1G29Qa8kuKViNSWR?cluster=devnet) |
| 17 | 2026-10-17 18:25:45 | `RecordSnapshot` | [`7LESB7hE…`](https://explorer.solana.com/tx/7LESB7hEsdka7NTpJhS1tUYhUBP31bedbwoBcjWf6WwpQ14fhdG2B6wuqe5NbpmAKm87n6CEMM2dDfZGZYhMTuM?cluster=devnet) |
| 18 | 2026-10-17 18:25:54 | `SettleAction` | [`2dR5uask…`](https://explorer.solana.com/tx/2dR5uaskVCfbA3UgHgSbT1ZQZTydkpo2DFBrAhyje1iP8sbVJQPi39ca2wv9nAGoAhqwXMaNSW9MeoRYqbm12qhQ?cluster=devnet) |
| 19 | 2026-10-17 18:26:00 | `CloseAction` | [`4mP4xfiB…`](https://explorer.solana.com/tx/4mP4xfiB2U8JT5AaKUnpUX8iHS1yNyUXYLFcF6wz7yAg42BMqHQJfvAxENURq2o8jwxWfnTUdkBhBkqyXMXPxCN2?cluster=devnet) |
| 20 | 2026-10-18 08:13:58 | `DeclareAction` | [`63gn5nqK…`](https://explorer.solana.com/tx/63gn5nqKy9H29zfSUF811tP2X5gFTYsSYqMtTsPqHcfD1pZYNcuaYq59vYUuEXaYcWjBQiSwL3dC7AYcjjHSDkJo?cluster=devnet) |
| 21 | 2026-10-18 08:14:08 | `RecordSnapshot` | [`1MBdu1m4…`](https://explorer.solana.com/tx/1MBdu1m4sNAG1dadnHq3bbUsopXBArH5xsSicRSWHpYYXNKqgqXi4fnKmd7UsG2SBG8KfTPSMuHiTF7AgsU7vVb?cluster=devnet) |
| 22 | 2026-10-18 08:15:46 | `SettleAction` | [`f47T42oR…`](https://explorer.solana.com/tx/f47T42oRjXRKLddfuFvhU2fkC8dT84Pf8GSvGQFVkH5v9f6vvXfanypBwQ1P6LYP3YMtwFKijoBJ1SkzrjxzDcC?cluster=devnet) |
| 23 | 2026-10-18 08:15:50 | `CloseAction` | [`4WcG8z3b…`](https://explorer.solana.com/tx/4WcG8z3b4wyxoXuuKYij41NPtwendq2K9rK3suCdo3AL4EWcm5ecAdDgCFgnvvxWUvcBXFU1imiZNH8GEPoVrKQf?cluster=devnet) |
| 24 | 2026-10-18 08:16:59 | `MarkDefault` | [`3i2EYDCK…`](https://explorer.solana.com/tx/3i2EYDCKXAgzGc6V7wqgUjzDmE9D33Agbk4aXzPGcJS7iXD3qDrXj2wcRqSZ32RYWvDr9ovxvLcC7efm8QMHe2wb?cluster=devnet) |
| 25 | 2026-10-18 08:17:00 | `SetBondStatus` | [`2v5sGRBJ…`](https://explorer.solana.com/tx/2v5sGRBJniz1gTBzwN6QAEeQm345At322Koe5jX65c4gm5PNEB9XB8XF7DHVnr3DNY2xStvAeRXRTgmbZrq9abBM?cluster=devnet) |
| 26 | 2026-10-20 04:51:33 | `DeclareAction` | [`w6NB7gqg…`](https://explorer.solana.com/tx/w6NB7gqghVziAcZvdZuwgYxoLtKxPbSSN5VruLCYJyXHKYSfzqyYKJvcYu9g1e7SMk4YTjCg6LFujUtCF7JSXKB?cluster=devnet) |
| 27 | 2026-10-20 04:51:40 | `RecordSnapshot` | [`5Sagb7cj…`](https://explorer.solana.com/tx/5Sagb7cjkVYQVpWJh8UZRiz8Pp2ogkLHw9sDqAfo56k4oBTorjGYtjNF6wbLetFukn6PaAd7qkyrzMwYfE9juVzt?cluster=devnet) |
| 28 | 2026-10-20 04:58:16 | `ProcessRepayment` | [`5GchbSDT…`](https://explorer.solana.com/tx/5GchbSDTMhxPNpVy1dNyNBwhaHi1TKY8a3rRHndY4B4V9ekq7EwYKA7GjKE7iWpV7q41AQJ52k13sa86dyyZiFHF?cluster=devnet) |
| 29 | 2026-10-20 04:58:43 | `SettleAction` | [`5tCVWNxB…`](https://explorer.solana.com/tx/5tCVWNxBDiEVQ85EBLUa2tHmb84JsuxgsSPw3w7o7BvLeY6Unc7Pz5R7LtEFQML2ryxsmH355kKTMjXyZeWK8sBb?cluster=devnet) |
| 30 | 2026-10-20 04:58:46 | `CloseAction` | [`52Nk1bhX…`](https://explorer.solana.com/tx/52Nk1bhXsRMsrn2yN6j1enpeaYyDxHxh5wTkP6Mq8ppyoqB1HyxaiBo8JeTEinS75KPah2CGH12tLTe8AK9QZsM8?cluster=devnet) |
| 31 | 2026-10-20 04:59:38 | `BurnFromHolder` + `ThawAccount` + `Burn` + `FreezeAccount` | [`2MGM3LYv…`](https://explorer.solana.com/tx/2MGM3LYvZezTCgcF9cecjiFsf1YAgQBBpPURUxXyCh79QRissuqdgxM6pVvktXyizmRsayrXKUYxx1kGsmtrstYU?cluster=devnet) |
| 32 | 2026-10-20 04:59:38 | `BurnFromHolder` + `ThawAccount` + `Burn` + `FreezeAccount` | [`3STTotqF…`](https://explorer.solana.com/tx/3STTotqFa4RSGGEPh44ZZVjU1QeM54VgW84caFAzg4wk4SeckB1wHmcSNTMRWUoxsvj6xkm9bKawN2PNhCYdcie4?cluster=devnet) |
