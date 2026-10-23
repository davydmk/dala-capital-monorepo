# Один выпуск в devnet, транзакция за транзакцией

[English](devnet-run.md) · **Русский**

Выпуск **№25**, ISIN `KZ0000000088` — 12 000 бумаг по 10 USDC у двух держателей —
от создания до прожига последней бумаги. Тридцать две транзакции за пять дней,
все успешные, каждая открывается в обозревателе.

Таблица не написана руками. Её собирает из цепочки
[`smartcontracts/scripts/devnet-run.mjs`](../smartcontracts/scripts/devnet-run.mjs):
читает подписи по аккаунту сделки `HaFXbYw9…` и по реестру выпуска
`BMPLecSD…`, а название каждой инструкции берёт из логов самой транзакции —
Anchor пишет туда `Program log: Instruction: …` на каждый вызов. Написать здесь
то, чего нет в сети, невозможно.

## На что смотреть

**Строки 1–4 — выпуск рождается.** Кампания, график, фиксация графика и
`IssueBond`, который той же транзакцией создаёт минт Token-2022 с постоянным
делегатом.

**Строки 7 и 10 — выпуск на замороженный счёт.** `MintToHolder` раскрывается в
`ThawAccount` + `MintTo` + `FreezeAccount`. Вот и вся именная бумага в одной строке
логов: она не подвижна никогда, даже в тот миг, когда её выпускают.

**Строки 12–15 — деньги идут в обе стороны.** Заёмщик платит, держатели
выводят. Расчёт происходит внутри самого платежа заёмщика — поэтому
`WithdrawPayout` возможен через семь минут.

**Строки 16–19, 20–23, 26–30 — три корпоративных действия**, и у каждого одни
и те же четыре стадии в одном и том же порядке: `DeclareAction`,
`RecordSnapshot`, `SettleAction`, `CloseAction`. Купон, голосование держателей,
погашение. Порядок держит программа, а не интерфейс.

**Строки 24–25 — дефолт.** `MarkDefault` по займу и `SetBondStatus` по реестру:
требование уходит во взыскание, а бумаги остаются у держателей.

**Строки 31–32 — конец.** `BurnFromHolder` раскрывается в `ThawAccount` + `Burn` +
`FreezeAccount`, дважды — по разу на держателя. После них предложение минта
равно нулю, и это проверяется без всякого доверия к нам.

Тот же прогон снят на видео, по записи на роль:
[Как это выглядит](../README.ru.md#как-это-выглядит). Реестр по каждому снимку и
покрывающий его хеш проверяются без входа на
[app.dala-capital.live/verify](https://app.dala-capital.live/verify).

## Прогон

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
