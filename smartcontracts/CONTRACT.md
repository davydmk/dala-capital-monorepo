# Dala Capital V2 — документация смарт-контракта

Документ для разработчиков и ИИ-агентов, которые впервые видят этот репозиторий. Описывает, что делает программа, как устроены аккаунты и учёт, и справочник по каждой инструкции.

Функциональные требования: [`../тз контракт V2.md`](../тз%20контракт%20V2.md). При расхождении документа и кода верен код — обновите документ.

---

## 1. Что делает программа

Программа на Solana (Anchor 0.31) для кампаний займов в стейблкоинах (USDC, USDT):

1. Собирает деньги инвесторов на кампанию и передаёт собранное заёмщику за вычетом комиссии платформы.
2. Ведёт график погашения — **аннуитет** или **купон** (проценты регулярно, тело в конце).
3. Принимает платежи заёмщика и распределяет их между инвесторами пропорционально вкладам, раздельно по статьям: **тело, проценты, пеня, комиссия за досрочное погашение**.
4. Учитывает просрочку, пеню, дефолт, расходы на взыскание и досрочное погашение.
5. Выводит деньги пользователя **только** на его одобренный адрес вывода.

**Ключевая особенность:** у пользователей и заёмщиков нет кошельков в программе. Пользователь переводит стейблкоин на персональный **адрес пополнения** (PDA программы), заёмщик — на **адрес погашения** кампании. Все операции от имени пользователей подписывает **операторский ключ** платформы по команде бэкенда.

---

## 2. Быстрый старт

### Где что лежит

```
programs/dala_capital/src/
├── lib.rs                  точка входа: 23 инструкции, делегируют в instructions/
├── constants.rs            сиды PDA, SCALE, базы начисления, лимиты
├── errors.rs               DalaError (коды 6000+)
├── events.rs               события, эмитятся через emit_cpi!
├── math.rs                 checked-арифметика, распределение по аккумуляторам
├── token_utils.rs          transfer_checked / close_account через token_interface
├── state/
│   ├── platform.rs         Platform — роли, разрешённые токены
│   ├── user.rs             UserAccount — адрес вывода, whitelist
│   ├── position.rs         Position — доля пользователя в кампании, расчёт выплаты
│   ├── deal.rs             Deal — параметры кампании, график, состояние учёта
│   ├── accounting.rs       вся бизнес-логика учёта (impl Deal)
│   └── accounting_tests.rs юнит-тесты учёта
└── instructions/
    ├── platform.rs         init_platform, update_platform, allow_mint, remove_mint
    ├── user.rs             create_user, set_withdrawal_address, set_whitelist_status
    ├── campaign.rs         create_campaign, add_schedule_periods, finalize_schedule, set_borrower_wallet, cancel_campaign
    ├── funding.rs          open_deposit, invest, close_funding
    ├── repayment.rs        process_repayment, mark_default, record_recovery_cost
    ├── prepayment.rs       prepay_full, prepay_partial
    └── withdraw.rs         withdraw_payout, withdraw_refund, withdraw_deposit
tests/                      интеграционные тесты (TypeScript + LiteSVM)
```

**Правило раскладки:** инструкции содержат только проверку аккаунтов, переводы токенов и эмит событий. Любая математика долга — в `state/accounting.rs`, и она покрыта юнит-тестами без блокчейна.

### Сборка и тесты

Инструменты: Anchor CLI 0.31.1, Solana (Agave) 4.2.2, Node 18+. На Windows — через WSL.

```bash
anchor build                                   # программа + IDL + TS-типы
cargo test -p dala_capital --lib               # юнит-тесты учёта
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts   # интеграционные тесты (после anchor build)
```

Интеграционные тесты не требуют валидатора: они загружают `target/deploy/dala_capital.so` в LiteSVM и управляют временем.

### Инварианты, которые нельзя сломать

1. **Деньги из волта** уходят только: заёмщику и в казну при `close_funding`, пользователям — на ATA их адреса вывода. Других путей нет, включая остатки от округления.
2. **Деньги с адреса пополнения** — только в волт своей кампании или на адрес вывода пользователя.
3. **Деньги с адреса погашения** — только в волт своей кампании или в казну в счёт расходов на взыскание.
4. **Сумма всех `pending` по позициям ≤ баланс волта.** Обеспечивается делением вниз в аккумуляторах.
5. **Выплата пользователю** требует подписи оператора, `whitelist_status == true` и получателя = ATA адреса вывода.
6. **Состояние меняется до внешнего перевода** (checks-effects-interactions). Атомарность транзакции Solana откатывает всё при ошибке перевода.
7. **Вся арифметика checked**, промежуточные значения — `u128`.

---

## 3. Роли

| Роль | Где хранится | Ключ | Права |
|---|---|---|---|
| **admin** | `Platform.admin` | мультисиг | обновление ролей и казны, разрешённые токены, создание и отмена кампаний, загрузка графика, смена кошелька заёмщика до закрытия сбора, смена адреса вывода, внесение расходов на взыскание |
| **operator** | `Platform.operator` | горячий ключ на сервере | открытие адресов пополнения, зачисление депозитов, закрытие сбора, все выводы пользователей, проведение аванса, обработка платежей в дефолте, досрочное погашение |
| **whitelist_authority** | `Platform.whitelist_authority` | обычный ключ | создание аккаунтов пользователей, переключение whitelist |
| **treasury** | `Platform.treasury` | мультисиг (владелец токен-счетов) | не подписывает транзакции программы, только получает комиссии и возмещение расходов |
| **кто угодно** | — | любой подписант | `process_repayment` до дефолта — только уже причитающееся; `mark_default` |

Оператор и whitelist authority не имеют админских прав, их ключи может заменить только admin через `update_platform`. Аварийного режима, в котором выводы доступны без оператора, нет.

---

## 4. Аккаунты и адреса

### 4.1. PDA и ATA

| Аккаунт | Сиды / вывод | Хранит данные | Кто создаёт |
|---|---|---|---|
| Platform | `["platform"]` | да | `init_platform` |
| Deal | `["deal", platform, campaign_id: u64 LE]` | да | `create_campaign` |
| UserAccount | `["user", platform, user_id: [u8;16]]` | да | `create_user` |
| Position | `["pos", deal, user_id]` | да | `invest` (первое зачисление) |
| deposit owner | `["deposit", deal, user_id]` | **нет** | — (только владелец ATA) |
| repay owner | `["repay", deal]` | **нет** | — (только владелец ATA) |
| Волт | ATA(владелец = Deal PDA, минт кампании) | токен-счёт | `create_campaign` (`init_if_needed`) |
| Адрес погашения | ATA(repay owner, минт кампании) | токен-счёт | `create_campaign` (`init_if_needed`) |
| Адрес пополнения | ATA(deposit owner, минт кампании) | токен-счёт | `open_deposit` (`init_if_needed`) |
| Токен-счёт казны | ATA(treasury, минт) | токен-счёт | `allow_mint` |
| Счёт заёмщика | ATA(кошелёк заёмщика, минт кампании) | токен-счёт | `close_funding` (`init_if_needed`) |
| Получатель вывода | ATA(адрес вывода пользователя, минт кампании) | токен-счёт | любая инструкция вывода (`init_if_needed`) |

Все ATA программы создаются через `init_if_needed`. Их адреса предсказуемы, и посторонний может создать счёт заранее. Если бы программа требовала создать его сама, посторонний так заблокировал бы создание кампании или открытие адреса. Хозяином заранее созданного ATA всё равно будет нужная PDA: адрес вычисляется из хозяина, а сменить хозяина, назначить делегата или закрыть счёт без подписи PDA нельзя. Anchor дополнительно сверяет владельца и минт. Токены, присланные заранее, в волте остаются пылью (учёт опирается на разницу балансов), а на адресе погашения засчитываются как платёж.

`user_id` — 16 случайных байт (UUID v4) из базы бэкенда. Не порядковый номер и не производная от персональных данных: сиды публичны.

Пользователю для пополнения показывается **адрес ATA адреса пополнения** или владелец `deposit owner` — биржи выводят на адрес владельца и сами выводят ATA. ATA должен быть создан заранее через `open_deposit`.

### 4.2. Platform

| Поле | Тип | Смысл |
|---|---|---|
| `admin`, `operator`, `whitelist_authority`, `treasury` | `Pubkey` | роли |
| `allowed_mints` | `Vec<Pubkey>`, до 8 | разрешённые токены |
| `campaign_count` | `u64` | счётчик созданных кампаний |
| `bump` | `u8` | |

### 4.3. UserAccount

