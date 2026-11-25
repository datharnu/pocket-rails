# Pocket Rails

**Kids pay out, the school bills in, parents set the rules once.**
Every payment, in either direction, is checked by the same smart contract on QDay Aevum testnet, in tUSD8.
AI helpers can say no, never yes: every yes traces back to a parent's signature.

> Built for Aevum Builder Challenge #1. **Testnet only, test tokens only, not audited.** No real money,
> no real children's data and no real merchants. It doesn't replace parental judgment.

---

## Status

| Part | State |
|---|---|
| `PocketRails.sol`: vaults, versioned rules, child payments, recorded refusals, one-time exceptions, school billing with veto window, revocation | Done: 56 unit and fuzz tests, 3 invariants (128,000 random calls), 2 fork tests on the real tUSD8 |
| TypeScript SDK (`packages/pocket-rails`): ABI, EIP-712 intents, reason codes, outcome decoding | Done |
| Relayer for child intents (`/api/rails/relay`) and outcome lookup (`/api/rails/tx`) | Done, tested end to end on a local chain (`pnpm example demo-flow`) |
| Deployment to Aevum testnet | Done: `0x7d54567d9D40641907B76A6b2fe6cb046e2B40Df` |
| Parent, child and school screens | To do |
| Guardian agent and school billing agent | To do |

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

---

## Safety model

| Threat | What stops it |
|---|---|
| Child's key is stolen | It can only pay approved payees inside the caps, or request exceptions. The parent revokes it instantly. |
| A relayer changes a payment | Intents are EIP-712 signatures over vault, payee, amount, memo, exception, nonce, epoch and deadline, bound to chain ID and contract address. Any change fails the signature check. |
| Replaying a payment or exception | Nonces are single-use (refused intents use them up too). Exceptions are single-use. |
| Old signed intents after a revoke | Revoking bumps an epoch; intents and exceptions from older epochs are refused. |
| School billing key is stolen | Charges are capped per charge and per period, wait out a veto window, and settle only to the treasury address the parent approved. |
| School overcharges or double-charges | The guardian agent or parent vetoes inside the window. |
| Guardian agent is fooled (prompt injection) or wrong | It can only veto. It can't approve, raise a limit or move money. The worst case is a wrongful veto, which the parent can override. |
| Guardian agent is offline | Charges inside the caps still settle after the window, like a bank direct debit. Use the first-charge approval and tight caps; a "hold all if the guardian is offline" setting is on the roadmap. |
| Admin abuse | There is no admin, owner or upgrade path. Only a vault's parent can change that vault. |
| Parent key is stolen | Out of scope for the contract: the parent key is the root of authority. Roadmap: parent as a smart account with recovery. |
| Privacy | Memos are stored as hashes only. Payees and amounts are public on any public chain; don't put personal details in labels. |

---

## Contracts

| Contract | Address (Aevum testnet, chain 44005) |
|---|---|
| PocketRails | [`0x7d54567d9D40641907B76A6b2fe6cb046e2B40Df`](https://explorer-test.qday.info/address/0x7d54567d9D40641907B76A6b2fe6cb046e2B40Df), deployed in block 4072059 by tx [`0xc77c22a4…b728`](https://explorer-test.qday.info/tx/0xc77c22a458fe2fc54d47085ccc195e5e496764174d01b502f03eeb9ffdabb728) |
| tUSD8 | [`0x456569838f1d43009A91ebA4263147Afd7233483`](https://explorer-test.qday.info/address/0x456569838f1d43009A91ebA4263147Afd7233483) |

The explorer's contract verifier isn't working yet, so the deployed source is the exact commit linked here
(_commit link to be added after the first push_). The deployed bytecode is 19,417 bytes, matching
`contracts/out/PocketRails.sol/PocketRails.json` at that commit. A live run of the full flow, with every transaction: [docs/DEMO_RUN.md](docs/DEMO_RUN.md). Demo accounts and their roles:
[docs/TESTNET_ACCOUNTS.md](docs/TESTNET_ACCOUNTS.md).

### Main functions

| Who | Function |
|---|---|
| Parent | `createVault`, `setRules`, `setPayee`, `setChild`, `revokeChild`, `setGuardian`, `revokeAll`, `withdraw` |
| Parent | `allowOnce`, `declineException`, `grantBilling`, `revokeBilling`, `approveCharge` |
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
   the exact commit (the explorer's verifier isn't working yet).

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
| `RELAYER_DAILY_TX_LIMIT` | no | Max relayed transactions per day per server process (default 500) |
| `TRUSTED_IP_HEADER` | on a hosted deploy | Header your host sets with the client IP (Vercel: `x-vercel-forwarded-for`) |
| `NEXT_PUBLIC_WC_PROJECT_ID` | no | Enables WalletConnect for mobile wallets |

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
- Refusals cost gas. The relayer rate-limits submissions; a child paying their own gas could add refusal
  noise to their own vault's history but can't move money.
- QDay's ERC-8004 registry isn't open for this challenge (per the starter kit), so approved payees are stored
  in this contract.

## Roadmap

- Parent as an ERC-4337 smart account (Kernel v3.1 is deployed on Aevum) with session-key permissions.
- Payee identities through QDay's ERC-8004 registry once it's open.
- "Hold all school charges while the guardian is offline" setting.
- Earmarked funds (school fees the child's spending can't touch).
- Fiat on- and off-ramps for cross-border family funding (not built today).

## Platform feedback

See [docs/PLATFORM_FEEDBACK.md](docs/PLATFORM_FEEDBACK.md).

## License

MIT. Based on the [Aevum Starter Kit](https://github.com/qday-io/aevum-starter-kit) (MIT). See
[NOTICE.md](NOTICE.md).
