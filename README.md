<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-dark.png">
    <img src="docs/brand/logo-light.png" alt="Pocket Rails" width="440">
  </picture>
</p>

<p align="center">
  <b>Kids pay out, the school bills in, parents set the rules once.</b><br>
  Every payment, in either direction, is checked by the same smart contract on QDay Aevum testnet, in tUSD8.<br>
  AI helpers can say no, never yes: every yes traces back to a permission the parent signed.
</p>

<p align="center">
  <a href="https://web-production-b9d9f11e.up.railway.app"><img alt="Live app" src="https://img.shields.io/badge/live%20app-online-22A06B?style=flat-square"></a>
  <a href="https://web-production-b9d9f11e.up.railway.app/judge"><img alt="For judges" src="https://img.shields.io/badge/for%20judges-no%20wallet%20needed-C93D25?style=flat-square"></a>
  <a href="docs/EVIDENCE.md"><img alt="Evidence" src="https://img.shields.io/badge/evidence-29%2F29%20live%20checks-1F6FB8?style=flat-square"></a>
  <a href="contracts/test"><img alt="Tests" src="https://img.shields.io/badge/contract%20tests-76%20%2B%2012%20fork-1F2A44?style=flat-square"></a>
  <a href="docs/AI_EVAL.md"><img alt="AI guardian eval" src="https://img.shields.io/badge/AI%20guardian%20eval-50%2F50-F5A524?style=flat-square"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-5B6478?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://web-production-b9d9f11e.up.railway.app"><b>Live app</b></a> ·
  <a href="https://web-production-b9d9f11e.up.railway.app/judge"><b>For judges</b></a> ·
  <a href="docs/EVIDENCE.md"><b>Evidence</b></a> ·
  <a href="docs/GUIDE.md"><b>Plain-English guide</b></a> ·
  <a href="docs/PITCH.md"><b>Pitch</b></a>
</p>

<!-- VIDEO -->

A parent wants to give a child spending money without approving every payment or handing over a card with no
limits. The child's school also needs to collect money for meals and trips from that same allowance. Pocket
Rails keeps the money in a smart contract that checks every payment in both directions: the child pays inside
rules the parent set, the school bills under a permission the parent granted, and a guardian, which can be an
AI agent, can stop a school charge but never approve one. It runs on Aevum testnet with test tokens only and
is not audited.

