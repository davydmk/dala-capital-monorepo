# The legal case

**English** · [Русский](LEGAL.ru.md)

The point of this document is to show that the platform has jurisdictions where
it can be launched lawfully. There are two, and each answers a different
question:

| Perimeter | The question it answers |
|---|---|
| **1. Alatau City** | A regime being built specifically for tokenization |
| **2. The AIFC** | Under which licences the platform can operate today |

The national perimeter — the National Bank, the ARDFM and the KASE platform — is
covered at the end of the second section: not an alternative, but the way onto
the exchange's own infrastructure.

Every statement cites the article of law or the chapter of the concept paper it
rests on, so that it can be checked. This is not a legal opinion: an opinion on
licensing is being prepared separately by a lawyer.

---

## 1. Alatau City

Alatau is a city north of Almaty. It operates under the **Constitutional Law of
the Republic of Kazakhstan No. 286-VIII of 8 May 2026, "On the special legal
regime of the city of Alatau"** (as amended on 1 July 2026). Its tokenization
programme is set out in the city's concept paper *Tokenization by Default:
Step 1* (draft 0.8.2 of 6 August 2026; the document sets direction and states
itself that it imposes no binding requirements). In October 2026 KASE and the
Alatau City Authority signed a memorandum on digital financial assets, whose
priorities include a venue for trading tokenized assets on KASE's
infrastructure. The side track this project was built for and the city's
programme lead to the same place.

The city's issuance pipeline is staged, and our class of instrument is named in
it explicitly: Stage B from 2027 — growth and trade finance for operating
companies, meaning receivables, supplier finance and leasing (chapter 6). By the
same date settlement in "whitelisted" stablecoins becomes permissible for
issuance and for payments (chapter 7).

### What the regime gives

| Provision | What it gives the platform |
|---|---|
| Art. 13 | Regulation of the city is the prerogative of its own bodies. Rules can be adopted for an instrument that national law does not yet have |
| Art. 46(2) | Accounts and settlement in foreign currency, free movement of capital subject to AML/CFT carve-outs, free repatriation of income after tax. This is the basis on which a non-resident investor is paid |
| Art. 47 | The issuance and circulation of digital assets are determined by a decision of the Council and an act of the administration, agreed with the National Bank and the financial regulator |
| Art. 54(3) | An experimental legal regime is introduced on the initiative of the administration or at the proposal of a resident. This is the way in |
| Art. 73–75 | The parties may choose the governing law (art. 75(2)). The investor may choose arbitration — the AIFC IAC, ICSID, ICC, LCIA, SCC or ad hoc under UNCITRAL rules; the award is enforceable under the New York Convention (art. 74(5)–(6)) |

For an offshore investor the last point matters more than any technical
guarantee: a familiar forum, and an award enforceable where their money is.

### The way in

Obtain resident status (art. 38) and propose an experimental legal regime for
placing private debt under art. 54(3). Until the city's act on digital assets is
adopted, the pilot runs in the National Bank's sandbox — see section 3.

### What does not fit yet

- **Art. 15** ties currency operations and digital-asset operations to business
  inside the city's boundaries. Our borrowers are SMEs across Kazakhstan. The
  answer: start with borrowers resident in Alatau, and treat a country-wide
  portfolio within the AIFC perimeter.
- **The regulation under art. 47 has not been adopted yet**: until the Council's
  decision and the administration's act exist, national rules apply.
- **The criteria for a technology partner require a licence** (chapter 6).
  Alatau does not remove the need for one — hence section 2.

---

## 2. The AIFC

The AIFC is a financial centre in Astana with its own law, its own court and its
own regulator (AFSA). It operates under **Constitutional Law of the Republic of
Kazakhstan No. 438-V of 7 December 2015**. Unlike Alatau, there is nothing to
wait for here: the regimes are in force and licences are being issued. Choosing
the AIFC does not cut the platform off from the national market either — see
section 3.

### What the regime gives

| Provision | What it gives |
|---|---|
| Art. 4(1)(2) | Acts of the Centre may be based on the principles and precedents of the law of England and Wales |
| Art. 5(1) and (4) | Obligations are performed in the currency of the contract; Kazakhstan's currency controls do not apply to operations inside the Centre |
| Art. 13, 14 | The AIFC Court sits outside the judicial system of Kazakhstan and its appellate decisions are final; separately, there is the International Arbitration Centre |

