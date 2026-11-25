import { isHex, type Hex } from "viem";
import { nonceManager, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { aevumFork, isAnvilAccount, localAnvil } from "@aevum-kit/aevum";
import type { Network } from "@/lib/env";

/**
 * Shared protections for any route that spends the relayer's gas (adapted from the starter kit's relayer).
 *
 * The limits live in this process's memory. That's fine for `next start` on one server. On serverless
 * (Vercel…) each instance has its own copy and loses it on a cold start: move them to a shared store
 * (Redis, Upstash, your database) before you rely on them. The contract never depends on these limits;
 * they only protect the relayer's tQDAY.
 */

const LOCAL_CHAINS = new Set<number>([localAnvil.id, aevumFork.id]);

let cachedAccount: PrivateKeyAccount | null | undefined;

/** One account for the whole process, so viem's nonce manager hands out nonces without collisions. */
export function relayerAccount(): PrivateKeyAccount | undefined {
  if (cachedAccount !== undefined) return cachedAccount ?? undefined;
  const raw = process.env.RELAYER_PRIVATE_KEY?.trim();
  const key = (raw?.startsWith("0x") ? raw : `0x${raw ?? ""}`) as Hex;
  cachedAccount = raw && isHex(key) && key.length === 66 ? privateKeyToAccount(key, { nonceManager }) : null;
  return cachedAccount ?? undefined;
}

/** anvil's default keys are public. On a real network, bots would empty that relayer in seconds. */
export function usableOn(net: Network): PrivateKeyAccount | undefined {
  const account = relayerAccount();
  if (!account) return undefined;
  if (isAnvilAccount(account.address) && !LOCAL_CHAINS.has(net.chain.id)) return undefined;
  return account;
}

const hits = new Map<string, number[]>();

/** Sliding-window limit: true when `bucket` had more than `max` hits in the last `windowMs`. */
export function limited(bucket: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const recent = (hits.get(bucket) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(bucket, recent);
  if (hits.size > 10_000) {
    for (const [k, times] of hits) if (times.every((t) => now - t >= 3_600_000)) hits.delete(k);
  }
  return recent.length > max;
}

/** Counts a hit without recording one, for budgets we only charge when something is actually sent. */
export function count(bucket: string, windowMs: number): number {
  const now = Date.now();
  return (hits.get(bucket) ?? []).filter((t) => now - t < windowMs).length;
}

export function record(bucket: string): void {
  hits.set(bucket, [...(hits.get(bucket) ?? []), Date.now()]);
}

const DAILY_TX_LIMIT = Number(process.env.RELAYER_DAILY_TX_LIMIT ?? 500);
let day = "";
let sentToday = 0;

export function overDailyLimit(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    sentToday = 0;
  }
  return sentToday >= DAILY_TX_LIMIT;
}

export function countSent(): void {
  sentToday++;
}

const IN_FLIGHT_MS = 120_000;
const inFlight = new Map<string, number>();

/** Stops the same intent being submitted twice at once (double clicks, client retries). */
export function claimInFlight(key: string): boolean {
  const now = Date.now();
  for (const [k, t] of inFlight) if (now - t > IN_FLIGHT_MS) inFlight.delete(k);
  if (inFlight.has(key)) return false;
  inFlight.set(key, now);
  return true;
}

export function releaseInFlight(key: string): void {
  inFlight.delete(key);
}

/**
 * The caller's IP. Clients can write any X-Forwarded-For they like, so never trust its first entry.
 * Set TRUSTED_IP_HEADER to the header your host sets itself (Vercel: x-vercel-forwarded-for).
 */
export function clientIp(req: Request): string {
  const trusted = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (trusted) return req.headers.get(trusted)?.split(",")[0]?.trim() || "unknown";
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",").at(-1)?.trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