| Поле | Тип | Смысл |
|---|---|---|
| `platform` | `Pubkey` | |
| `user_id` | `[u8; 16]` | |
| `entity_type` | `EntityType` | `Individual` / `Legal`. Хранится для бэкенда, логика его не использует |
| `withdrawal_address` | `Pubkey` | единственный адрес выплат — владелец, не токен-счёт |
| `whitelist_status` | `bool` | `false` блокирует все выводы пользователя |
| `withdrawal_address_changed_at` | `i64` | время последней смены адреса, 0 у нового аккаунта |
| `bump` | `u8` | |

### 4.4. Position

| Поле | Тип | Смысл |
|---|---|---|
| `deal`, `user_id` | | чья доля и в какой кампании |
| `principal` | `u64` | сумма взносов. После закрытия сбора не меняется; при возврате взноса обнуляется |
| `checkpoint_principal / _interest / _penalty / _prepayment_fee` | `u128` | значения аккумуляторов кампании на момент последнего вывода |
| `bump` | `u8` | |

### 4.5. Deal

**Параметры** (задаются при создании, не меняются):

| Поле | Смысл |
|---|---|
| `mint`, `vault`, `repay_account` | токен кампании, волт, ATA погашения |
| `borrower_wallet` | кошелёк заёмщика — владелец, не токен-счёт. Например, депозитный адрес на бирже |
| `soft_cap`, `hard_cap`, `min_ticket`, `max_ticket` | лимиты сбора, `max_ticket = 0` — без ограничения |
| `funding_start`, `funding_deadline` | окно сбора. **Дедлайн — начало первого процентного периода** |
| `schedule_type` | `Annuity` / `Coupon` |
| `annual_rate_bps`, `periods_per_year` | годовая ставка; периодов в году: 12, 4, 2, 1 |
| `penalty_rate_bps` | годовая ставка пени |
| `default_threshold_days` | порог дефолта в днях |
| `prepayment_fee_bps` | комиссия за досрочное погашение (только аннуитет) |
| `platform_fee_bps` | комиссия платформы с суммы сбора |
| `cancel_grace_days` | через сколько дней после дедлайна админ может отменить незакрытую кампанию |
| `periods: Vec<Period>` | график, до 60 платежей |
| `schedule_finalized` | график зафиксирован |

**Period:**

| Поле | Когда заполняется |
|---|---|
| `due_ts` | при загрузке графика |
| `principal_fraction` | при загрузке графика, масштаб `SCALE` |
| `principal_amount`, `interest_amount` | при `close_funding`; пересчитываются при частичном досрочном погашении |
| `principal_paid`, `interest_paid` | при распределении поступлений |

**Состояние учёта:**

| Поле | Смысл |
|---|---|
| `state` | `Funding`, `Failed`, `Active`, `Default`, `Repaid` |
| `total_raised` | собрано; знаменатель распределения |
| `next_period` | первый период, дата которого ещё не наступила |
| `overdue_principal`, `overdue_scheduled_interest` | неоплаченное тело и проценты наступивших платежей (до дефолта) |
| `extra_interest` | проценты по ставке займа, начисленные на просроченное тело (до дефолта) |
| `penalty` | начисленная неоплаченная пеня |
| `default_principal`, `default_interest` | долг после дефолта |
| `interest_carry`, `penalty_carry`, `last_accrual_ts` | служебные поля начисления |
| `recovery_costs`, `recovery_reimbursed` | расходы на взыскание и сколько возмещено |
| `acc_principal / _interest / _penalty / _prepayment_fee` | аккумуляторы распределения, масштаб `SCALE` |
| `carry_*` | остатки от деления аккумуляторов |

---

## 5. Жизненный цикл кампании

```
                  create_campaign
                        │
                        ▼
   add_schedule_periods ×N → finalize_schedule
                        │
                        ▼
                    Funding ──── cancel_campaign (до дедлайна или после льготного срока) ────▶ Failed
                        │                                              ▲
             close_funding (после дедлайна)                             │
                        ├── график не зафиксирован или < soft_cap ─────┘
                        ▼
                     Active ──── mark_default (просрочка ≥ порога) ──▶ Default
                        │                                                │
      все платежи / prepay_full                              полное погашение
                        ▼                                                ▼
                     Repaid ◀─────────────────────────────────────────────┘
```

| Состояние | Что доступно |
|---|---|
| `Funding` | загрузка графика, открытие адресов пополнения, `invest`, `cancel_campaign`, `close_funding` после дедлайна, `withdraw_deposit` |
| `Failed` | `withdraw_refund`, `withdraw_deposit` |
| `Active` | `process_repayment` (кто угодно — причитающееся, operator — также аванс), `mark_default`, `prepay_full` / `prepay_partial` (аннуитет), `withdraw_payout`, `withdraw_deposit` |
| `Default` | `process_repayment` (только оператор), `record_recovery_cost`, `withdraw_payout`, `withdraw_deposit`. **Конечное** — выход только в `Repaid` |
| `Repaid` | `withdraw_payout`, `withdraw_deposit`. Излишек на адресе погашения не обрабатывается |

«Просрочка» — не отдельное состояние, а вычисляемое условие внутри `Active`: `days_past_due > 0`.

---

## 6. Модель учёта

Вся логика — `state/accounting.rs`. Суммы — в минимальных единицах токена, деление всегда вниз.

### 6.1. График

- Первый процентный период начинается в `funding_deadline`, когда бы ни был вызван `close_funding`.
- Даты платежей и доли тела (`principal_fraction`, масштаб `SCALE = 10¹²`) рассчитывает бэкенд по договору займа: для аннуитета — доли, дающие равные платежи, для купона — всё тело в последнем платеже. Программа проверяет только структуру: даты возрастают, сумма долей = `SCALE`.
- При `close_funding`:
  - `principal_amount[k] = floor(total_raised × fraction[k] / SCALE)`, последний платёж добирает разницу;
  - `interest_amount[k] = floor(остаток_тела_на_начало × annual_rate_bps / (10 000 × periods_per_year))`.

### 6.2. Начисление (`accrue`)

Выполняется в начале каждой инструкции, меняющей долг. Идёт по датам с `last_accrual_ts` до `now`:

1. Наступившая дата платежа: неоплаченное тело и проценты периода переходят в `overdue_principal` и `overdue_scheduled_interest`.
2. Между датами по фактическому времени, база 360 дней:
   - на просроченное тело — проценты по ставке займа → `extra_interest`;
   - на просроченное тело и просроченные проценты — пеня по `penalty_rate_bps` → `penalty`;
   - на пеню ничего не начисляется.

**Проценты на просроченное тело и пеня — разные статьи.**

| | Проценты на просроченное тело | Пеня |
|---|---|---|
| Смысл | плата за пользование невозвращёнными деньгами | штраф за нарушение срока |
| Ставка | `annual_rate_bps` | `penalty_rate_bps` |
| База | просроченное тело | просроченное тело + просроченные проценты |
| Статья у инвестора | проценты | пеня |

Плановые проценты считаются так, будто всё внесено вовремя, поэтому без отдельных процентов невозвращённым телом заёмщик пользовался бы бесплатно. Разделение нужно и юридически: суд может снизить неустойку, но не проценты за пользование деньгами, — и для налогового учёта.

Формула: `amount × rate_bps × секунды / (10 000 × 360 × 86 400)`, остаток от деления переносится.

**В `Default`** плановые платежи не наступают: на `default_principal` капают проценты по ставке займа и пеня, на `default_interest` — пеня.

### 6.3. Распределение поступления

**До дефолта** (`allocate_active`):

1. проценты наступивших платежей, начиная с самого старого;
2. `extra_interest`;
3. тело наступивших платежей, начиная с самого старого;
4. пеня;
5. **аванс** — следующие платежи по порядку, в каждом проценты, затем тело. График не меняется.

Шаги 1–4 — уже причитающееся (`due_obligations`), его может провести кто угодно. Шаг 5 проводит только operator: посторонний вызов забирает с адреса погашения не больше причитающегося. Так деньги, присланные под досрочное погашение, нельзя превратить в аванс вызовом раньше оператора.

**В дефолте:** расходы на взыскание (→ казна, минуя волт) → проценты → тело → пеня.

Каждая часть сразу распределяется инвесторам — деньги доступны к выводу при поступлении, а не в дату платежа.

### 6.4. Дни просрочки и дефолт

