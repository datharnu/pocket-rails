# Pocket Rails: pitch notes

Kids pay out, the school bills in, parents set the rules once.
One smart contract on Aevum testnet checks every payment in both directions, and the AI guardian can say no, never yes.

## 30-second spoken pitch

Parents choose between approving every payment and handing over a card with no limits. Pocket Rails sits in
between. The parent sets rules once; the child pays inside them without asking or paying gas. A refused
payment moves nothing; the child sees why and can ask for a one-time exception. The school bills
the same allowance under a capped permission, and each charge waits so a guardian, even an AI one, can stop
it. The guardian can say no, never yes.

## 100-word summary (submission form)

Pocket Rails is a family allowance in tUSD8 on Aevum testnet. A parent funds a smart contract and sets rules:
approved places, a per-payment limit, a weekly limit and an end date. The child pays inside them through a
relayer, without gas. Refused payments move no money but are recorded on-chain with a reason code and shown
in plain language. The school bills the same allowance under a capped, expiring permission, and each charge
waits in a veto window. A guardian agent with optional AI review can only veto. The parent can revoke
everything instantly. Testnet only, not audited.

## Judge questions

**How is this different from other spending-limit projects?**
Spending limits are only the base: the school pulls charges under a veto window, the guardian can only veto,
and refusals are recorded on-chain with a reason code instead of reverting.

**What happens if the guardian agent is offline or wrong?**
If it's offline, charges inside the caps still settle after the window, like a direct debit, so the parent sets
tight caps and can require approval of the first charge; if it vetoes wrongly, the parent can pay the charge anyway
from the parent screen ("Stopped charges", which calls `approveCharge`), and the guardian can never approve. On 50 frozen test notes, rules + AI vetoed every bad charge (including 16 prompt
injections) and no genuine one ([AI_EVAL.md](AI_EVAL.md)).

**Why would a school use this?**
Our hypothesis, not yet tested with schools: pre-approved, capped collection for meals, transport and trips
without chasing payments or handling cash, for a small fee per charge or per month.

**What does it not do?**
It runs on testnet only and isn't audited, has no fiat on- or off-ramp, doesn't use smart accounts or session
keys yet, keeps payees and amounts public on-chain, and doesn't stop charges inside the caps when the guardian
is offline.

## Sources in the repo

- How it works, reason codes, safety model, revocation, business model: [README.md](../README.md)
- Live transactions for every step: [DEMO_RUN.md](DEMO_RUN.md)
- Contract: [PocketRails.sol](../contracts/src/PocketRails.sol); tests: [contracts/test/](../contracts/test/)
- Agents: [agents/](../agents/)
