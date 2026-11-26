# Pocket Rails

**A family allowance and school billing app on QDay Aevum, where AI can say no, never yes.**

- 🌐 **Live app:** https://web-production-b9d9f11e.up.railway.app (opens in demo mode, no wallet needed)
- 🧑‍⚖️ **For judges:** https://web-production-b9d9f11e.up.railway.app/judge (trigger a problem charge and watch it get stopped live)
- ▶️ **Demo video (2:52):** https://drive.google.com/file/d/1z5sLiR3Ho5PoqXoR5B9euyskDG-Ut2Nc/view
- 💻 **Code:** https://github.com/datharnu/pocket-rails
- 📜 **Contract (verified):** [`0xa37f27487562a1595768A681Ee21D3e93FFcE05c`](https://explorer-test.qday.info/address/0xa37f27487562a1595768A681Ee21D3e93FFcE05c?tab=contract) on Aevum testnet (chain 44005)
- ✅ **Evidence:** 33/33 features checked live on Aevum through the hosted app, each with its transaction ([EVIDENCE.md](https://github.com/datharnu/pocket-rails/blob/main/docs/EVIDENCE.md))

---

## The problem

A parent wants to give a child spending money **without approving every payment**, and without handing over a card
with no limits. Meanwhile the child's **school** needs to collect money for meals, trips and transport from the same
family. Today that means cash, chasing unpaid balances, or a direct debit the parent can't easily see or stop.

Adding AI to payments makes this harder: an agent that can approve or move money can be tricked, for example by a
"note" on a charge that tells it to approve.

## What Pocket Rails does

The money sits in a smart contract (in tUSD8) that checks **every payment in both directions**:

- **The child pushes** payments out, inside rules the parent set: approved places, a per-payment limit, a weekly
  limit and an end date.
- **The school pulls** charges in, under a capped, expiring **billing permission** the parent granted. Each charge
  waits in a veto window before it can be paid.
- **A guardian**, which can be an AI agent, checks school charges and **can stop one but never approve one**.

> Every "yes" traces back to a permission the parent signed. AI can say no, never yes.

## How it works

**Child pays (push)**
1. The parent opens an allowance: limits, approved places (e.g. "School canteen"), an end date, and tops it up.
2. The child signs a payment on their phone. They **never pay gas**: a relayer submits the signed payment.
3. The contract checks the rules. Inside them, it pays. Outside them, it **refuses and records why** (a reason code)
   in a successful transaction, so no money moves and every "no" has a receipt.
4. For something unusual (a museum trip), the child asks for a **one-time exception**; the parent allows it once,
   for that exact amount and place.

**School bills (pull)**
1. The parent grants the school a billing permission: max per charge, max per week, expiry, waiting time.
2. The school's billing agent requests a charge with a note ("Lunch 26 Nov").
3. The charge **waits** (e.g. 2 minutes). The guardian agent reviews it: rules first (duplicate? weekend? price far
   above usual?), then an AI reads the note and answers *stop it*, *leave it* or *not sure*.
4. If nobody stops it, the school collects after the wait. If the guardian stopped it by mistake, **only the parent**
   can pay it anyway.
5. Optional: **hold while the guardian is offline.** Then silence isn't a yes: a charge waits until the guardian has
   come online and checked in.

**One tap stops everything:** pause the child, cancel a billing permission, or revoke all at once; older signed
payments and pending charges die with it.

## Key features

- 🧒 **Gasless child payments** with EIP-712 signed intents and a relayer that can't change them (any edit fails the
  signature check; replays are refused).
- 🧾 **Recorded refusals:** a refused payment or charge is a successful transaction with a reason code, not a revert.
- 🎟️ **One-time exceptions:** exact amount, exact place, single use.
- 🏫 **School pull billing** with per-charge and per-period caps, expiry, a veto window and optional first-charge
  approval.
- 🚦 **Veto-only AI guardian** running as an **ERC-4337 smart account** (Kernel v3.1). Its agent holds a session key
  that our own validator module only allows to call `vetoCharge` (and check in): no approvals, no transfers, no
  other contracts. Vetoes are user operations through QDay's bundler.
- ⏸️ **Hold while the guardian is offline:** charges wait instead of settling by silence.
- 🏦 **Money set aside for school** that the child's spending can't touch.
- 💸 **Gas-free top-ups** with EIP-3009 (`receiveWithAuthorization` on tUSD8).
- 🛑 **Instant revoke** via epochs: old signatures and pending items stop working.
- 🔒 **Memos stored as hashes only**; no admin, owner or upgrade key in the contract.
- 👀 **Demo mode everywhere:** every screen shows the live showcase family without a wallet, and a judge page
  triggers real problem charges on demand.

## Measured, not just claimed

- **Contracts:** 93 unit tests (incl. fuzz and invariant) + 13 tests on a fork of Aevum with the real tUSD8,
  EntryPoint and Kernel.
- **Live evidence:** 33/33 checks on Aevum through the hosted app and hosted AI guardian
  ([EVIDENCE.md](https://github.com/datharnu/pocket-rails/blob/main/docs/EVIDENCE.md)).
- **AI guardian evaluation** ([AI_EVAL.md](https://github.com/datharnu/pocket-rails/blob/main/docs/AI_EVAL.md)):
  - 50 frozen cases: 50/50 right with rules + AI (16/16 prompt injections caught, 0 genuine charges stopped).
  - A harder set of 42: 86% right, 13/13 injections caught (incl. other languages and hidden text), but 2 of 15
    genuine charges wrongly stopped and 2 small overcharges missed. We publish these honestly, and they're why the
    guardian can only say no: a wrong "no" can be overridden by the parent, a wrong "yes" is impossible.

## Tech stack

| Layer | What we used |
|---|---|
| Smart contracts | Solidity 0.8.24, Foundry, OpenZeppelin; EVM `shanghai` for Aevum |
| Token | tUSD8 (6 decimals) with EIP-2612 / EIP-3009 |
| Account abstraction | ERC-4337 EntryPoint v0.7, Kernel v3.1 smart account, our ERC-7579 `VetoOnlySessionValidator`, QDay's bundler `bundler.qday.info` |
| Signatures | EIP-712 typed intents, ERC-1271 support |
| Web app | Next.js 16, React, TypeScript, wagmi + viem |
| SDK | `@pocket-rails/sdk` (TypeScript): ABI, intents, reason codes, outcome decoding |
| Agents | Node.js + TypeScript: school billing agent and guardian agent |
| AI | Claude (Anthropic) with structured output; notes treated as untrusted data |
| Hosting | Railway (web app + both agents, 24/7) |
| Base | QDay `aevum-starter-kit` (credited in NOTICE.md) |

## Hackathon requirements

| Requirement | How Pocket Rails meets it |
|---|---|
| Public GitHub repository with clean, readable code | https://github.com/datharnu/pocket-rails (MIT; contracts, SDK, web app, agents, tests, docs) |
| Evidence the app uses QDay infrastructure | Contract deployed and source-verified on Aevum testnet; tUSD8 for all money; QDay's ERC-4337 bundler, EntryPoint and Kernel for the guardian; Aevum explorer links on every screen; 33 live checks with transactions |
| A working demo | Live app with demo mode and a judge page, plus a 2:52 video recorded live on Aevum |
| Problem, architecture, core workflows, technologies | This page, the [README](https://github.com/datharnu/pocket-rails#readme) (architecture diagrams, threats and controls, reason codes) and a [plain-English guide](https://github.com/datharnu/pocket-rails/blob/main/docs/GUIDE.md) |
| All settlement on QDay Aevum Testnet | Every payment, refusal, charge, veto and settlement is a transaction on Aevum testnet (chain 44005) |

## Honest limits

Testnet only, test tokens only, not audited. No fiat on- or off-ramp yet. Payees and amounts are public on-chain
(memos are hashed). The parent and child use ordinary wallets; only the guardian is a smart account so far.
QDay's ERC-8004 registry isn't open for this challenge, so approved places are stored in our contract.

## What's next

Parent as a smart account with recovery, payee identities via ERC-8004 when it opens, licensed on-/off-ramps,
an audit, and a pilot with one school (schools pay a small fee per settled charge; families use it free).