- Дни просрочки считаются от даты **самого старого** не полностью оплаченного наступившего платежа.
- `mark_default` разрешён, когда дни просрочки ≥ `default_threshold_days`. Весь неоплаченный остаток тела становится `default_principal`, неоплаченные проценты — `default_interest`, плановые проценты ненаступивших периодов больше не требуются.

### 6.5. Досрочное погашение (только аннуитет)

**Полное** — в любой день:
```
просроченные проценты + просроченное тело + пеня
+ проценты текущего периода за фактические секунды на остаток тела (за вычетом аванса по процентам)
+ остаток тела (за вычетом аванса по телу)
+ floor(остаток тела × prepayment_fee_bps / 10 000)
```

**Частичное** — только в течение суток с даты последнего наступившего платежа и без аванса. Выполняется одним траншем: с адреса погашения сначала проводится уже причитающееся (сегодняшний платёж, просрочка, пеня), затем досрочно гасится тело. Тело оставшихся платежей уменьшается пропорционально, проценты пересчитываются от нового остатка, даты не меняются. Комиссия — от досрочно погашаемой суммы.

Обе операции требуют, чтобы на адрес погашения пришла ровно нужная сумма (`received == total`).

### 6.6. Распределение между инвесторами

Четыре аккумулятора в кампании: тело, проценты, пеня, комиссия за досрочное погашение. Знаменатель — `total_raised`.

```
при распределении суммы a:   acc += (a × SCALE + carry) / total_raised,   carry = остаток
доступно позиции:            pending = floor(principal × (acc − checkpoint) / SCALE)
```

Стоимость распределения не зависит от числа инвесторов. Округление вниз гарантирует `Σ pending ≤ поступления`.

---

## 7. Справочник инструкций

Во всех инструкциях с событиями последними идут аккаунты `event_authority` (PDA `["__event_authority"]`) и `program` — их требует `#[event_cpi]`, Anchor-клиент подставляет их сам при `.accounts()`.

Обозначения в колонке аккаунтов: **s** — подписант, **w** — изменяемый, **init** — создаётся инструкцией.

### 7.1. Сводка

| Инструкция | Кто вызывает | Кратко |
|---|---|---|
| `init_platform` | любой (один раз) | создать платформу и роли |
| `update_platform` | admin | сменить admin / operator / whitelist authority / казну |
| `allow_mint` | admin | разрешить токен, создать токен-счёт казны |
| `remove_mint` | admin | запретить токен для новых кампаний |
| `create_user` | whitelist authority | создать пользователя после KYC |
| `set_withdrawal_address` | admin | сменить адрес вывода, whitelist выключается |
| `set_whitelist_status` | whitelist authority | включить / выключить выводы |
| `create_campaign` | admin | создать кампанию, волт и адрес погашения |
| `add_schedule_periods` | admin | дописать платежи в график |
| `finalize_schedule` | admin | зафиксировать график |
| `set_borrower_wallet` | admin | сменить кошелёк заёмщика, пока кампания в сборе |
| `cancel_campaign` | admin | отменить сбор до дедлайна или после льготного срока |
| `open_deposit` | operator | создать адрес пополнения пользователя |
| `invest` | operator | зачислить депозит в кампанию |
| `close_funding` | operator | закрыть сбор после дедлайна |
| `process_repayment` | любой — причитающееся; operator — также аванс и в дефолте | обработать поступление на адрес погашения |
| `mark_default` | любой | перевести заём в дефолт по порогу просрочки |
| `record_recovery_cost` | admin | внести расходы на взыскание |
| `prepay_full` | operator | полное досрочное погашение |
| `prepay_partial` | operator | частичное досрочное погашение |
| `withdraw_payout` | operator | вывести выплаты по займу |
| `withdraw_refund` | operator | вернуть взнос при провале сбора |
| `withdraw_deposit` | operator | вывести незачисленное с адреса пополнения |

### 7.2. Платформа

#### `init_platform`

| | |
|---|---|
| **Назначение** | Создаёт синглтон платформы. Вызывается один раз за деплой |
| **Кто вызывает** | любой, кто платит за создание аккаунта. `admin` передаётся аргументом — деплоить можно горячим ключом, а админом сразу поставить мультисиг |
| **Аргументы** | `admin: Pubkey`, `operator: Pubkey`, `whitelist_authority: Pubkey`, `treasury: Pubkey` |
| **Аккаунты** | `payer` s,w · `platform` w,init · `system_program` |
| **Условия** | ни один ключ не `Pubkey::default()`; платформа ещё не создана |
| **Результат** | Platform с ролями и пустым списком токенов |
| **Событие** | `PlatformInitialized` |
| **Ошибки** | `InvalidPubkey` |

#### `update_platform`

| | |
|---|---|
| **Назначение** | Меняет роли и казну. `None` — оставить как есть |
| **Кто вызывает** | admin |
| **Аргументы** | `new_admin`, `new_operator`, `new_whitelist_authority`, `new_treasury`: `Option<Pubkey>` |
| **Аккаунты** | `admin` s · `platform` w |
| **Условия** | новые ключи не `Pubkey::default()` |
| **Результат** | обновлённые роли. После смены казны вызовите `allow_mint` для каждого токена, чтобы создать её токен-счета |
| **Событие** | `PlatformUpdated` |
| **Ошибки** | `Unauthorized`, `InvalidPubkey` |

#### `allow_mint`

| | |
|---|---|
| **Назначение** | Разрешает токен для кампаний и создаёт токен-счёт казны под него. Идемпотентна |
| **Кто вызывает** | admin |
| **Аргументы** | — |
| **Аккаунты** | `admin` s,w · `platform` w · `mint` · `treasury` (= `platform.treasury`) · `treasury_token` w,init_if_needed (ATA казны) · `token_program` · `associated_token_program` · `system_program` |
| **Условия** | в списке меньше 8 токенов (если токен новый) |
| **Результат** | токен в `allowed_mints`, ATA казны существует |
| **Событие** | `MintAllowed` |
| **Ошибки** | `Unauthorized`, `InvalidPubkey`, `TooManyMints` |

#### `remove_mint`

| | |
|---|---|
| **Назначение** | Убирает токен из разрешённых. Существующие кампании не затрагиваются |
| **Кто вызывает** | admin |
| **Аргументы** | `mint: Pubkey` |
| **Аккаунты** | `admin` s · `platform` w |
| **Событие** | `MintRemoved` |
| **Ошибки** | `Unauthorized` |

### 7.3. Пользователи

#### `create_user`

| | |
|---|---|
| **Назначение** | Создаёт аккаунт пользователя после KYC на бэкенде |
| **Кто вызывает** | whitelist authority (платит ренту) |
| **Аргументы** | `user_id: [u8; 16]`, `entity_type: EntityType`, `withdrawal_address: Pubkey`, `whitelist_status: bool` |
| **Аккаунты** | `whitelist_authority` s,w · `platform` · `user` w,init · `system_program` |
| **Условия** | `withdrawal_address` не `Pubkey::default()`; `user_id` ещё не занят |
| **Результат** | UserAccount; `withdrawal_address_changed_at = 0`, поэтому whitelist можно сразу ставить `true` |
| **Событие** | `UserCreated` |
| **Ошибки** | `Unauthorized`, `InvalidPubkey` |

#### `set_withdrawal_address`

| | |
|---|---|
| **Назначение** | Меняет адрес вывода пользователя |
| **Кто вызывает** | admin |
| **Аргументы** | `user_id: [u8; 16]`, `withdrawal_address: Pubkey` |
| **Аккаунты** | `admin` s · `platform` · `user` w |
| **Результат** | новый адрес, `whitelist_status = false`, `withdrawal_address_changed_at = now`. Включить выводы можно через 48 часов |
| **События** | `WithdrawalAddressChanged`, `WhitelistChanged` |
| **Ошибки** | `Unauthorized`, `InvalidPubkey` |

#### `set_whitelist_status`

| | |
|---|---|
| **Назначение** | Включает или выключает выводы пользователя |
| **Кто вызывает** | whitelist authority |
| **Аргументы** | `user_id: [u8; 16]`, `whitelist_status: bool` |
| **Аккаунты** | `whitelist_authority` s · `platform` · `user` w |
| **Условия** | `false` — всегда; `true` — если адрес не менялся или прошло ≥ 48 часов с `withdrawal_address_changed_at` |
| **Событие** | `WhitelistChanged` |
| **Ошибки** | `Unauthorized`, `AddressChangeDelayNotPassed` |

### 7.4. Кампания

#### `create_campaign`

