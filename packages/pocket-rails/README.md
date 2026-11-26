# @pocket-rails/sdk

TypeScript helpers for [PocketRails](../../README.md) on QDay Aevum testnet: the contract ABI, the EIP-712 intents a
child signs, reason codes with plain-language messages, and decoding of what a transaction did. Built on
[viem](https://viem.sh) (peer dependency). MIT.

The same package powers this repo's web app, relayer, agents and evidence script, so every example below is code
that runs in production on the hosted demo.

| Export | What it's for |
|---|---|
| `pocketRailsAbi` | The full contract ABI, generated from the compiled contract (`tools/export-abi.mjs`) |
| `pocketRailsDomain(chainId, contract)`, `paymentTypes`, `exceptionRequestTypes` | EIP-712 domain and types for the two intents a child signs |
| `Payment`, `ExceptionRequest` | Intent shapes (all numbers are `bigint`) |
| `memoHash(text)`, `randomNonce()`, `deadlineIn(seconds)` | Build an intent: memos go on-chain as a hash only; nonces are unordered; deadlines are short |
| `toWire(intent)` | `bigint` → string, for an HTTP body (e.g. to a relayer) |
| `Reason`, `reasonText`, `explainReason(code)` | The 14 reason codes (0 = none), each with a child-friendly message, a next step and whether asking for an exception makes sense |
| `decodeOutcome(receipt, contract)` | Turns a receipt into `allow`, `refuse` (with `reason`), `pending`, `other` or `failed`, plus a message and the decoded events |
| `revertText` | Plain-language text for the contract's custom errors |

## Sign a child's payment and send it through a relayer

```ts
import { privateKeyToAccount } from "viem/accounts";
import { deadlineIn, memoHash, paymentTypes, pocketRailsDomain, randomNonce, toWire, type Payment } from "@pocket-rails/sdk";

const rails = "0xB179197A660029b1d96FEF09e3E8515b271E3801"; // PocketRails v2 on Aevum (chain 44005)
const child = privateKeyToAccount(process.env.CHILD_KEY as `0x${string}`); // a TEST key; it needs no gas

const payment: Payment = {
  vaultId: 1n,
  payee: "0x8C6a84C3B1463EB302214D8356280aE218e0368F", // an approved place
  amount: 300_000n, // 0.30 tUSD8 (6 decimals)
  memoHash: memoHash("lunch"),
  exceptionId: 0n, // 0 = inside the standing rules
  nonce: randomNonce(),
  epoch: 1n, // read getVault(vaultId).childEpoch: a revoke bumps it and kills older intents
  deadline: deadlineIn(300),
};
const signature = await child.signTypedData({ domain: pocketRailsDomain(44005, rails), types: paymentTypes, primaryType: "Payment", message: payment });

// Any relayer can submit it and pay the gas, but can't change it: the contract checks the signature.
const res = await fetch("https://web-production-b9d9f11e.up.railway.app/api/rails/relay", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ chainId: 44005, kind: "pay", intent: toWire(payment), signature }),
});
const { hash } = await res.json();
```

## Check before sending, and explain the answer

```ts
import { explainReason, Reason } from "@pocket-rails/sdk";

// previewPayment runs the same checks the contract will, without sending anything.
const code = await client.readContract({ address: rails, abi: pocketRailsAbi, functionName: "previewPayment", args: [1n, payee, 800_000n, memoHash("snacks"), 0n] });
if (Number(code) !== Reason.None) {
  const r = explainReason(code); // { message: "This is more than you can spend in one payment.", nextStep: "...", canAskException: true }
}
```

## Read what a transaction did

A refused payment is a **successful** transaction that records a reason and moves no money, so "did it revert?"
isn't the right question. `decodeOutcome` answers the right one:

```ts
import { decodeOutcome } from "@pocket-rails/sdk";

const receipt = await client.waitForTransactionReceipt({ hash });
const outcome = decodeOutcome(receipt, rails);
// { kind: "refuse", reason: 4, message: "This is more than you can spend in one payment.", events: [...] }
```

## Reusing it for your own contract

Two ideas here travel well beyond allowances:

- **Recorded refusals with reason codes:** return a reason instead of reverting, emit it, and map each code to a
  message and a next step (`reasons.ts`). Users get an explanation and auditors get a receipt for every "no".
- **Outcome decoding by events, not by revert:** `outcome.ts` is ~60 lines and works for any contract that
  emits "allowed / refused / pending" events.

The veto-only smart-account session key used by the guardian is a separate, reusable template:
[docs/VETO_ONLY_SESSION_KEY.md](../../docs/VETO_ONLY_SESSION_KEY.md).

## Build

```
pnpm --filter @pocket-rails/sdk build     # dist/ with .js + .d.ts, plain Node ESM
```

Inside this monorepo the apps import the TypeScript source directly; the published package (`publishConfig`)
points at `dist/`. Not yet published to npm.
