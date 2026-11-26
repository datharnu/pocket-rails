/**
 * Guardian agent: reviews school charges on every vault that names this key as guardian, and vetoes the ones
 * that look wrong while their veto window is open.
 *
 *   pnpm --filter agents guardian
 *
 * What it can do: veto, and check in. What it can't: approve, raise a limit, move money. That isn't a promise in
 * this file, it's the contracts: in smart-account mode the session key may only call vetoCharge and guardianCheckIn.
 *
 * Check-in: a parent can turn on "hold school charges while the guardian is offline". Then a charge only settles
 * after the guardian has checked in with a time later than the charge, so this agent checks in after each review
 * pass that leaves held charges decided. It passes the time of the chain state it reviewed, never "now", so a
 * charge that arrives while the check-in is on its way stays held until the next pass.
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
import { ChargeStatus, billingIsLive, connect, env, explain, guardianSilentFor, log, readNotes, send, sleep, snapshot, usd, type Snapshot } from "./lib";
import { evaluate, usualPrice, type ChargeFacts, type Decision } from "./policy";
import { aiEnabled, reviewNote } from "./review";
import { checkInViaSmartAccount, vetoViaSmartAccount } from "./userop";
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
    // Pending: while the window is open, or while it's held waiting for this guardian (the contract refuses
    // other late vetoes). Awaiting parent: any time.
    return (f.status === ChargeStatus.Pending && (s.now < ch.settleAfter || guardianSilentFor(s, ch))) || f.status === ChargeStatus.AwaitingParent;
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
      // A missing note may still arrive: look again next poll, until the charge's window is over.
      // Everything else is settled for this session.
      if (d.rule !== "note" || s.now >= s.charges.get(f.id)!.settleAfter) decided.set(f.id, d);
    }
  }

  await checkIn(s, open);
}

/**
 * Check in if a held (or soon-to-be-held) charge has been reviewed. Checks in up to the snapshot time, or just
 * before the earliest charge this pass couldn't decide, so nothing unreviewed is ever released.
 */
let lastCheckInError = "";

async function checkIn(s: Snapshot, open: ChargeFacts[]) {
  const seen = s.lastSeen.get(guardianAddress.toLowerCase() as Address) ?? 0n;
  const waiting = open.filter((f) => f.status === ChargeStatus.Pending && s.holds.get(s.billings.get(f.billingId)!.vaultId) && f.requestedAt >= seen);
  if (waiting.length === 0) return;
  const undecided = waiting.filter((f) => !decided.has(f.id)).map((f) => f.requestedAt);
  // The contract releases a charge when reviewedUntil > requestedAt, so stopping at the earliest undecided
  // charge's own request time keeps it (and anything later) held.
  const until = undecided.length ? undecided.reduce((a, b) => (a < b ? a : b)) : s.now;
  if (until <= seen || !waiting.some((f) => f.requestedAt < until)) return;
  try {
    if (SMART) {
      const r = await checkInViaSmartAccount(c, { account: guardianAddress, validator, bundlerUrl, reviewedUntil: until });
      log(AGENT, `checked in: reviewed everything requested before ${new Date(Number(until) * 1000).toISOString()} via user operation ${r.userOpHash.slice(0, 10)}… ${c.link(r.txHash)}`);
    } else {
      const { hash } = await send(c, "guardianCheckIn", [until]);
      log(AGENT, `checked in: reviewed everything requested before ${new Date(Number(until) * 1000).toISOString()} ${c.link(hash)}`);
    }
  } catch (e) {
    const why = explain(e);
    if (why !== lastCheckInError) log(AGENT, `could not check in (will retry): ${why}`);
    lastCheckInError = why;
    return;
  }
  lastCheckInError = "";
}

for (;;) {
  try {
    await tick();
  } catch (e) {
    log(AGENT, `poll failed, retrying: ${explain(e)}`);
  }
  await sleep(POLL);
}
