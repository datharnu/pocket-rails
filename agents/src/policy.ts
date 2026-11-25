/**
 * The guardian's deterministic rules. Pure functions over on-chain facts, so they're easy to test.
 *
 * The guardian can only ever do two things with a charge: veto it, or leave it alone. "unknown" means it
 * couldn't judge (for example the note is missing): it leaves the charge alone and reports it, so the parent
 * decides. Nothing here can approve, raise a limit or move money; the contract wouldn't let it anyway.
 */

export type Decision =
  | { action: "veto"; rule: string; reason: string }
  | { action: "no_action"; rule: string; reason: string }
  | { action: "unknown"; rule: string; reason: string };

export interface ChargeFacts {
  id: bigint;
  billingId: bigint;
  amount: bigint;
  memoHash: string;
  status: number; // 1 Pending, 2 AwaitingParent, 3 Vetoed, 4 Settled, 5 Failed
  requestedAt: bigint; // settleAfter - vetoWindow
}

const LIVE = new Set([1, 2, 4]); // pending, awaiting parent, settled: these count as "already charged"

/** Same billing permission, same note (same memo hash), already charged earlier: a duplicate. */
export function duplicateOf(charge: ChargeFacts, others: ChargeFacts[]): ChargeFacts | undefined {
  return others.find(
    (o) => o.id < charge.id && o.billingId === charge.billingId && o.memoHash.toLowerCase() === charge.memoHash.toLowerCase() && LIVE.has(o.status),
  );
}

/** The usual price: the median of settled charges on this permission. Undefined until there are at least two. */
export function usualPrice(billingId: bigint, others: ChargeFacts[]): bigint | undefined {
  const settled = others.filter((o) => o.billingId === billingId && o.status === 4).map((o) => o.amount).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (settled.length < 2) return undefined;
  const mid = Math.floor(settled.length / 2);
  return settled.length % 2 ? settled[mid]! : (settled[mid - 1]! + settled[mid]!) / 2n;
}

/** Saturday or Sunday in UTC. */
export function isWeekend(ts: bigint): boolean {
  const day = new Date(Number(ts) * 1000).getUTCDay();
  return day === 0 || day === 6;
}

export interface PolicyOptions {
  /** A charge more than this multiple of the usual price is vetoed. Default 1.5. */
  maxOverUsual?: number;
  /** Veto charges requested on a weekend. Default true. */
  blockWeekends?: boolean;
  /** Known price when there's no history yet (in token units), e.g. the school's published meal price. */
  expectedPrice?: bigint;
}

const fmt = (v: bigint) => (Number(v) / 1e6).toString();

export function evaluate(charge: ChargeFacts, others: ChargeFacts[], opts: PolicyOptions = {}): Decision {
  const dup = duplicateOf(charge, others);
  if (dup) return { action: "veto", rule: "duplicate", reason: `Duplicate of charge #${dup.id} (same note, already charged)` };

  if ((opts.blockWeekends ?? true) && isWeekend(charge.requestedAt)) {
    return { action: "veto", rule: "weekend", reason: "Charged on a weekend, when there is no school" };
  }

  const usual = usualPrice(charge.billingId, others) ?? opts.expectedPrice;
  const limit = opts.maxOverUsual ?? 1.5;
  if (usual !== undefined && usual > 0n && Number(charge.amount) > Number(usual) * limit) {
    return { action: "veto", rule: "overprice", reason: `Higher than the usual price (${fmt(charge.amount)} vs usual ${fmt(usual)})` };
  }

  return { action: "no_action", rule: "rules", reason: "Passes the guardian's rules" };
}