| | |
|---|---|
| **Назначение** | Создаёт кампанию без графика, её волт и адрес погашения |
| **Кто вызывает** | admin (платит ренту) |
| **Аргументы** | `campaign_id: u64`, `params: CampaignParams` (таблица ниже) |
| **Аккаунты** | `admin` s,w · `platform` w · `deal` w,init · `mint` · `borrower_wallet` (кошелёк заёмщика, может ещё не существовать) · `repay_owner` (PDA) · `vault` w,init_if_needed (ATA кампании) · `repay_token` w,init_if_needed (ATA погашения) · `token_program` · `associated_token_program` · `system_program` |
| **Условия** | токен разрешён; кошелёк заёмщика — не нулевой ключ и не токен-счёт; `0 < soft_cap ≤ hard_cap`; `0 < min_ticket ≤ soft_cap`; `max_ticket == 0` или `≥ min_ticket`; `funding_start < funding_deadline`; `periods_per_year ∈ {1,2,4,12}`; `annual_rate_bps > 0`; `default_threshold_days > 0`; `platform_fee_bps < 10 000`; `prepayment_fee_bps < 10 000`; `cancel_grace_days > 0`; для купона `prepayment_fee_bps == 0` |
| **Результат** | Deal в `Funding`, `schedule_finalized = false`; `campaign_count += 1` |
| **Событие** | `CampaignCreated` |
| **Ошибки** | `Unauthorized`, `MintNotAllowed`, `InvalidBorrowerWallet`, `InvalidCampaignParams` |

**CampaignParams**

| Поле | Тип | Смысл |
|---|---|---|
| `soft_cap`, `hard_cap` | `u64` | минимум для успеха и максимум сбора |
| `min_ticket` | `u64` | минимальное первое вложение пользователя |
| `max_ticket` | `u64` | максимум позиции, 0 — без ограничения |
| `funding_start`, `funding_deadline` | `i64` | окно сбора; дедлайн — начало первого процентного периода |
| `schedule_type` | `ScheduleType` | `Annuity` / `Coupon` |
| `annual_rate_bps` | `u32` | годовая ставка |
| `periods_per_year` | `u8` | 12, 4, 2, 1 |
| `penalty_rate_bps` | `u32` | годовая ставка пени |
| `default_threshold_days` | `u16` | порог дефолта; клиент по умолчанию подставляет 90 для аннуитета, 30 для купона |
| `prepayment_fee_bps` | `u32` | комиссия за досрочное (аннуитет) |
| `platform_fee_bps` | `u32` | комиссия платформы с суммы сбора |
| `cancel_grace_days` | `u16` | через сколько дней после дедлайна админ может отменить незакрытую кампанию; клиент по умолчанию подставляет 7 |

#### `add_schedule_periods`

| | |
|---|---|
| **Назначение** | Дописывает платежи в конец графика. График целиком не помещается в одну транзакцию — загружайте частями по ~20 |
| **Кто вызывает** | admin |
| **Аргументы** | `campaign_id: u64`, `periods: Vec<PeriodInput { due_ts: i64, principal_fraction: u64 }>` |
| **Аккаунты** | `admin` s · `platform` · `deal` w |
| **Условия** | `Funding`; график не зафиксирован; `periods` не пуст; всего ≤ 60; даты строго возрастают, первая позже `funding_deadline` |
| **Событие** | `SchedulePeriodsAdded` |
| **Ошибки** | `Unauthorized`, `InvalidDealState`, `ScheduleFinalized`, `InvalidSchedule`, `TooManyPeriods` |

#### `finalize_schedule`

| | |
|---|---|
| **Назначение** | Фиксирует график. Без этого `invest` недоступен, а `close_funding` переводит кампанию в `Failed` |
| **Кто вызывает** | admin |
| **Аргументы** | `campaign_id: u64` |
| **Аккаунты** | `admin` s · `platform` · `deal` w |
| **Условия** | `Funding`; не зафиксирован; 1–60 платежей; сумма долей = `SCALE`; для купона все доли 0, кроме последней |
| **Событие** | `ScheduleFinalized` |
| **Ошибки** | `Unauthorized`, `InvalidDealState`, `ScheduleFinalized`, `InvalidSchedule` |

#### `cancel_campaign`

| | |
|---|---|
| **Назначение** | Отменяет сбор |
| **Кто вызывает** | admin |
| **Аргументы** | `campaign_id: u64` |
| **Аккаунты** | `admin` s · `platform` · `deal` w |
| **Условия** | `Funding`; `now < funding_deadline` **или** `now ≥ funding_deadline + cancel_grace_days`. Второе окно — страховка на случай, если сбор так и не удалось закрыть: счёт заёмщика заморожен эмитентом стейблкоина или закрыт счёт казны. В нормальной ситуации `close_funding` вызывается сразу после дедлайна, и кампания уходит из `Funding` раньше, чем откроется окно |
| **Результат** | `Failed`; инвесторы забирают взносы через `withdraw_refund` |
| **Событие** | `CampaignCancelled` |
| **Ошибки** | `Unauthorized`, `InvalidDealState`, `CancelGracePeriodActive` |

#### `set_borrower_wallet`

| | |
|---|---|
| **Назначение** | Меняет кошелёк заёмщика: заёмщик потерял доступ к кошельку или биржа сменила депозитный адрес |
| **Кто вызывает** | admin |
| **Аргументы** | `campaign_id: u64` |
| **Аккаунты** | `admin` s · `platform` · `deal` w · `borrower_wallet` (новый кошелёк) |
| **Условия** | `Funding` — в том числе после дедлайна, до закрытия сбора; новый кошелёк не нулевой ключ и не токен-счёт |
| **Результат** | `deal.borrower_wallet` = новый кошелёк; `close_funding` переведёт деньги на его ATA |
| **Событие** | `BorrowerWalletChanged` (старый и новый адрес) |
| **Ошибки** | `Unauthorized`, `InvalidDealState`, `InvalidBorrowerWallet` |

Это доверенное действие: мультисиг админа может перенаправить сумму займа. Каждая смена видна в событиях.

### 7.5. Сбор

#### `open_deposit`

| | |
|---|---|
| **Назначение** | Создаёт ATA адреса пополнения пользователя для кампании. Идемпотентна |
| **Кто вызывает** | operator (платит ренту) |
| **Аргументы** | `campaign_id: u64`, `user_id: [u8; 16]` |
| **Аккаунты** | `operator` s,w · `platform` · `deal` · `user` · `deposit_owner` (PDA) · `mint` · `deposit_token` w,init_if_needed · `token_program` · `associated_token_program` · `system_program` |
| **Условия** | `Funding`; пользователь существует |
| **Событие** | `DepositOpened` |
| **Ошибки** | `Unauthorized`, `InvalidDealState`, `WrongMint` |

#### `invest`

| | |
|---|---|
| **Назначение** | Переводит поступление с адреса пополнения в волт и зачисляет в позицию. Вызывается на каждое поступление после проверки отправителя на бэкенде |
| **Кто вызывает** | operator |
| **Аргументы** | `campaign_id: u64`, `user_id: [u8; 16]` |
| **Аккаунты** | `operator` s,w · `platform` · `deal` w · `user` · `position` w,init_if_needed · `deposit_owner` · `deposit_token` w · `vault` w · `mint` · `token_program` · `system_program` |
| **Условия** | `Funding`; график зафиксирован; `funding_start ≤ now < funding_deadline`; баланс адреса пополнения > 0; если позиция пустая — баланс ≥ `min_ticket` |
| **Результат** | зачисляется `min(баланс, hard_cap − total_raised, max_ticket − principal)`; остаток остаётся на адресе пополнения |
| **Событие** | `Invested` |
| **Ошибки** | `Unauthorized`, `InvalidDealState`, `ScheduleNotFinalized`, `FundingNotStarted`, `FundingClosed`, `NothingToProcess`, `BelowMinTicket`, `NoCapacity`, `NothingReceived` |

#### `close_funding`

| | |
|---|---|
| **Назначение** | Закрывает сбор |
| **Кто вызывает** | только operator — после того, как бэкенд подтвердил у заёмщика актуальность кошелька. Иначе посторонний мог бы отправить сумму займа на адрес, к которому заёмщик потерял доступ. Платит за создание ATA заёмщика, если её нет |
| **Аргументы** | `campaign_id: u64` |
| **Аккаунты** | `operator` s,w · `platform` · `deal` w · `vault` w · `mint` · `borrower_wallet` (= `deal.borrower_wallet`) · `payout_destination` w,init_if_needed (ATA заёмщика) · `treasury_token` w (владелец = казна, минт кампании) · `token_program` · `associated_token_program` · `system_program` |
| **Условия** | `Funding` и `now ≥ funding_deadline` |
| **Результат** | ATA заёмщика создаётся, если её нет — например, биржа закрыла пустой депозитный счёт. График не зафиксирован или `total_raised < soft_cap` → `Failed`. Иначе: `floor(total_raised × platform_fee_bps / 10 000)` → казна, остаток → заёмщику; рассчитываются суммы графика; `Active`, начисление с `funding_deadline`. Переводится ровно `total_raised`, лишнее остаётся в волте. Если перевод невозможен (счёт заёмщика заморожен), транзакция падает, кампания остаётся в `Funding` — её можно отменить после льготного срока |
| **События** | `FundingClosed` или `FundingFailed` |
| **Ошибки** | `InvalidDealState`, `FundingStillOpen`, `Unauthorized`, `WrongMint` |

