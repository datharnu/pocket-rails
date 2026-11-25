/**
 * Guardian agent: reviews school charges on every vault that names this key as guardian, and vetoes the ones
 * that look wrong while their veto window is open.
 *
 *   pnpm --filter agents guardian
 *
 * What it can do: veto. What it can't: approve, raise a limit, move money. That isn't a promise in this file,
 * it's the contract: vetoCharge is the only function this key is allowed to call.
 *
 * Each open charge goes through:
 *   1. deterministic rules (duplicate, weekend, price far above the usual) → veto if any matches
 *   2. optional AI review of the note (AI_REVIEW=1) → veto / no_action / unknown
 *   3. "unknown" (no note, AI unsure or unavailable) → leave it, report it, let the parent decide
 *
 * Env (agents/.env): RPC_URL, RAILS_ADDRESS, GUARDIAN_KEY, APP_URL, optional AI_REVIEW=1 (uses Anthropic
 * credentials from the environment), POLL_SECONDS (default 5), EXPECTED_PRICE (e.g. 0.3),
 * GUARDIAN_BLOCK_WEEKENDS (default 1; 0 turns the weekend rule off, e.g. for a hosted showcase).
 *
 * Smart-account mode (recommended): set GUARDIAN_ACCOUNT (the guardian's Kernel smart account),
 * GUARDIAN_VALIDATOR (VetoOnlySessionValidator), GUARDIAN_SESSION_KEY (the agent's session key) and
 * BUNDLER_URL. Vetoes are then sent as ERC-4337 user operations signed by a session key that the contracts
 * only allow to call vetoCharge. GUARDIAN_KEY isn't needed in this mode: the agent never holds the owner key.
 */
import { parseUnits } from "viem";
import { ChargeStatus, billingIsLive, connect, env, explain, log, readNotes, send, sleep, snapshot, usd, type Snapshot } from "./lib";
import { evaluate, usualPrice, type ChargeFacts, type Decision } from "./policy";
import { aiEnabled, reviewNote } from "./review";
import { vetoViaSmartAccount } from "./userop";
import type { Address } from "viem";

const AGENT = "guardian";
const SMART = Boolean(process.env.GUARDIAN_ACCOUNT?.trim() && process.env.GUARDIAN_SESSION_KEY?.trim());
const c = await connect(SMART ? "GUARDIAN_SESSION_KEY" : "GUARDIAN_KEY");
const guardianAddress = (SMART ? env("GUARDIAN_ACCOUNT") : c.account.address) as Address;
const validator = (SMART ? env("GUARDIAN_VALIDATOR") : "") as Address;
const bundlerUrl = env("BUNDLER_URL", "https://bundler.qday.info");
const POLL = Number(env("POLL_SECONDS", "5")) * 1000;
const expected = process.env.EXPECTED_PRICE ? parseUnits(process.env.EXPECTED_PRICE, 6) : undefined;
// The weekend rule can be turned off for a hosted showcase where judges trigger charges on any day.
const BLOCK_WEEKENDS = (process.env.GUARDIAN_BLOCK_WEEKENDS ?? "1") !== "0";

// Decisions already taken this session (no_action / unknown), so the AI isn't asked again every poll.
const decided = new Map<bigint, Decision>();

log(AGENT, `watching PocketRails ${c.rails} as ${guardianAddress} on ${c.chain.name}`);
log(AGENT, SMART ? `smart-account mode: session key ${c.account.address} (veto-only), via ${bundlerUrl}` : "EOA mode: vetoes are signed by GUARDIAN_KEY");
log(AGENT, `AI review: ${aiEnabled() ? "on (claude-opus-5-5)" : "off (rules only; set AI_REVIEW=1 to enable)"}`);

function facts(s: Snapshot): ChargeFacts[] {
  return [...s.charges].map(([id, ch]) => {
    const b = s.billings.get(ch.billingId)!;
    return { id, billingId: ch.billingId, amount: ch.amount, memoHash: ch.memoHash, status: ch.status, requestedAt: ch.settleAfter - b.vetoWindow };
  });
}

async function tick() {
  const s = await snapshot(c);
  const all = facts(s);
  const mine = new Set([...s.vaults].filter(([, v]) => v.guardian.toLowerCase() === guardianAddress.toLowerCase()).map(([id]) => id));
  if (mine.size === 0) return;

  const open = all.filter((f) => {
    const b = s.billings.get(f.billingId)!;
    if (!mine.has(b.vaultId) || !billingIsLive(s, b)) return false;
    const ch = s.charges.get(f.id)!;
    // Pending: only while the window is open (the contract refuses later vetoes). Awaiting parent: any time.
    return (f.status === ChargeStatus.Pending && s.now < ch.settleAfter) || f.status === ChargeStatus.AwaitingParent;
  });
  if (open.length === 0) return;

  const notes = await readNotes(open.map((f) => f.memoHash));

  for (const f of open) {
    if (decided.has(f.id)) continue;
    const b = s.billings.get(f.billingId)!;
    let d = evaluate(f, all, { expectedPrice: expected, blockWeekends: BLOCK_WEEKENDS });

    if (d.action === "no_action") {
      const note = notes[f.memoHash.toLowerCase()];
      if (!note) {
        d = { action: "unknown", rule: "note", reason: "No note published for this charge, so it can't be checked" };
      } else if (aiEnabled()) {
        const usual = usualPrice(f.billingId, all) ?? expected;
        d = await reviewNote({ amount: usd(f.amount), usual: usual !== undefined ? usd(usual) : undefined, maxPerCharge: usd(b.maxPerCharge), note });
        if (d.reason.includes("rate-limited")) continue; // try again next poll
      }
    }

    const label = `vault #${b.vaultId} charge #${f.id} (${usd(f.amount)} tUSD8, "${notes[f.memoHash.toLowerCase()] ?? "no note"}")`;
    if (d.action === "veto") {
      try {
        if (SMART) {
          const r = await vetoViaSmartAccount(c, { account: guardianAddress, validator, bundlerUrl, chargeId: f.id, reason: d.reason.slice(0, 140) });
          log(AGENT, `VETO ${label}: ${d.reason} → recorded on-chain via user operation ${r.userOpHash.slice(0, 10)}… ${c.link(r.txHash)}`);
        } else {
          const { hash, outcome } = await send(c, "vetoCharge", [f.id, d.reason.slice(0, 140)]);
          log(AGENT, `VETO ${label}: ${d.reason} → ${outcome.kind === "failed" ? "transaction failed" : "recorded on-chain"} ${c.link(hash)}`);
        }
        decided.set(f.id, d);
      } catch (e) {
        // Most often the window closed or the parent already decided. Next poll re-reads the chain.
        log(AGENT, `could not veto ${label}: ${explain(e)}`);
      }
    } else {
      const already = decided.get(f.id);
      if (!already || already.reason !== d.reason) {
        log(AGENT, `${d.action === "unknown" ? "UNKNOWN" : "ok"} ${label}: ${d.reason}${d.action === "unknown" ? " (left for the parent)" : ""}`);
      }
      // A missing note may still arrive: look again next poll. Everything else is settled for this session.
      if (d.rule !== "note") decided.set(f.id, d);
    }
  }
}

for (;;) {
  try {
    await tick();
  } catch (e) {
    log(AGENT, `poll failed, retrying: ${explain(e)}`);
  }
  await sleep(POLL);
}