For a non-resident investor what matters here is the currency of the contract,
the absence of currency control, and a forum they understand.

### Why settlement in a stablecoin is possible here

The platform raises money and pays holders in USDC. In the national perimeter
that runs into the National Bank's position: a stablecoin is not a means of
payment, and the only legal tender is the tenge. The AIFC has a licensing regime
for digital-asset activities (Rules on Digital Asset Activities, in force from
1 January 2026), and since September 2025 AFSA has accepted its own regulatory
fees in dollar stablecoins. A regulator that takes its fees in a stablecoin does
not treat settlement in one as exotic.

### Which licences are needed

| Function | Regulated activity |
|---|---|
| Raising loans from investors, servicing the loan, transferring the lender's rights | **Operating a Loan Crowdfunding Platform**. The definition of the activity expressly includes administering the loan agreement and arranging the transfer of the lender's rights to another person |
| Issuing a bond in token form | No separate licence. The Investment Token Framework governs the instrument itself, and the Operating an Investment Exchange licence is for trading venues — our note is non-transferable |
| Custody and settlement in USDC | **Providing Custody** and adjacent activities under the Rules on Digital Asset Activities. Whether they are required depends on how AFSA classifies the smart contract's addresses |

In substance it is one licence: capital equal to six months of operating
expenses, an authorisation fee of $15,000, mandatory auditors, a compliance
officer and an MLRO.

### A cheaper way in: the FinTech Lab

The FinTech Lab is AFSA's testing regime for activity built on new technology: a
two-year licence, with an application fee of 30% of the usual one — $4,500
instead of $15,000 — and the later move to a full licence costing only the
difference. The admission criterion is technological novelty: here that is a
smart contract that keeps the schedule and distributes payouts, and the raising
of funds in a stablecoin to addresses controlled by the program. One caveat: an
AFSA notice from 2023 says crowdfunding applicants normally go straight to the
full regime, and the Lab considers them only in particular cases.

Of the rules themselves (AIFC Authorised Market Institution Rules, chapter 7.3,
in force from 1 January 2026) one requirement is worth noting: the platform must
publish actual and expected default rates and a breakdown of arrears into
buckets of 30 / 31–60 / 61–90 / 90+ days (7.3.3). The platform satisfies this by
construction — arrears and penalty interest accrue per second, and the breakdown
comes from the same data. The limits for retail lenders (7.3.23) do not apply to
our investors: an accredited lender is any body corporate, or an individual
lending from $100,000 to a single borrower over 12 months (7.3.1).

### What backs this up

AFSA's public register holds live loan-crowdfunding licences: CapitalLink Ltd
(AFSA-A-LA-2026-0024), InvestRoom Ltd (AFSA-G-LA-2022-0005). Others have walked
this route already.

### The national perimeter: the way onto KASE

The instrument is described in national law as well: a digital asset whose
underlying is a property right (a claim), and a financial instrument in digital
form — a loan and a bond respectively (Law on Digital Assets No. 193-VII,
art. 5). Issuance goes only through an operator of a digital-asset platform
registered with the National Bank; KASE is entered in the registers as an
operator of a digital-asset platform and of a trading platform under number 001.

Issuance and the register stay with licensed infrastructure: the holder register
is kept by the Central Securities Depository (art. 6(6)), and the issue is
registered by the platform operator. Dala Capital sits on top as the settlement
and servicing layer — record date, entitlement calculation, execution in a
single transaction — and needs no issuance infrastructure of its own for that.

Movement between perimeters is provided for in the law itself (art. 6(22), (23),
(25)), and the procedure is being filled in by a draft joint resolution of the
National Bank and the ARDFM on mutual admission, published in October 2026. The
admission requirements are addressed to the issuer: financial soundness, net
profit, audit, a credit rating.

### What does not fit yet

- Custody of USDC: the funds sit at the smart contract's addresses and the
  platform only signs operations under its rules. Whether that counts as holding
  client assets is a question for AFSA.
- The note and the loan are one product under two different regimes; that one
  licence suffices needs to be confirmed.
- Settlement in a stablecoin rests on the digital-asset regime and on AFSA's
  practice rather than on the currency provision: art. 5(1) speaks of the
  currency of the contract, and a stablecoin is not legally a currency.