### 7.6. Погашение и дефолт

#### `process_repayment`

| | |
|---|---|
| **Назначение** | Обрабатывает деньги на адресе погашения |
| **Кто вызывает** | в `Active` — любой, но только уже причитающееся (просрочка и пеня); аванс в счёт будущих платежей — только operator. В `Default` — только operator, чтобы расходы на взыскание успели быть внесены до распределения |
| **Аргументы** | `campaign_id: u64` |
| **Аккаунты** | `caller` s · `platform` · `deal` w · `repay_owner` · `repay_token` w · `vault` w · `treasury_token` w · `mint` · `token_program` |
| **Условия** | `Active` или `Default`; на адресе погашения есть деньги; для постороннего вызова в `Active` — есть причитающееся |
| **Результат** | начисление до `now`. operator забирает не больше всех оставшихся обязательств, посторонний — не больше причитающегося; остальное остаётся на адресе погашения. Распределение — раздел 6.3. При полном погашении → `Repaid` |
| **Событие** | `RepaymentProcessed` (разбивка: расходы, проценты, тело, пеня, аванс, флаг `repaid`) |
| **Ошибки** | `InvalidDealState`, `Unauthorized`, `NothingToProcess`, `NothingReceived` |

#### `mark_default`

| | |
|---|---|
| **Назначение** | Переводит заём в дефолт |
| **Кто вызывает** | любой подписант |
| **Аргументы** | `campaign_id: u64` |
| **Аккаунты** | `caller` s · `platform` · `deal` w |
| **Условия** | `Active`; после начисления дни просрочки ≥ `default_threshold_days` |
| **Результат** | `Default`; весь остаток тела просрочен; плановые платежи прекращаются |
| **Событие** | `DefaultMarked` |
| **Ошибки** | `InvalidDealState`, `DefaultThresholdNotReached` |

#### `record_recovery_cost`

| | |
|---|---|
| **Назначение** | Вносит фактически оплаченные платформой расходы на взыскание |
| **Кто вызывает** | admin |
| **Аргументы** | `campaign_id: u64`, `amount: u64` |
| **Аккаунты** | `admin` s · `platform` · `deal` w |
| **Условия** | `Default`; `amount > 0`. Ограничений на сумму нет |
| **Результат** | `recovery_costs += amount`; возмещаются первыми из следующих поступлений |
| **Событие** | `RecoveryCostRecorded` |
| **Ошибки** | `Unauthorized`, `InvalidDealState`, `InvalidAmount` |

### 7.7. Досрочное погашение

Аккаунты обеих инструкций: `operator` s · `platform` · `deal` w · `repay_owner` · `repay_token` w · `vault` w · `mint` · `token_program`.

#### `prepay_full`

| | |
|---|---|
| **Назначение** | Полное досрочное погашение по заявке заёмщика |
| **Кто вызывает** | operator |
| **Аргументы** | `campaign_id: u64` |
| **Условия** | `Active`; аннуитет; на адресе погашения ≥ суммы к оплате (раздел 6.5); поступает ровно эта сумма |
| **Результат** | `Repaid`; тело → аккумулятор тела, проценты → процентов, комиссия → комиссии за досрочное |
| **Событие** | `EarlyRepayment { full: true }` |
| **Ошибки** | `Unauthorized`, `InvalidDealState`, `PrepaymentNotAllowed`, `NothingToProcess`, `InsufficientRepayBalance`, `InsufficientReceived` |

#### `prepay_partial`

| | |
|---|---|
| **Назначение** | Частичное досрочное погашение тела одним траншем вместе с сегодняшним платежом |
| **Кто вызывает** | operator |
| **Аргументы** | `campaign_id: u64`, `principal_amount: u64` |
| **Условия** | `Active`; аннуитет; `now` в пределах суток с даты последнего наступившего платежа и впереди есть платежи; нет аванса; `0 < principal_amount < остаток тела`; на адресе погашения ≥ причитающееся + `principal_amount` + комиссия |
| **Результат** | сначала проводится причитающееся (сегодняшний платёж, просрочка, пеня), затем досрочная часть: тело оставшихся платежей уменьшается пропорционально, проценты пересчитываются, даты прежние |
| **Событие** | `EarlyRepayment { full: false }` |
| **Ошибки** | `Unauthorized`, `InvalidDealState`, `PrepaymentNotAllowed`, `NotPaymentDate`, `HasAdvance`, `InvalidPrepaymentAmount`, `InsufficientRepayBalance`, `InsufficientReceived` |

### 7.8. Выводы

Общие правила: подписывает только operator по нажатию кнопки пользователем; получатель — только ATA адреса вывода пользователя (создаётся за счёт оператора, если нет); требуется `whitelist_status = true`; выводится вся доступная сумма; состояние меняется до перевода.

Аккаунты `withdraw_payout` и `withdraw_refund`: `operator` s,w · `platform` · `deal` · `user` · `position` w · `withdrawal_owner` (= `user.withdrawal_address`) · `destination` w,init_if_needed · `vault` w · `mint` · `token_program` · `associated_token_program` · `system_program`.

#### `withdraw_payout`

| | |
|---|---|
| **Назначение** | Выводит всё распределённое пользователю по займу |
| **Кто вызывает** | operator |
| **Аргументы** | `campaign_id: u64`, `user_id: [u8; 16]` |
| **Условия** | whitelist включён; `Active`, `Default` или `Repaid`; доступно > 0 |
| **Результат** | сумма по четырём статьям → адрес вывода; чекпоинты позиции = аккумуляторы кампании |
| **Событие** | `PayoutWithdrawn` (тело, проценты, пеня, комиссия за досрочное, итого) |
| **Ошибки** | `Unauthorized`, `WhitelistDisabled`, `InvalidDealState`, `NothingToWithdraw`, `InvalidPubkey` |

#### `withdraw_refund`

| | |
|---|---|
| **Назначение** | Возвращает взнос при несостоявшейся кампании |
| **Кто вызывает** | operator |
| **Аргументы** | `campaign_id: u64`, `user_id: [u8; 16]` |
| **Условия** | whitelist включён; `Failed`; `position.principal > 0` |
| **Результат** | `principal` → адрес вывода, `principal = 0` |
| **Событие** | `RefundWithdrawn` |
| **Ошибки** | `Unauthorized`, `WhitelistDisabled`, `InvalidDealState`, `NothingToWithdraw`, `InvalidPubkey` |

#### `withdraw_deposit`

| | |
|---|---|
| **Назначение** | Выводит всё, что лежит на адресе пополнения и не зачислено в кампанию |
| **Кто вызывает** | operator |
| **Аргументы** | `campaign_id: u64`, `user_id: [u8; 16]` |
| **Аккаунты** | `operator` s,w · `platform` · `deal` · `user` · `deposit_owner` · `deposit_token` w · `withdrawal_owner` · `destination` w,init_if_needed · `mint` · `token_program` · `associated_token_program` · `system_program` |
| **Условия** | whitelist включён; баланс адреса пополнения > 0; в любом состоянии кампании |
| **Результат** | весь баланс → адрес вывода. Если сбор уже не идёт и ATA пополнения опустел — он закрывается, рента возвращается оператору |
| **Событие** | `DepositWithdrawn` (флаг `closed`) |
| **Ошибки** | `Unauthorized`, `WhitelistDisabled`, `NothingToWithdraw`, `InvalidPubkey` |

---

## 8. События

Эмитятся через `emit_cpi!`: данные события передаются инструкцией в `event_authority` и видны во внутренних инструкциях транзакции. Индексатору бэкенда достаточно разбирать внутренние инструкции программы.

