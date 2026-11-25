import { parseEventLogs, type Address, type Hash, type Log, type TransactionReceipt } from "viem";
import { pocketRailsAbi } from "./abi";
import { explainReason, Reason } from "./reasons";

/**
 * What a confirmed PocketRails transaction did, read from its events.
 *
 *   allow   – money moved (Paid, ChargeSettled)
 *   refuse  – a rule was broken; nothing moved (Refused, ChargeRefused, ChargeFailed)
 *   pending – waiting on a parent or a veto window (ExceptionRequested, ChargeRequested)
 *   other   – a configuration change or decision (rules, payees, vetoes, approvals…)
 *   failed  – the transaction itself reverted; nothing was recorded
 *
 * "Unknown" is not here on purpose: it's an off-chain state (not yet confirmed, RPC down, can't verify).
 * Until you have a receipt, show "unknown" and don't assume anything.
 */
export type OutcomeKind = "allow" | "refuse" | "pending" | "other" | "failed";

export interface Outcome {
  kind: OutcomeKind;
  hash: Hash;
  blockNumber: bigint;
  /** Set when kind is "refuse". */
  reason?: Reason;
  message: string;
  events: { eventName: string; args: Record<string, unknown> }[];
}

const ALLOW = new Set(["Paid", "ChargeSettled"]);
const REFUSE = new Set(["Refused", "ChargeRefused", "ChargeFailed"]);
const PENDING = new Set(["ExceptionRequested", "ChargeRequested"]);

export function decodeOutcome(receipt: TransactionReceipt, rails: Address): Outcome {
  const base = { hash: receipt.transactionHash, blockNumber: receipt.blockNumber };
  if (receipt.status !== "success") {
    return { ...base, kind: "failed", message: "The transaction failed. Nothing was paid or recorded.", events: [] };
  }
  const ours = receipt.logs.filter((l: Log) => l.address.toLowerCase() === rails.toLowerCase());
  const events = parseEventLogs({ abi: pocketRailsAbi, logs: ours }).map((e) => ({
    eventName: e.eventName,
    args: e.args as Record<string, unknown>,
  }));

  const refused = events.find((e) => REFUSE.has(e.eventName));
  if (refused) {
    const reason = Number(refused.args.reason) as Reason;
    return { ...base, kind: "refuse", reason, message: explainReason(reason).message, events };
  }
  if (events.some((e) => ALLOW.has(e.eventName))) return { ...base, kind: "allow", message: "Paid.", events };
  const pending = events.find((e) => PENDING.has(e.eventName));
  if (pending) {
    const message =
      pending.eventName === "ExceptionRequested"
        ? "Request sent. Waiting for your parent."
        : "Charge received. It waits out the veto window before it can settle.";
    return { ...base, kind: "pending", message, events };
  }
  return { ...base, kind: "other", message: "Done.", events };
}