| Try it | |
|---|---|
| **Live app** | **[web-production-b9d9f11e.up.railway.app](https://web-production-b9d9f11e.up.railway.app)**, with the school billing agent and the guardian smart account running 24/7 on Railway |
| **Contract** | v2 [`0xB179…3801` on the Aevum explorer](https://explorer-test.qday.info/address/0xB179197A660029b1d96FEF09e3E8515b271E3801) (source verified); v1 [`0x7d54…40Df`](https://explorer-test.qday.info/address/0x7d54567d9D40641907B76A6b2fe6cb046e2B40Df) holds the first live runs |
| **Evidence** | [docs/EVIDENCE.md](docs/EVIDENCE.md): every v2 feature run live through the hosted app and AI guardian, 29/29 checks, each with its transaction |
| **Live runs** | [docs/DEMO_RUN.md](docs/DEMO_RUN.md): the first runs, and how the guardian smart account was set up |
| **Demo accounts** | [docs/TESTNET_ACCOUNTS.md](docs/TESTNET_ACCOUNTS.md) |
| **Guardian evaluation** | [docs/AI_EVAL.md](docs/AI_EVAL.md): 50 frozen test notes; rules + AI vetoed 30/30 bad charges (16/16 prompt injections) with 0/16 genuine charges wrongly vetoed |
| **For judges** | **[web-production-b9d9f11e.up.railway.app/judge](https://web-production-b9d9f11e.up.railway.app/judge)**: watch the guardian and the contract react to simulated problems, no wallet needed |
| **Plain-English guide** | [docs/GUIDE.md](docs/GUIDE.md): what it is with no crypto jargon, how to test it step by step, and a demo script |

## What it looks like

Every page opens in **demo mode** with the showcase family's live testnet data, so you can look around without a
wallet. Connect one to act.

| | |
|---|---|
| ![Homepage with the live showcase card](docs/screenshots/home.png) **Home:** the showcase family's balance and latest activity, live, each with a proof link | ![Parent dashboard](docs/screenshots/parent.png) **Parent:** a dashboard for rules, money, school billing, the guardian and history; stopped charges can still be paid by the parent |
| ![Child phone screen](docs/screenshots/child.png) **Child:** pay approved places; the app says before paying whether it will go through, and why not | ![School dashboard](docs/screenshots/school.png) **School:** what it billed, what's waiting, and what was stopped |
| ![Guardian decisions](docs/screenshots/guardian.png) **Guardian:** every charge the AI guardian checked, what it stopped and why, with the veto's transaction | ![Judge page](docs/screenshots/judge.png) **For judges:** send a duplicate, a trick note or an over-cap charge and watch it get stopped |

## What makes Pocket Rails different

1. **The school pulls charges under a veto window.** The parent grants the school a capped, expiring billing
   permission. Each charge waits as Pending for at least one minute, the parent or the guardian can veto it
   in that time, and after the window anyone can settle it.
   Code: [`requestCharge`](contracts/src/PocketRails.sol#L585), [`vetoCharge`](contracts/src/PocketRails.sol#L624), [`settle`](contracts/src/PocketRails.sol#L662).
   The parent can also set money aside for school charges that the child's spending can't touch
   ([money set aside for school](#money-set-aside-for-school-v2)).
   Tests: [`test_charge_settlesAfterVetoWindow`](contracts/test/PocketRailsBilling.t.sol#L47), [`test_vetoOnlyInsideWindow`](contracts/test/PocketRailsBilling.t.sol#L128),
   [`test_revokeBilling_pendingChargesFail`](contracts/test/PocketRailsBilling.t.sol#L218).
2. **A guardian that can only veto.** The guardian key's one special power is `vetoCharge`: it can't approve,
   raise a limit or move money, and the parent can override a wrongful veto. The guardian agent's AI review
   treats charge notes as untrusted data and answers "unknown" when unsure, which leaves the charge for the
   parent.
   The guardian runs as a Kernel v3.1 smart account: its agent holds a session key that our validator module
   only lets call `vetoCharge`, sent as ERC-4337 user operations through QDay's bundler
   ([details](#guardian-smart-account-and-veto-only-session-key)).
   Code: [`agents/`](agents/), [`agents/src/review.ts`](agents/src/review.ts), [`VetoOnlySessionValidator.sol`](contracts/src/VetoOnlySessionValidator.sol).
   Measured on 50 frozen test notes ([docs/AI_EVAL.md](docs/AI_EVAL.md)): rules + AI vetoed 30 of 30 bad charges,
   including 16 of 16 prompt injections, and wrongly vetoed 0 of 16 genuine ones; the rules alone caught 2 of 30.
   Tests: [`agents/src/policy.test.ts`](agents/src/policy.test.ts), [`test_guardianCanNeverApprove`](contracts/test/PocketRailsBilling.t.sol#L160),
   [`test_parentOverridesWrongVeto`](contracts/test/PocketRailsBilling.t.sol#L168).
3. **Refusals are recorded, not reverted.** A refused payment or charge still succeeds as a transaction, moves
   no money and records a reason code, so every refusal has a transaction hash anyone can check.
   See: [Reason codes](#reason-codes). Tests: [`test_refuse_payeeNotApproved`](contracts/test/PocketRails.t.sol#L105),
   [`test_refuse_overPerPaymentLimit`](contracts/test/PocketRails.t.sol#L109), [`test_charge_overPerChargeCap_refused`](contracts/test/PocketRailsBilling.t.sol#L78).
4. **Built for a real family situation.** The child sees a plain explanation and a next step when something is
   refused, and doesn't pay gas because a relayer submits their signed payments. In the business model the
   school is the paying customer (a hypothesis we haven't validated).
   See: [child screen](web/src/app/child/page.tsx), [plain-language messages](packages/pocket-rails/src/reasons.ts),
   [Business model and distribution](#business-model-and-distribution).

## See it in 60 seconds

Recorded on v2 through the hosted app and the hosted AI guardian ([docs/EVIDENCE.md](docs/EVIDENCE.md) has all 29 steps):

1. **The child pays on their own, with no gas.** [Paid](https://explorer-test.qday.info/tx/0xbcc37153a36a8b75df7d93665535fc1e561702e003afad1c553fb811d57b56fd); the child's account
   held 0 tQDAY for the whole run.
2. **A payment that breaks a rule is refused and recorded.** "This is more than you can spend in one payment.":
   [refusal](https://explorer-test.qday.info/tx/0x37ba00b25952b073b806d4246b040e33dc6fa0e465e7af4d6dbe144f55a28ae8).
3. **A one-time exception.** The child asks, the parent allows it once, the exact payment goes through and a
   second use is refused: [request](https://explorer-test.qday.info/tx/0xe6f38a2810ba69c3685e8e070956997134d5209964f93c96206626c36f913c6f), [allow once](https://explorer-test.qday.info/tx/0xb79041e8d19d83c0d72448f83819a682373a02489831e20b13bf0350fbcbfd77),
   [paid](https://explorer-test.qday.info/tx/0xf81eac74c8a454e4e94649db2d63a10468e2bf919bef2703b7a8461fb1d637a2), [reuse refused](https://explorer-test.qday.info/tx/0x53d6ab8ba2956b2f4783eb91f3a473ddae6e570211f1241b9cafb369a4d4d478).
4. **Money set aside for school.** The child is refused because the rest is set aside
   ([refusal, reason 13](https://explorer-test.qday.info/tx/0xbef3e6ca81139bbf24a61b9b6771bbc26b41c760f7de9252b01ae88f942753ba)), and the school's charge is paid from it
   ([charge paid](https://explorer-test.qday.info/tx/0x0e3fafaaf549be9a0c02d14219eaf14effe7c262debec9933600dd6c434dab8a)).
5. **The AI guardian vetoes a duplicate on its own, and can't say yes.** [veto](https://explorer-test.qday.info/tx/0x75d440b5828080c9e59259f4d24aada22b3ba36737cd9ff3d95908fad3ad97ef)
   (an ERC-4337 user operation from the veto-only smart account); its attempt to approve is refused by the
   contract with `NotParent()`.
6. **The parent overrides the veto.** [paid anyway](https://explorer-test.qday.info/tx/0x0458fde7b6213044e6a72c2ff309c8ae69518f6e3d76304300cd8d86adeebeb6): only the parent can do this.
7. **One tap stops it.** [revoke billing](https://explorer-test.qday.info/tx/0x11d1fcce5610ad8f2254f6ad2c385c6f95f18d533c17fbd1afdeaa0cdb2a17fc) → [charge refused](https://explorer-test.qday.info/tx/0x1f0a78593fdd8aecbbab7c396dc280084496d10dac36c23023e563186d6d1fb0);
   [pause](https://explorer-test.qday.info/tx/0x7e515ea60f9af2498a3c2352e2eb630292dde88ce3ae93166369f11abccbc4f1) → [payment refused](https://explorer-test.qday.info/tx/0xf4ce020c673b063d84d6dc9a17c39c8ae08904efb67e5ad500453506b4ce4c24).
8. **Gas-free top-up.** The parent only signs an EIP-3009 authorisation; another account submits it:
   [deposit](https://explorer-test.qday.info/tx/0x1a1a88424e7af1b3aea3f59169b7031139d7a8cdd15088fed3c934c678d85683).

Or open the [judge page](https://web-production-b9d9f11e.up.railway.app/judge) and send a trick note or a
duplicate charge yourself: the hosted guardian vetoes it within about 30 seconds.

## Shared building blocks

The child side uses familiar spending controls: [approved places, a per-payment limit, a weekly limit and an
expiry date](#child-pays-push), [one-time exceptions](#one-time-exceptions), [instant revocation](#what-revoking-does-to-things-already-in-flight)
and [gasless signed intents submitted by a relayer](#relayer-api). The full list of threats and controls is in
the [Safety model](#safety-model).

> Built for Aevum Builder Challenge #1. **Testnet only, test tokens only, not audited.** No real money,
> no real children's data and no real merchants. It doesn't replace parental judgment.

---

## Status

| Part | State |
|---|---|
| `PocketRails.sol`: vaults, versioned rules, child payments, recorded refusals, one-time exceptions, school billing with veto window, revocation | Done: 67 unit and fuzz tests, 4 invariants (128,000 random calls), 2 fork tests on the real tUSD8 |
| TypeScript SDK (`packages/pocket-rails`): ABI, EIP-712 intents, reason codes, outcome decoding | Done |
| Relayer for child intents (`/api/rails/relay`) and outcome lookup (`/api/rails/tx`) | Done, tested end to end on a local chain (`pnpm example demo-flow`) |
| Deployment to Aevum testnet | v2 (adds money set aside for school) done and **source verified**: `0xB179197A660029b1d96FEF09e3E8515b271E3801`. v1, with the first live runs: `0x7d54567d9D40641907B76A6b2fe6cb046e2B40Df` |
| Screens: home, parent, child (phone-first), school, guardian | Done (`web/src/app`) |
| History cache for the on-chain timeline (`/api/rails/events`) | Done |
| Guardian agent and school billing agent (`agents/`) | Done, run live on Aevum with AI review ([docs/DEMO_RUN.md](docs/DEMO_RUN.md)) |
| Guardian evaluation (50 frozen notes, rules vs AI vs both) | Done: [docs/AI_EVAL.md](docs/AI_EVAL.md) |
| Guardian as a Kernel v3.1 smart account with a veto-only session key (ERC-4337, QDay bundler) | Done: 8 unit tests, 10 fork tests on Aevum's EntryPoint and Kernel, live veto through the bundler |
| Hosted demo | Live on Railway: [web-production-b9d9f11e.up.railway.app](https://web-production-b9d9f11e.up.railway.app). Web app + both agents in one service ([docs/HOSTING.md](docs/HOSTING.md)) |
| Judge page with "See it live" (no wallet) | Done (`/judge`), tested live on Aevum |

---

## The problem

Parents of school-age children usually choose between approving every payment (slow for both sides) and
handing over a card or cash with no limits (overspending, scams, money going to the wrong place). Schools,
meanwhile, chase fees for meals, transport and trips.

Pocket Rails sits in between: real limits, real independence, and predictable school billing. The rules
live in the contract that holds the money, so the app's screens can't be bypassed.

**Target users (hypotheses we haven't validated):** parents of secondary-school students who give daily
money for lunch, transport and school items, including parents who fund a child's school costs from another
country, and schools that want pre-approved, capped fee collection.

## How it works

```mermaid
flowchart LR
    P[Parent] -- "rules v1, v2…<br/>payees, caps, expiry" --> V[(PocketRails vault<br/>tUSD8)]
    P -- "billing permission<br/>caps · expiry · veto window" --> V
    C[Child key] -- "signed payment intent<br/>(EIP-712)" --> R[Relayer]
    R -- "pay()" --> V
    V -- "Allow" --> M[Canteen / bookshop]
    V -- "Refuse + reason code<br/>(recorded, no money moves)" --> L[On-chain history]
    S[School billing agent] -- "requestCharge()" --> V
    G[Guardian agent] -- "vetoCharge() only" --> V
    V -- "settle after window" --> T[School treasury]
    P -- "approve / override / revoke" --> V
```

**Child pays (push), step by step**

```mermaid
flowchart TD
    A["Parent creates the vault, funds it and sets the rules"] --> B["Child signs an EIP-712 payment intent"]
    B --> C["Relayer checks the network, signature, nonce and simulation, then submits"]
    C --> D{"Contract checks the rules"}
    D -->|Inside the rules| E["Paid"]
    D -->|Outside the rules| F["Refused, recorded with a reason code, no money moves"]
    F --> G["Child signs an exception request"]
    G --> H{"Parent decides"}
    H -->|Decline| I["Nothing is paid"]
    H -->|Allow once| J["Child pays the exact request once"]
    H -->|Change the rules| K["A new rules version applies"]
    R["Parent revokes at any time"] -.-> X["Old intents and exceptions stop working"]
```

The parent creates the vault, funds it with tUSD8 and sets the rules. The child signs an EIP-712 payment
intent, and the relayer checks the network, the signature, the nonce and a simulation before submitting it.
The contract then checks the rules: inside them, the payment is made; outside them, it is refused, recorded
with a reason code, and no money moves. For something outside the rules, the child signs an exception
request, and the parent can decline it, allow it once, or change the rules. An allowed exception covers only
that exact request, once. The parent can revoke the child's access at any time, which ends all older intents
and exceptions.

**School bills (pull), step by step**

```mermaid
flowchart TD
    A["Parent grants a billing permission: billing key, treasury, per-charge cap, per-period cap, expiry, veto window of at least 1 minute, optional first-charge approval"] --> B["School billing key requests a charge"]
    B --> C{"Inside the caps?"}
    C -->|No| D["Refused and recorded"]
    C -->|Yes| E["Pending during the veto window"]
    E -->|Parent or guardian vetoes| V["Vetoed, not paid unless the parent overrides it"]
    E -->|No veto or the parent approves early| G["After the window anyone can settle"]
    V -->|Parent overrides| G
    G --> H{"Permission still valid and vault funded?"}
    H -->|Yes| I["Paid to the approved treasury"]
    H -->|No| J["Failed: permission revoked or vault short"]
```

The parent grants a billing permission with a billing key, a treasury address, a per-charge cap, a
per-period cap, an expiry date, a veto window of at least 1 minute and, optionally, approval of the first
charge. The school's billing key then requests a charge. Inside the caps, the charge is pending; outside them,
it is refused and recorded. During the veto window the parent or the guardian can veto the charge. The parent
can also approve it early or override a veto, but the guardian can never approve. After the window anyone can
settle the charge: it is paid to the approved treasury, or it fails if the permission was revoked or the
vault doesn't hold enough.

### Child pays (push)

1. The parent creates a vault, funds it with tUSD8 and sets rules: approved payees, a per-payment limit,
   a weekly limit (weeks start Monday 00:00 UTC) and an access expiry date.
2. The child signs a payment intent. A relayer submits it, so the child never needs gas.
3. Inside the rules, it's paid with no approval. Outside, the transaction still succeeds but moves no money
   and records `Refused` with a reason code, so a refusal has a transaction hash too.

### One-time exceptions

1. The child signs a request for a specific payee, amount and note.
2. The parent declines, allows it once (with an expiry), or changes the standing rules.
3. An allowed exception covers only that exact payee, amount and note hash, works once, and never changes
   the standing rules or uses the weekly allowance.

### School bills (pull)

1. The parent grants the school a billing permission: a billing key, a treasury address, a per-charge cap,
   a per-period cap, an expiry and a veto window (minimum 1 minute). Optionally, the first charge needs the
   parent's approval.
2. The school's billing key requests a charge. Inside the caps it becomes **Pending**; outside, it's
   recorded as refused.
3. During the veto window the parent or the guardian can veto. After it, anyone can settle.
4. The parent can approve early, or override a wrong veto. The guardian can never approve.

### Money set aside for school (v2)

The parent can set aside part of the balance for school costs, like a bus pass, with `setSchoolReserve`. The
child's payments, including one-time exceptions, can't use it: a payment that would dip into it is refused and
recorded with reason 13 ("That money is set aside for school costs."). School charges can use it, and settling
one uses up the set-aside amount first. It can never be more than the balance, and it shrinks to fit if the
parent withdraws. Tests: [`contracts/test/PocketRailsReserve.t.sol`](contracts/test/PocketRailsReserve.t.sol) and the
`invariant_reserveNeverExceedsBalance` invariant.

### The four outcomes

| Outcome | Where it lives | Meaning |
|---|---|---|
| Allow | On-chain (`Paid`, `ChargeSettled`) | Inside the rules, paid |
| Refuse | On-chain (`Refused`, `ChargeRefused`, `ChargeFailed`) | A rule was broken; reason code recorded |
| Pending | On-chain (exception `Pending`, charge `Pending` / `AwaitingParent`) | Waiting for a parent decision or the veto window |
| Unknown | **Off-chain only** (app and agents) | Something couldn't be verified (RPC failure, unconfirmed transaction, ambiguous request), so nothing is submitted |

### Reason codes

| Code | Name | Plain language shown to users |
|---|---|---|
| 1 | AccessRevoked | Your parent has paused your spending. |
| 2 | AccessExpired | Your spending access has ended. Ask your parent to renew it. |
| 3 | PayeeNotApproved | This place isn't on your approved list. You can ask for an exception. |
| 4 | OverPaymentLimit | This is more than you can spend in one payment. |
| 5 | OverWeeklyLimit | This would take you over your weekly limit. |
| 6 | InsufficientBalance | There isn't enough money in your allowance. |
| 7 | ExceptionNotApproved | That exception isn't approved, has expired, or was already used. |
| 8 | ExceptionMismatch | This payment doesn't match the exception your parent approved. |
| 9 | OverChargeLimit | The school asked for more than one charge is allowed to be. |
| 10 | OverPeriodLimit | The school has reached this period's billing limit. |
| 11 | BillingExpired | This billing permission has ended. |
| 12 | BillingRevoked | The parent has cancelled this billing permission. |
| 13 | EarmarkedForSchool | That money is set aside for school costs. (v2) |

---

## The app

| Page | Who | What they can do |
|---|---|---|
| `/` | Everyone | What Pocket Rails is, the four roles, live counts from the contract |
| `/parent` | Parent | Open a vault (pre-filled in demo mode), top up and withdraw, edit rules (each save is a new version), approve or remove places, allow-once or decline requests, approve or veto school charges, pay a wrongly vetoed charge anyway (with a confirm step), grant and revoke school billing, set the guardian, pause or revoke everything, read the full on-chain history |
| `/child` | Child (phone-first) | See balance and what's left this week, pay an approved place with a live rules check before signing, see plain-language refusals with a next step, ask for an exception, pay an allowed exception, see activity. Never needs gas. |
| `/school` | School billing key | Send charges inside the caps, watch the veto window, settle when it's over |
| `/guardian` | Guardian key | Veto open school charges with a reason. Nothing else. |

Current state (balances, rules, requests, charges) is read straight from the contract. The timeline comes
from `/api/rails/events`, a small server-side cache: Aevum makes about 85,000 blocks a day and `eth_getLogs`
covers at most 1,000 blocks per call, so it scans in parallel once, saves to `web/.cache/`, then only reads
new blocks.

## Agents

Two small Node agents in `agents/`, each with its own TEST key. Neither can exceed what the contract allows.

| Agent | Run | What it does | What it can't do |
|---|---|---|---|
| School billing | `pnpm --filter agents school` | Bills one meal per school day (or every N seconds in demos) on every live permission granted to its key, skipping weekends and staying inside the caps. Never bills the same slot twice: it checks the chain for a charge with the same note first, so restarts are safe. Settles charges once their veto window ends. | Charge more than the caps, shorten the veto window, or pay anyone but the treasury the parent approved |
| Guardian | `pnpm --filter agents guardian` | Watches every vault that names its key as guardian. Each open charge goes through rules (duplicate note, weekend, price over 1.5× the usual), then optionally an AI review of the note (`AI_REVIEW=1`, Claude `claude-opus-5-5` with structured output limited to `veto` / `no_action` / `unknown`). Vetoes inside the window with a reason; "unknown" means it leaves the charge and reports it. In smart-account mode it never holds the owner key: it signs with a veto-only session key and sends user operations through the bundler. | Approve, raise a limit, or move money: `vetoCharge` is the only thing its key may call |

The AI review treats the note as untrusted data: instructions inside a note are themselves a reason to veto.
A refusal, an API error or an unreadable answer becomes "unknown", never a guess.

Charge notes live off-chain. The contract stores only `keccak256(note)`; the school agent publishes the text
to `/api/rails/notes`, which accepts it only if its hash matches, so nobody can attach different text to a
charge. Children's notes are never sent there.

Demo scenarios (`DEMO_SCENARIO`, sent once after the normal meal): `duplicate` (guardian vetoes),
`overprice` (guardian vetoes), `trick` (a note that tries to instruct the AI review), `overcap` (the
contract refuses and records it). Settings: `agents/.env.example`. Rule tests: `pnpm --filter agents test`.

## Safety model

| Threat | What stops it |
|---|---|
| Child's key is stolen | It can only pay approved payees inside the caps, or request exceptions. The parent revokes it instantly. |
| A relayer changes a payment | Intents are EIP-712 signatures over vault, payee, amount, memo, exception, nonce, epoch and deadline, bound to chain ID and contract address. Any change fails the signature check. |
| Replaying a payment or exception | Nonces are single-use (refused intents use them up too). Exceptions are single-use. |
| Old signed intents after a revoke | Revoking bumps an epoch; intents and exceptions from older epochs are refused. |
| School billing key is stolen | Charges are capped per charge and per period, wait out a veto window, and settle only to the treasury address the parent approved. |
| School overcharges or double-charges | The guardian agent or parent vetoes inside the window. |
| Guardian agent's key is stolen | In smart-account mode the agent holds only a session key, which the validator module lets make the account call `vetoCharge` and nothing else (no approvals, no transfers, no other contracts, no value), until it expires. The owner key stays with the guardian and can revoke the session; the parent can also replace the guardian. |
| Guardian agent is fooled (prompt injection) or wrong | It can only veto. It can't approve, raise a limit or move money. The worst case is a wrongful veto, which the parent can override. |
| Guardian agent is offline | Charges inside the caps still settle after the window, like a bank direct debit. Use the first-charge approval and tight caps; a "hold all if the guardian is offline" setting is on the roadmap. |
| Admin abuse | There is no admin, owner or upgrade path. Only a vault's parent can change that vault. |
| Parent key is stolen | Out of scope for the contract: the parent key is the root of authority. Roadmap: parent as a smart account with recovery. |
| Privacy | Memos are stored as hashes only. Payees and amounts are public on any public chain; don't put personal details in labels. |

"Every yes traces back to a permission the parent signed": a child's payment is allowed by rules the parent
set, an exception by the parent's `allowOnce`, and a school charge by the billing permission the parent
granted. School charges inside that permission settle after the veto window without a fresh signature, the
same way a direct debit works.

### What revoking does to things already in flight

| Situation | Result | Test |
|---|---|---|
| Parent revokes a billing permission while a charge is pending | The charge can't be paid. `settle()` marks it `Failed` (reason `BillingRevoked`) and frees its allowance; new charges are refused. | `test_revokeBilling_pendingChargesFail` |
| Parent calls `revokeAll` | Child access off, every billing permission and pending charge dead, pending exceptions dead. Funds stay in the vault. | `test_revokeAll_stopsEverything` |
| Parent revokes, then clicks Approve on an old charge | Still not paid: the charge fails. A revoked permission can't be revived by approving. | `test_approveAfterRevoke_cannotPay` |
| Child access revoked (or rotated) with signed intents not yet submitted | Refused and recorded (`AccessRevoked`); exceptions from before the revoke can't be used. | `test_refuse_afterRevoke_andOldIntentsStayDeadAfterRestore`, `test_exception_diesOnRevoke` |
| A permission **expires** while a charge is in its window | The charge can still settle (it was requested while the permission was valid); new charges are refused. | `test_charge_afterExpiry_refused` |
| Vault doesn't hold enough when the window ends | `Failed` (`InsufficientBalance`), nothing moves, the allowance is freed. | `test_settle_insufficientBalance_fails` |

---

## How Pocket Rails uses Aevum

| Aevum piece | How it's used | Where |
|---|---|---|
| **tUSD8** (`0x4565…3483`, 6 decimals) | The only currency. Vault balances are tracked inside PocketRails and backed 1:1 by tUSD8 it holds (checked by an invariant test over 128,000 random calls). | `contracts/src/PocketRails.sol`, `PocketRailsInvariant.t.sol` |
| **EIP-3009 `receiveWithAuthorization`** on tUSD8 | Gasless top-ups: anyone signs a transfer to PocketRails and anyone submits it. The authorization nonce is `keccak256(contract, vaultId, salt)`, so a relayer can't credit a different vault. Tested against the real tUSD8 on a fork, and run live ([evidence](docs/EVIDENCE.md)). | `depositWithAuthorization`, `test/fork/PocketRailsFork.t.sol` |
| **EIP-712 signatures on chain 44005** | Children sign payment intents and exception requests; the domain binds them to chain 44005 and this contract. `SignatureChecker` also accepts ERC-1271 smart-account signatures. | `hashPayment`, `packages/pocket-rails/src/intents.ts` |
| **Shanghai EVM** (no Cancun opcodes) | Compiled with `evm_version = "shanghai"`; `make build` scans the bytecode for Cancun-only opcodes; no transient-storage OpenZeppelin contracts. | `contracts/foundry.toml`, `tools/check-shanghai.mjs` |
| **Legacy (type 0) transactions** | The relayer, agents and app send legacy transactions, as Aevum recommends. | `web/src/app/api/rails/relay/route.ts`, `agents/src/lib.ts` |
| **`eth_getLogs` limited to 1,000 blocks; ~1 block/second** | History is scanned server-side in parallel 1,000-block chunks, cached to disk, then read incrementally. Current state never depends on logs: it's read from contract views. | `web/src/lib/indexer.ts` |
| **No WebSocket RPC** | The app and agents poll over HTTPS (transaction status every 1.5 s, state every few seconds). | `web/src/app/api/rails/tx/route.ts`, `agents/` |
| **Multicall3** | Lists (allowances, requests, charges) are read in one call each. Agents fall back to single reads on chains without it. | `web/src/lib/rails.ts`, `agents/src/lib.ts` |
| **Explorer (Blockscout)** | Source of both versions verified; every screen and log links transactions to it. | [v2 contract page](https://explorer-test.qday.info/address/0xB179197A660029b1d96FEF09e3E8515b271E3801?tab=contract) |
| **Starter kit** (`qday-io/aevum-starter-kit`) | Foundry setup, `MockUSD8`, Shanghai check, chunked log helper, chain config, Next.js scaffolding, relayer protections. Credited in `NOTICE.md`. | `packages/aevum`, `tools/` |
| **Faucets** | Demo accounts were funded from the Discord faucet (the web faucet requires mainnet holdings); demo amounts are scaled to one claim. | `docs/PLATFORM_FEEDBACK.md` |
| **ERC-4337 EntryPoint v0.7, Kernel v3.1 and QDay's bundler** | The guardian is a Kernel v3.1 smart account created with Aevum's deployed Kernel factory. Its agent's session key is limited by our ERC-7579 validator module to `vetoCharge`; vetoes are ERC-4337 user operations sent through `bundler.qday.info` to EntryPoint v0.7, and the account pays its own gas. | [`VetoOnlySessionValidator.sol`](contracts/src/VetoOnlySessionValidator.sol), [`agents/src/userop.ts`](agents/src/userop.ts), [`GuardianAccountFork.t.sol`](contracts/test/fork/GuardianAccountFork.t.sol) |
| **ERC-8004 identity registry** | **Not used.** The starter kit says QDay's registry isn't open for this challenge, so approved places are stored in PocketRails. | Roadmap |

### Guardian smart account and veto-only session key

The guardian, the one role an AI agent plays, runs as a **Kernel v3.1 smart account** (ERC-4337). The account's
owner is the guardian's own key (Kernel's ECDSA root validator). The agent never gets that key: it gets a
**session key** installed in [`VetoOnlySessionValidator`](contracts/src/VetoOnlySessionValidator.sol), an ERC-7579
validator module we wrote. During ERC-4337 validation, before anything executes, the module checks that the
operation is a single Kernel `execute` call to PocketRails, with no value, calling `vetoCharge`, signed by the
session key, and it returns the session's expiry as `validUntil` so the EntryPoint enforces it. Anything else is
refused: approving a charge, moving tokens, calling another contract, changing the account, a wrong signer, an
expired or revoked session.

| | Address / proof |
|---|---|
| Veto-only validator module (source verified) | [`0xCC02a255bb48927090F23bB86DA497830eE0fC7C`](https://explorer-test.qday.info/address/0xCC02a255bb48927090F23bB86DA497830eE0fC7C?tab=contract) |
| Guardian smart account (Kernel v3.1 proxy) | [`0x4D22c96D456CA81892C925bB2044DD28d21a31B0`](https://explorer-test.qday.info/address/0x4D22c96D456CA81892C925bB2044DD28d21a31B0) |
| Agent's session key (holds no funds) | `0xE0078d6bE769bEe23Ad5D4eAcE941A2053a61F97`, valid 30 days |
| Live veto as a user operation through `bundler.qday.info` | [tx](https://explorer-test.qday.info/tx/0x3f6322ba62ccfdf7ea6f06bb2dbd51495d7b69153a59d0b28e9093ab943ca5a5) to EntryPoint v0.7: charge #2 on allowance #1 (v2) vetoed, `ChargeVetoed` by the smart account, no paymaster |
| Tests | 8 unit tests ([`VetoOnlySessionValidator.t.sol`](contracts/test/VetoOnlySessionValidator.t.sol)) and 10 fork tests on Aevum's real EntryPoint, Kernel factory and ECDSA validator ([`GuardianAccountFork.t.sol`](contracts/test/fork/GuardianAccountFork.t.sol)), each refusal checked against its exact EntryPoint error |

How to reproduce: [`contracts/script/DeployGuardianAccount.s.sol`](contracts/script/DeployGuardianAccount.s.sol) deploys
the module and creates the account; the guardian agent's smart-account mode (`GUARDIAN_ACCOUNT`,
`GUARDIAN_VALIDATOR`, `GUARDIAN_SESSION_KEY`, `BUNDLER_URL` in `agents/.env`) sends the vetoes.

Context: the challenge's official starter kit says account abstraction isn't required and there's no officially
supported bundler or paymaster (commit [`f7bc531`](https://github.com/qday-io/aevum-starter-kit/commit/f7bc531), 18 Nov
2026). QDay's bundler at `bundler.qday.info` works, so we used it for the guardian, where a scoped session key adds
the most safety. Children's gasless payments keep the EIP-3009/EIP-712 relayer pattern the kit recommends. The
contract accepts ERC-1271 signatures, so the parent or child can move to a smart account later without a redesign.

## Business model and distribution

These are plans and hypotheses, not validated results.

- **Who pays: schools, not families.** A school gets pre-approved, capped collection for meals, transport and
  trips, with fewer unpaid balances and no cash handling. Hypothesis: a small fee per settled charge (for
  example 0.5–1%) or a flat monthly fee per school, with the family side free.
- **Optional family plan.** A hosted guardian (rules plus AI review) and multi-child dashboards as a small
  subscription; the core allowance stays free.
- **Distribution: school by school.** One school onboards its canteen and transport as approved places and
  its billing agent as a permission template; it then invites families, who open an allowance in minutes.
  Every school that joins brings its families, and families bring siblings at other schools.
- **First markets (hypothesis):** schools where stablecoin payments already make sense, such as cross-border
  families paying school costs and private or international schools.
- **Path to production:** licensed on- and off-ramp partners, an audit, the parent as a smart account with
  recovery, and Aevum mainnet once available. Real deployments with minors would need legal review in each
  market.

---

## Contracts

| Contract | Address (Aevum testnet, chain 44005) |
|---|---|
| PocketRails **v2** (current) | [`0xB179197A660029b1d96FEF09e3E8515b271E3801`](https://explorer-test.qday.info/address/0xB179197A660029b1d96FEF09e3E8515b271E3801), deployed in block 4084193 by tx [`0x09658ff1…e5a7`](https://explorer-test.qday.info/tx/0x09658ff197ae84ed1e43bd299af97a88f5b3c0c0ab78e8b29c2382292463e5a7) from commit [`e747b93`](https://github.com/datharnu/pocket-rails/tree/e747b93) |
| PocketRails v1 (first live runs) | [`0x7d54567d9D40641907B76A6b2fe6cb046e2B40Df`](https://explorer-test.qday.info/address/0x7d54567d9D40641907B76A6b2fe6cb046e2B40Df), deployed in block 4072059 by tx [`0xc77c22a4…b728`](https://explorer-test.qday.info/tx/0xc77c22a458fe2fc54d47085ccc195e5e496764174d01b502f03eeb9ffdabb728) |
| VetoOnlySessionValidator | [`0xCC02a255bb48927090F23bB86DA497830eE0fC7C`](https://explorer-test.qday.info/address/0xCC02a255bb48927090F23bB86DA497830eE0fC7C?tab=contract) (source verified) |
| Guardian smart account (Kernel v3.1) | [`0x4D22c96D456CA81892C925bB2044DD28d21a31B0`](https://explorer-test.qday.info/address/0x4D22c96D456CA81892C925bB2044DD28d21a31B0) |
| tUSD8 | [`0x456569838f1d43009A91ebA4263147Afd7233483`](https://explorer-test.qday.info/address/0x456569838f1d43009A91ebA4263147Afd7233483) |

**Both versions are source verified** on the Aevum explorer (Blockscout) on 2026-11-25: compiler 0.8.24,
optimizer 200 runs, EVM `shanghai` ([v2 verified code](https://explorer-test.qday.info/address/0xB179197A660029b1d96FEF09e3E8515b271E3801?tab=contract), [v1 verified code](https://explorer-test.qday.info/address/0x7d54567d9D40641907B76A6b2fe6cb046e2B40Df?tab=contract)).
v2 was deployed from commit [`e747b93`](https://github.com/datharnu/pocket-rails/tree/e747b93) and its deployed bytecode is identical to
that build apart from immutable values; v1 was deployed from [`335f5e6`](https://github.com/datharnu/pocket-rails/tree/335f5e64b223e0ffcc10abab00407ea30c02d585).
v2 adds money set aside for school; everything else is unchanged. The contracts have no upgrade path, so v1 stays on
chain as it was, with the first live runs ([docs/DEMO_RUN.md](docs/DEMO_RUN.md)). Reproduce the verification with:

```bash
cd contracts && forge verify-contract 0xB179197A660029b1d96FEF09e3E8515b271E3801 src/PocketRails.sol:PocketRails \
  --chain-id 44005 --verifier blockscout --verifier-url https://explorer-test.qday.info/api/ \
  --constructor-args $(cast abi-encode "constructor(address)" 0x456569838f1d43009A91ebA4263147Afd7233483)
```
 A live run of the full flow, with every transaction: [docs/DEMO_RUN.md](docs/DEMO_RUN.md). Demo accounts and their roles:
[docs/TESTNET_ACCOUNTS.md](docs/TESTNET_ACCOUNTS.md).

### Main functions

| Who | Function |
|---|---|
| Parent | `createVault`, `setRules`, `setPayee`, `setChild`, `revokeChild`, `setGuardian`, `revokeAll`, `withdraw` |
| Parent | `allowOnce`, `declineException`, `grantBilling`, `revokeBilling`, `approveCharge`, `setSchoolReserve` (v2) |
| Anyone | `deposit`, `depositWithAuthorization` (gasless EIP-3009 top-up), `settle` (after the veto window) |
| Child (signed, anyone submits) | `pay`, `requestException` |
| School billing key | `requestCharge` |
| Parent or guardian | `vetoCharge` |
| Views | `getVault`, `getException`, `getBilling`, `getCharge`, `previewPayment`, `spentThisWeek`, `hashPayment` |

---

## Run it locally

You need Node 22+, pnpm and [Foundry](https://book.getfoundry.sh/getting-started/installation).

```bash
git clone --recursive <this repo>
cd pocket-rails
make install          # Solidity libs + JS packages
make test             # unit, fuzz and invariant tests
make test-fork        # the flow against the real tUSD8 on a local fork of Aevum (no funds needed)
make build            # compile + check the bytecode is Shanghai-safe (Aevum has no Cancun opcodes)
```

If another program called `forge` comes first on your PATH, pass Foundry's: `make test FORGE=/opt/homebrew/bin/forge`.

### Deploy to Aevum testnet

1. Create two fresh TEST wallets: a deployer/parent and a relayer (`cast wallet new`). Never reuse a wallet
   that holds anything of value.
2. Fund both with tQDAY, and the parent with tUSD8, from [faucet.qday.info](https://faucet.qday.info/en)
   (or `/faucet` in the QDay Discord).
3. Deploy (the keystore keeps the deployer key encrypted):

```bash
cast wallet import deployer --interactive
make deploy-aevum ACCOUNT=deployer           # prints the PocketRails address; note the block number too
```

4. Put the address in `web/.env.local` (`NEXT_PUBLIC_NETWORKS=aevum`, `NEXT_PUBLIC_RAILS_AEVUM=…`) and the
   relayer key in `RELAYER_PRIVATE_KEY`, then add the address to the Contracts table above with a link to
   the exact commit, then verify the source on the explorer (see the Contracts section).

### Run the whole flow locally (no funds needed)

```bash
make anvil                                   # terminal 1: local Shanghai chain
make deploy-local                            # prints MockUSD8 and PocketRails addresses
# web/.env.local:  NEXT_PUBLIC_NETWORKS=local, NEXT_PUBLIC_RAILS_LOCAL=<address>,
#                  RELAYER_PRIVATE_KEY=<anvil account #1 key, allowed on local chains only>
pnpm dev                                     # terminal 2: web app + relayer on :3000
# examples/.env:   RPC_URL=http://127.0.0.1:8545, RAILS_ADDRESS=<address>, PARENT_KEY=<anvil account #0 key>
pnpm example demo-flow                       # terminal 3: parent + child through the real relayer
```

`demo-flow` runs: create and fund a vault → child pays (allowed) → child overspends (refused, recorded) →
exception requested → allowed once → wrong amount refused → exact amount paid → reuse refused → tampered
intent rejected by the relayer → replay rejected → access revoked → payment refused. Pointed at Aevum
testnet, it prints explorer links for every step.

### Environment variables

**web/.env.local** (see `web/.env.example`)

| Variable | Required | Meaning |
|---|---|---|
| `NEXT_PUBLIC_NETWORKS` | yes | `aevum`, `fork` or `local` (comma-separated; the first is the default) |
| `NEXT_PUBLIC_RAILS_AEVUM` / `_FORK` / `_LOCAL` | yes, for each network you use | PocketRails address |
| `NEXT_PUBLIC_RAILS_DEPLOY_BLOCK_AEVUM` / `_FORK` | recommended | Block PocketRails was deployed at; history is read from here |
| `RELAYER_PRIVATE_KEY` | for gasless child payments | A fresh TEST wallet with a little tQDAY. Server-only. anvil keys are refused on Aevum. |
| `RELAYER_REFUSALS_PER_VAULT_PER_HOUR` | no | Recorded refusals per vault per hour (default 10, `0` = no limit for demo rehearsals) |
| `RELAYER_DAILY_TX_LIMIT` | no | Max relayed transactions per day per server process (default 500) |
| `TRUSTED_IP_HEADER` | on a hosted deploy | Header your host sets with the client IP (Vercel: `x-vercel-forwarded-for`) |
| `NEXT_PUBLIC_WC_PROJECT_ID` | no | Enables WalletConnect for mobile wallets |
| `NEXT_PUBLIC_DEMO_CHILD` / `_SCHOOL` / `_GUARDIAN` | no | Demo mode: pre-fill the parent's forms with these addresses |
| `NEXT_PUBLIC_REPO_URL` | no | Where the "Source code" link points |

**examples/.env** (see `examples/.env.example`)

| Variable | Meaning |
|---|---|
| `RPC_URL` | `https://rpc-test.qday.info` for Aevum, `http://127.0.0.1:8545` for anvil |
| `RAILS_ADDRESS` | PocketRails address |
| `PARENT_KEY` | A TEST wallet with a little tQDAY and at least 2 tUSD8 per `demo-flow` run |
| `CHILD_KEY` | Optional. The child's TEST wallet (needs no funds). Default: a fresh key per run |
| `CANTEEN_ADDRESS` | Optional. The approved payee. Default: a fresh address per run |
| `APP_URL` | Where the web app runs (default `http://localhost:3000`) |

### Relayer API

`POST /api/rails/relay` submits a child's signed intent. The relayer can't change an intent (the signature
would break) and can't pay anything the contract's rules don't allow.

```json
{
  "chainId": 44005,
  "kind": "pay",
  "intent": { "vaultId": "1", "payee": "0x…", "amount": "3000000", "memoHash": "0x…", "exceptionId": "0",
              "nonce": "…", "epoch": "1", "deadline": "1795608300" },
  "signature": "0x…"
}
```

Response: `{ "hash": "0x…", "expected": { "reason": 0, "name": "None", "message": "Paid.", "nextStep": "" } }`.
`expected` comes from a simulation; the confirmed receipt is the truth. `kind` can also be
`requestException` (same fields without `exceptionId`).

Before spending gas it checks: the network and contract are yours, the intent is well formed with a deadline
at most 15 minutes ahead, the signature is the vault's child key (off-chain), the nonce is unused and not
in flight, and the simulation doesn't revert. It rate-limits per IP and per vault (only correctly signed
requests count toward a vault's limit), allows each vault at most 10 recorded refusals per hour, caps
transactions per day, and retries once if its own nonce is stale. These limits are in memory; use a shared
store (for example Redis) on serverless hosting.

`GET /api/rails/tx?hash=0x…&chainId=44005` returns `{ "state": "unknown" }` until the transaction is
confirmed, then `{ "state": "confirmed", "outcome": { "kind": "allow" | "refuse" | "pending" | "other" | "failed", "reason", "message", "events" } }`.
Aevum has no WebSocket RPC, so clients poll it.

---

## Known constraints

- Aevum runs the Shanghai EVM: no Cancun opcodes (checked by `make build`).
- `eth_getLogs` is limited to 1,000 blocks per call, so the app reads history in chunks.
- Weekly limits use fixed weeks starting Monday 00:00 UTC, not a rolling 7 days.
- Exceptions don't count toward the weekly limit. A parent's override of a vetoed charge counts toward the
  period's usage but isn't blocked by the cap (it's the parent's explicit decision).
- A charge settles to the treasury fixed in the permission. A permission that expires during a charge's veto
  window can still settle that charge.
- Refusals cost gas. The relayer records at most `RELAYER_REFUSALS_PER_VAULT_PER_HOUR` refusals per vault
  per hour (default 10; set `0` to turn the limit off when rehearsing a demo on one vault). A child paying
  their own gas could add refusal noise to their own vault's history but can't move money.
- If the relayer is down, the child screen offers **"Send it myself"**: the child submits the intent they
  already signed from their own wallet (needs a little tQDAY for the fee). The contract applies the same rules.
- QDay's ERC-8004 registry isn't open for this challenge (per the starter kit), so approved payees are stored
  in this contract.

## Roadmap

- Parent and child as Kernel smart accounts too (the guardian already is), with recovery for the parent.
- Payee identities through QDay's ERC-8004 registry once it's open.
- "Hold all school charges while the guardian is offline" setting.
- Earmarked funds (school fees the child's spending can't touch).
- Fiat on- and off-ramps for cross-border family funding (not built today).

## Platform feedback

See [docs/PLATFORM_FEEDBACK.md](docs/PLATFORM_FEEDBACK.md).

## License

MIT. Based on the [Aevum Starter Kit](https://github.com/qday-io/aevum-starter-kit) (MIT). See
[NOTICE.md](NOTICE.md).