| Событие | Когда | Поля |
|---|---|---|
| `PlatformInitialized` | `init_platform` | `admin`, `operator`, `whitelist_authority`, `treasury` |
| `PlatformUpdated` | `update_platform` | те же, после изменения |
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
| `FundingClosed` | `close_funding`, успех | `campaign_id`, `total_raised`, `platform_fee`, `payout_amount` |
| `FundingFailed` | `close_funding`, провал | `campaign_id`, `total_raised` |
| `RepaymentProcessed` | `process_repayment` | `campaign_id`, `received`, `recovery`, `interest`, `principal`, `penalty`, `advance`, `repaid` |
| `DefaultMarked` | `mark_default` | `campaign_id`, `days_past_due`, `principal`, `interest`, `penalty` |
| `RecoveryCostRecorded` | `record_recovery_cost` | `campaign_id`, `amount`, `total_costs` |
| `EarlyRepayment` | `prepay_full`, `prepay_partial` | `campaign_id`, `full`, `principal`, `interest`, `penalty`, `prepayment_fee`, `total` |
| `PayoutWithdrawn` | `withdraw_payout` | `campaign_id`, `user_id`, `principal`, `interest`, `penalty`, `prepayment_fee`, `amount` |
| `RefundWithdrawn` | `withdraw_refund` | `campaign_id`, `user_id`, `amount` |
| `DepositWithdrawn` | `withdraw_deposit` | `campaign_id`, `user_id`, `amount`, `closed` |

В `RepaymentProcessed`: `received = recovery + interest + principal + penalty`. Поле `advance` — не отдельная статья, а часть `interest + principal`, ушедшая в счёт будущих платежей. В `EarlyRepayment` и `PayoutWithdrawn` статьи в сумме дают `total` и `amount` соответственно. Все суммы в событиях совпадают с фактическими переводами до единицы (проверяется в `tests/random.ts`).

Отдельного события о наступлении платежа нет: оно происходит внутри начисления. Текущее состояние долга читайте из аккаунта `Deal`.

---

## 9. Ошибки

Код = 6000 + порядковый номер в `DalaError`.

| Код | Имя | Когда |
|---|---|---|
| 6000 | `InvalidPubkey` | нулевой ключ; аккаунт не совпадает с ожидаемым адресом (волт, адрес вывода, ATA погашения) |
| 6001 | `Unauthorized` | подписант не имеет роли; не тот владелец токен-счёта казны |
| 6002 | `MintNotAllowed` | токен не в `allowed_mints` |
| 6003 | `TooManyMints` | больше 8 разрешённых токенов |
| 6004 | `WrongMint` | минт аккаунта не совпадает с минтом кампании |
| 6005 | `InvalidCampaignParams` | параметры `create_campaign` не прошли проверку |
| 6006 | `InvalidSchedule` | даты не возрастают, первая не позже дедлайна, сумма долей ≠ `SCALE`, купон с телом не в последнем платеже |
| 6007 | `ScheduleFinalized` | график уже зафиксирован |
| 6008 | `ScheduleNotFinalized` | `invest` до фиксации графика |
| 6009 | `TooManyPeriods` | больше 60 платежей |
| 6010 | `InvalidDealState` | инструкция недоступна в текущем состоянии кампании |
| 6011 | `FundingNotStarted` | `invest` раньше `funding_start` |
| 6012 | `FundingClosed` | `invest` или `cancel_campaign` после дедлайна |
| 6013 | `FundingStillOpen` | `close_funding` до дедлайна |
| 6014 | `BelowMinTicket` | первое вложение меньше `min_ticket` |
| 6015 | `NoCapacity` | достигнут `hard_cap` или `max_ticket` |
| 6016 | `NothingReceived` | перевод не изменил баланс получателя |
| 6017 | `InsufficientReceived` | досрочное погашение: пришло меньше нужной суммы |
| 6018 | `NothingToWithdraw` | выводить нечего |
| 6019 | `NothingToProcess` | нечего зачислять или обрабатывать |
| 6020 | `InsufficientRepayBalance` | на адресе погашения не хватает на досрочное погашение |
| 6021 | `WhitelistDisabled` | вывод при `whitelist_status = false` |
| 6022 | `AddressChangeDelayNotPassed` | включение whitelist раньше 48 часов после смены адреса |
| 6023 | `DefaultThresholdNotReached` | просрочка меньше порога |
| 6024 | `PrepaymentNotAllowed` | досрочное погашение купона |
| 6025 | `NotPaymentDate` | частичное досрочное не в дату платежа или без будущих платежей |
| 6026 | `HasOverdue` | внутренняя проверка частичного досрочного; через `prepay_partial` не возникает — просрочка и пеня гасятся в той же операции |
| 6027 | `HasAdvance` | частичное досрочное при авансе |
| 6028 | `InvalidPrepaymentAmount` | сумма частичного досрочного вне `(0, остаток тела)` |
| 6029 | `InvalidAmount` | нулевая сумма расходов на взыскание |
| 6030 | `MathOverflow` | переполнение или деление на ноль |
| 6031 | `InvalidBorrowerWallet` | кошелёк заёмщика — нулевой ключ или токен-счёт |
| 6032 | `CancelGracePeriodActive` | отмена после дедлайна раньше окончания льготного срока |

---

## 10. Сценарии для бэкенда

### Запуск платформы
1. `init_platform` — admin, operator, whitelist authority, казна.
2. `allow_mint` для USDC и USDT.

### Новый пользователь
1. KYC на бэкенде, генерация `user_id` (UUID v4).
2. `create_user` с адресом вывода и `whitelist_status = true`.

### Кампания
1. `create_campaign` с параметрами из договора займа. Кошелёк заёмщика — адрес его кошелька или депозитный адрес USDC/USDT в сети Solana на бирже, **не** адрес токен-счёта. Биржи с обязательным memo для этого не подходят: перевод из контракта идёт без memo.
2. Бэкенд рассчитывает даты и доли тела, `add_schedule_periods` частями по ~20.
3. `finalize_schedule`.

### Инвестирование
1. Пользователь выбирает кампанию → `open_deposit` → показать адрес пополнения.
2. Бэкенд следит за ATA пополнения (вебхук RPC-провайдера или подписка на аккаунт).
3. На каждое поступление: AML-проверка отправителя → `invest`.
4. Если зачислилось не всё (`hard_cap`, `max_ticket`) или сумма меньше `min_ticket` — остаток ждёт на адресе, пользователь выводит его кнопкой (`withdraw_deposit`).

### Закрытие сбора
1. Перед дедлайном — попросить заёмщика подтвердить, что кошелёк актуален: он мог потерять к нему доступ, биржа могла сменить депозитный адрес.
2. Адрес подтверждён → оператор сразу вызывает `close_funding`.
3. Адрес изменился → заёмщик сообщает новый, admin вызывает `set_borrower_wallet`, затем оператор закрывает сбор.

Закрыть сбор может только оператор — посторонний не отправит деньги на устаревший адрес. Проценты в любом случае идут с дедлайна, поэтому опоздание с вызовом стоит заёмщику денег.

Если `close_funding` падает на переводе заёмщику (счёт заморожен) и за `cancel_grace_days` исправить это не удалось — `cancel_campaign`, затем инвесторы забирают взносы через `withdraw_refund`.

### Обслуживание займа
1. Заёмщик переводит платёж на адрес погашения кампании до даты платежа.
2. Бэкенд сразу вызывает `process_repayment` ключом оператора — так проводится и платёж, внесённый заранее. Посторонний вызов, в том числе самого заёмщика, проводит только наступившие платежи и просрочку: если бэкенд недоступен, поступление всё равно можно провести в дату платежа, и пеня не начислится.
3. Пользователь нажимает «вывести» → `withdraw_payout`.

### Досрочное погашение
Заёмщик заказывает в кабинете, переводит сумму на адрес погашения, оператор вызывает `prepay_full` или `prepay_partial`. Обе инструкции сами проводят уже причитающееся, поэтому сегодняшний платёж и досрочную часть заёмщик переводит одним траншем. Посторонний `process_repayment` не может превратить эти деньги в аванс: он забирает только причитающееся. Оператор же не должен вызывать `process_repayment` раньше досрочного погашения — иначе излишек станет авансом, частичное досрочное станет недоступно, а при полном заёмщик переплатит проценты.

### Дефолт и взыскание
1. Когда просрочка достигла порога — `mark_default` (может вызвать кто угодно).
2. Платформа оплачивает юристов, госпошлину → `record_recovery_cost` **до** обработки поступлений.
3. Деньги взыскания приходят на адрес погашения → оператор вызывает `process_repayment`.

### Ключи бэкенда для обработки поступлений
Контракт не знает, зачем деньги пришли на адрес погашения, — это знает только бэкенд по заявке заёмщика. Рекомендуемая схема:

| Ключ | Когда используется | Что проводит |
|---|---|---|
| **рядовой ключ** (не оператор) | штатная обработка каждого поступления | только уже причитающееся; всё сверх остаётся на адресе |
| **оператор** | только по явному действию заёмщика | аванс (`process_repayment`) или досрочное погашение (`prepay_partial`, `prepay_full`) |

Так деньги сверх платежа по умолчанию ждут на адресе, пока заёмщик не укажет, что это: аванс или досрочное погашение.

### Смена адреса вывода
1. `set_withdrawal_address` → выводы заблокированы, пользователю уведомление.
2. Через 48 часов → `set_whitelist_status(true)`.

---

## 11. Ограничения и особенности

- **Чужие токены** на адресах пополнения и погашения и **переплата после полного погашения** программой не обрабатываются и остаются на адресах.
- **Пыль от округления и токены, присланные в волт напрямую**, остаются в волте навсегда: инструкции вывода из волта, кроме выплат пользователям, нет намеренно. Каждый вывод округляет выплату вниз меньше чем на 1 единицу (микро-USDC) по каждой из четырёх статей. Инвестор, выводивший 10 раз, недополучает не больше ~40 микро-USDC.
- **Кошелёк заёмщика** меняет только admin и только пока кампания в сборе. После закрытия сбора он не нужен. Если исправить адрес не удалось или счёт заморожен — кампания отменяется после льготного срока, взносы возвращаются инвесторам.
- **Аварийного вывода нет.** Если одновременно недоступны оператор и все подписанты мультисига, средства остаются в программе.
- **Позиции не закрываются.** Это позволяет распределять деньги от взыскания в любой момент.
- **Лимиты:** 60 платежей в графике, 8 разрешённых токенов. Изменение требует новой версии программы: размер аккаунтов задаётся при создании.
- **`entity_type`** хранится, но программа его не использует; удержание налогов не реализовано.
- **Биржи и PDA.** Адреса пополнения — off-curve PDA. Binance, Coinbase, OKX, Kraken, Backpack, Swissborg выводят на такие адреса; Bybit и Bitget — нет, их пользователям нужен промежуточный кошелёк. Поддержка зависит от региона.
- **Права на обновление программы** перед mainnet передаются мультисигу с таймлоком — это делается при деплое, код не меняется.

---

## 12. Тесты

### Юнит-тесты учёта — `programs/dala_capital/src/state/accounting_tests.rs`

Работают прямо со структурой `Deal`, без блокчейна. Эталонные значения — заём 100 000 USDC, 12 месяцев, 10% годовых, пеня 20%.

| Тест | Что проверяет |
|---|---|
| `annuity_schedule_matches_reference` | платёж ≈ 8 791,59, проценты 833,33, остаток после 6 платежей ≈ 51 244,54, тело = сумме сбора |
| `coupon_schedule_matches_reference` | купоны 833,33, последний платёж 100 833,33 |
| `schedule_validation_rejects_bad_fractions` | сумма долей ≠ `SCALE`, тело купона не в последнем платеже |
| `rounding_leaves_no_principal_behind` | тело графика ровно равно сумме сбора при «неудобной» сумме |
| `underpayment_goes_to_interest_then_principal` | недоплата: сначала проценты, недостача — просроченное тело |
| `penalty_and_interest_accrue_on_overdue` | пеня за 10 дней ≈ 21,06 и проценты на просроченное тело |
| `next_payment_first_closes_overdue_and_penalty` | следующий платёж закрывает просрочку и пеню, остаток — аванс |
| `overpayment_is_advance_for_next_payments` | 20 000 закрывают платежи 1–2 и ≈ 2 416,82 платежа 3 |
| `single_underpayment_never_reaches_default` | разовая недоплата не приводит к дефолту |
| `systematic_underpayment_defaults_around_month_seven` | 5 000 в месяц вместо 8 791,59 → порог 90 дней около 7-го месяца |
| `full_payment_by_schedule_repays_loan` | оплата по графику погашает заём |
| `due_obligations_exclude_future_payments` | до даты платежа ничего не причитается; ненаступившие платежи не входят в причитающееся |
| `default_accelerates_principal_and_keeps_accruing` | дефолт ускоряет тело, проценты и пеня продолжают расти |
| `default_distribution_order_and_settlement` | порядок в дефолте, погашение требует возмещения расходов |
| `full_prepayment_on_payment_date` | полное досрочное: остаток ≈ 51 244,54, комиссия 1% |
| `full_prepayment_charges_interest_for_actual_days` | проценты за 15 дней ≈ 213,52 |
| `partial_prepayment_reduces_payments_keeps_dates` | 20 000 досрочно → платёж ≈ 5 360, даты прежние |
| `partial_prepayment_in_one_transfer_settles_todays_payment_first` | один транш: сначала сегодняшний платёж, затем досрочная часть, аванса нет |
| `partial_prepayment_rejected_*` | вне даты платежа, при авансе, при просрочке |
| `distribution_is_pro_rata` | 50/30/20 → проценты 416,67 / 250 / 166,67 |
| `payouts_never_exceed_inflows` | инвариант: выплаты ≤ поступлений при неровных суммах |

### Фаззинг учёта — `programs/dala_capital/src/state/fuzz_tests.rs`

2 000 случайных сценариев. Каждый: случайная кампания (аннуитет или купон, 1–60 платежей, 1, 2, 4 или 12 периодов в году, ставка, пеня, порог дефолта, комиссия за досрочное, сумма сбора, 1–5 инвесторов) и до 120 случайных операций со случайными прыжками во времени: платежи оператора и посторонних, частичное и полное досрочное погашение, перевод в дефолт, расходы на взыскание, взыскание. В конце заём доводится до погашения.

После каждого шага проверяется:
- взятое у заёмщика полностью разложено: инвесторам по статьям плюс возмещение расходов;
- посторонний вызов не создаёт аванс;
- по каждой статье выплаты позициям не превышают поступлений; нераспределённое — не больше `число позиций + total_raised / SCALE + 1` единиц: округление вниз по позициям плюс остаток аккумулятора, который переносится в следующее распределение;
- причитающееся не больше всего долга; тела не выплачено больше собранного, при погашении — ровно всё тело;
- частичное досрочное падает только с `NotPaymentDate`, `HasAdvance`, `InvalidPrepaymentAmount`.

При падении сообщение содержит seed сценария.

Чтобы фаззинг не проходил вхолостую, тест собирает статистику выполненных операций и падает, если какая-то ветка выполнялась редко. Типичный прогон: ~30 000 шагов, ~7 000 платежей оператора и ~1 700 посторонних, ~5 500 авансов, ~470 успешных и ~1 200 отклонённых частичных досрочных, ~650 полных досрочных, ~630 дефолтов и ~4 000 поступлений в дефолте; графики доходят до 60-го платежа.

### Интеграционные тесты — `tests/dala_capital.ts`

Программа из `target/deploy` загружается в LiteSVM, время перематывается через `setClock`. Хелперы — `tests/helpers.ts`: сборка инструкций Anchor-клиентом, отправка через `@solana/kit`, прямая запись токен-счетов для имитации переводов с бирж.

| Блок | Сценарии |
|---|---|
| Платформа и роли | `update_platform` только админом; старый оператор после замены отклоняется; кампания в запрещённом токене |
| Пользователи | смена адреса вывода блокирует выводы на 48 часов; whitelist переключает только whitelist authority |
| Сбор | ATA заёмщика создаётся при закрытии; замороженный счёт заёмщика → отмена после льготного срока и возврат взносов; токен-счёт нельзя указать кошельком заёмщика; комиссия в казну и ровно собранная сумма заёмщику, лишнее в волте; `min_ticket`; частичное зачисление сверх `hard_cap` и вывод остатка; `max_ticket`; без фиксации графика; отмена до дедлайна и возврат взносов; закрытие пустого ATA пополнения после провала |
| Погашение | распределение 50/30/20 и выводы; вывод только на адрес вывода и при включённом whitelist; пустой адрес погашения |
| Обработка поступлений | до даты платежа посторонний не проводит, оператор проводит авансом; посторонний проводит только причитающееся, остаток уходит в частичное досрочное |
| Дефолт | порог 90 дней; обработка только оператором; расходы на взыскание в казну первыми |
| Досрочное | частичное, затем полное с выплатой инвесторам всего поступившего; частичное одним траншем с сегодняшним платежом; частичное вне даты; купон без досрочного |

### Сквозные сценарии — `tests/scenarios.ts`

| Блок | Сценарии |
|---|---|
| Полные циклы | аннуитет: 12 платежей по графику → «Погашен», инвесторы получают ровно тело и проценты, после погашения обработка отклоняется; купон: 11 купонов и последний платёж с телом; дефолт с полным взысканием → «Погашен», расходы возмещены казне, излишек остаётся на адресе погашения; пеня за 10 дней — сумма пени и процентов на просрочку сходится с формулой, пеня уходит инвесторам отдельной статьёй |
| Подмена аккаунтов | зачисление в волт или с адреса пополнения другой кампании; обработка поступления с адреса погашения другой кампании; выплата по чужой позиции или из волта другой кампании; закрытие сбора с чужим счётом казны или чужим кошельком заёмщика |

### Сочетания условий — `tests/edge_cases.ts`

| Блок | Сценарии |
|---|---|
| Досрочное погашение | полное при авансе — аванс зачитывается; полное при просрочке и пене — сумма совпадает с формулой до единицы; частичное, когда просрочен и прошлый платёж; в дефолте недоступно |
| Whitelist, адрес, казна | выключенный whitelist блокирует возврат взноса и вывод депозита; после смены адреса и 48 часов выплата идёт на новый адрес, старый отклоняется; после смены казны старый счёт отклоняется, после `allow_mint` комиссия идёт новой казне |
| Кошелёк заёмщика | посторонний не может закрыть сбор; после дедлайна admin меняет кошелёк, оператор закрывает сбор на новый адрес; сменить кошелёк может только admin, не на токен-счёт и только в сборе |
| Дефолт и распределение | купон: порог дефолта 30 дней; семь инвесторов с неудобными суммами и выводами в разные месяцы полного цикла |

### Операционные сценарии — `tests/operations.ts`

| Блок | Сценарии |
|---|---|
| Операции | частичное взыскание в дефолте, вывод, ещё поступление — второй вывод получает только прирост; смена оператора посреди займа — новый выводит и обрабатывает дефолт, старый отклоняется; депозит после закрытия сбора возвращается, адрес пополнения закрывается |
| Просрочка и дефолт: точные суммы | Тест повторяет начисление программы (проценты на просроченное тело, пеня, перенос остатков от деления) и сверяет события до единицы. Заём 100 000, 12 месяцев, 10%, пеня 20%. **Три платежа пропущены**, через 10 дней после третьего всё закрыто одним переводом: посторонний проводит ровно причитающееся — 27 229,47, из них проценты на просрочку 266,38 и пеня 588,32; остаток перевода ждёт следующей даты; займ возвращается в график и погашается без новой пени. **Расходы на взыскание 5 000 больше взысканного:** первые 3 000 уходят в казну, инвесторам ничего; из следующих 4 000 — 2 000 в казну, 2 000 инвесторам. **Дефолт после четырёх оплаченных платежей:** к взысканию остаток тела 67 766,85, проценты наступивших платежей 5–8 с процентами на просрочку 2 258,90, пеня 883,74; проценты платежей 9–12 не требуются; после полного взыскания инвесторы вместе получают всё до 12 единиц округления |
| Границы по времени | зачисление до старта / за секунду до дедлайна / в дедлайн; платёж ровно в секунду даты без пени и через секунду с пеней; дефолт за секунду до порога и ровно на пороге; частичное досрочное в последнюю секунду суток даты платежа и через секунду |

### Лимиты — `tests/limits.ts`

График на 60 платежей. Размер транзакций: создание кампании — 622 байта, загрузка по 20 платежей — 613 байт при лимите 1 232.

Потребление вычислений в худших случаях, при лимите по умолчанию 200 000 единиц:

| Операция | Единиц |
|---|---|
| `process_repayment` после всех 60 наступивших платежей | 129 295 |
| `prepay_full` после 59 пропущенных платежей | 127 190 |
| `mark_default` после всех 60 дат | 111 020 |
| `close_funding` | 106 716 |
| `prepay_partial` с пересчётом 59 платежей | 99 236 |
| `withdraw_payout` | 77 072 |
| `process_repayment` в дефолте | 49 613 |

Запрашивать дополнительный лимит вычислений не нужно.

### Проверки ввода и состояний — `tests/validation.ts`

| Блок | Сценарии |
|---|---|
| Параметры кампании | 15 некорректных сочетаний → `InvalidCampaignParams` (soft/hard cap, тикеты, старт ≥ дедлайна, периоды в году ∉ {1, 2, 4, 12}, нулевые ставка / порог / льготный срок, комиссии 100%, купон с комиссией за досрочное); граничные значения проходят; не admin, повторный id, нулевой кошелёк заёмщика |
| Загрузка графика | пустая порция; дата не позже дедлайна; даты не по возрастанию внутри порции и между порциями; 61-й платёж; фиксация без платежей, с суммой долей больше или меньше `SCALE`, купон с телом не в последнем платеже; изменения после фиксации; чужой admin; зачисление до фиксации |
| Не то состояние | для сбора, активного займа, провала, дефолта и погашения — каждая неподходящая инструкция отклоняется с `InvalidDealState` (или `FundingStillOpen`), балансы не меняются; в погашенном займе выплата работает; нулевые суммы → `NothingToProcess`, `InvalidPrepaymentAmount`, `InvalidAmount` |
| Разрешённые токены | 8 токенов проходят, 9-й → `TooManyMints`; повторное разрешение не дублирует; после удаления место освобождается; удаляет только admin; кампания в удалённом токене продолжает работать |
| Адреса, созданные заранее | адрес пополнения, созданный и пополненный посторонним до `open_deposit`, — открытие проходит, деньги зачисляются; счета вывода и заёмщика, созданные заранее, не мешают; волт и адрес погашения, созданные и пополненные до `create_campaign`, — кампания создаётся, заёмщику уходит ровно собранное, лишнее в волте остаётся пылью, токены на адресе погашения засчитываются как платёж |

### Случайные сценарии через программу — `tests/random.ts`

Работает не со структурой, как фаззинг учёта, а с настоящей программой в LiteSVM, поэтому ловит ошибки в инструкциях, переводах и событиях. По умолчанию 40 сценариев с seed 20260918; переопределяются через `RANDOM_SEED` и `RANDOM_SCENARIOS`.

Каждый сценарий состоит из трёх частей:
1. Случайная кампания: аннуитет или купон, 1–24 платежа, ставка, пеня, порог дефолта, комиссии, `max_ticket`, 1–6 инвесторов с «неудобными» суммами, иногда провал сбора.
2. Профиль заёмщика: исправный, с перебоями или почти не платящий.
3. 20–90 случайных операций со скачками во времени. В конце заём доводится до погашения, инвесторы выводят всё.

Каждая транзакция проверяется:
- **успешная** — ровно одно событие, статьи в нём складываются в итог (для `RepaymentProcessed` — `received = recovery + interest + principal + penalty`, `advance` ≤ `interest + principal`), движение по каждому токен-счёту (волт, адрес погашения, заёмщик, казна, адреса пополнения и вывода) совпадает с событием до единицы, остальные счета не меняются; выплата в `PayoutWithdrawn` по каждой статье равна рассчитанной вне программы по аккумуляторам и контрольным точкам; комиссия платформы = `floor(total_raised × bps / 10 000)`;
- **отклонённая** — только с ожидаемой для этой операции ошибкой, балансы не меняются.

После каждого шага проверяется:
- сумма всех токен-счетов равна всему, что пришло извне;
- сумма позиций равна `total_raised`;
- волт покрывает причитающееся инвесторам, лишнее не больше `4 × (позиций + выводов) + total_raised / SCALE + 1` единиц;
- после провала сбора и всех возвратов волт пуст;
- в конце каждый инвестор получил тело с недобором не больше «число его выводов + 1» единиц (микро-USDC).

Как и фаззинг, тест собирает статистику и падает, если какая-то ветка не выполнилась: провал сбора, конец в дефолте, успешные полное и частичное досрочные, дефолт, расходы на взыскание, обработка оператором и посторонним, выводы. Прогон на 150 сценариях с другим seed: 29 провалов сбора, 34 дефолта, 19 полных и 32 частичных досрочных.

**Важно для разработчиков:** куча программы — 32 КБ, и выделенная память не освобождается до конца транзакции. Не создавайте ошибки заранее (`ok_or(error!(...))`) в циклах и арифметике — только лениво, `ok_or_else(|| error!(...))`. Иначе на длинном графике программа упадёт с нехваткой памяти.

Запуск:

```bash
anchor build
npm run test:unit
npm run test:integration
```
