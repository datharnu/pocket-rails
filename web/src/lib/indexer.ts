import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, http, parseEventLogs, type Address, type PublicClient } from "viem";
import { MAX_LOG_RANGE } from "@aevum-kit/aevum";
import { pocketRailsAbi } from "@pocket-rails/sdk";
import type { Network } from "@/lib/env";

/**
 * A small event cache for PocketRails history (the timeline with transaction links).
 *
 * Aevum makes ~85,000 blocks a day and eth_getLogs covers at most 1,000 blocks per call, so a browser
 * can't scan history itself. This scans once from the deploy block (several chunks in parallel), saves
 * the result to web/.cache/, and afterwards only reads new blocks. Current state never comes from here:
 * pages read it straight from the contract.
 *
 * Production would use a proper indexer; this is enough for one server (local, a VPS, a container).
 * On serverless hosting each cold start rescans from the cache file if it exists, else from the deploy block.
 */

export interface RailsEvent {
  eventName: string;
  args: Record<string, string | number | boolean>;
  blockNumber: string;
  txHash: string;
  logIndex: number;
}

interface Cache {
  rails: Address;
  scannedTo: string; // last block included
  events: RailsEvent[];
}

const PARALLEL = 6;
const CACHE_DIR = path.join(process.cwd(), ".cache");
const state = new Map<string, { cache: Cache; running?: Promise<void>; lastRun: number }>();

function cacheFile(net: Network) {
  return path.join(CACHE_DIR, `rails-events-${net.chain.id}-${net.rails!.toLowerCase()}.json`);
}

function plain(v: unknown): string | number | boolean {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
}

async function load(net: Network): Promise<Cache> {
  const fresh: Cache = { rails: net.rails!, scannedTo: String((net.railsDeployBlock ?? 1n) - 1n), events: [] };
  try {
    const c = JSON.parse(await readFile(cacheFile(net), "utf8")) as Cache;
    return c.rails.toLowerCase() === net.rails!.toLowerCase() ? c : fresh;
  } catch {
    return fresh;
  }
}

async function scanRange(client: PublicClient, rails: Address, from: bigint, to: bigint): Promise<RailsEvent[]> {
  const logs = await client.getLogs({ address: rails, fromBlock: from, toBlock: to });
  return parseEventLogs({ abi: pocketRailsAbi, logs }).map((e) => ({
    eventName: e.eventName,
    args: Object.fromEntries(Object.entries(e.args as Record<string, unknown>).map(([k, v]) => [k, plain(v)])),
    blockNumber: e.blockNumber.toString(),
    txHash: e.transactionHash,
    logIndex: e.logIndex,
  }));
}

async function catchUp(net: Network, entry: { cache: Cache }) {
  const client = createPublicClient({ chain: net.chain, transport: http(undefined, { retryCount: 3 }) });
  const head = await client.getBlockNumber();
  let from = BigInt(entry.cache.scannedTo) + 1n;
  while (from <= head) {
    // A batch of up to PARALLEL chunks of 1,000 blocks, fetched at once.
    const ranges: [bigint, bigint][] = [];
    for (let i = 0; i < PARALLEL && from <= head; i++) {
      const to = from + MAX_LOG_RANGE - 1n > head ? head : from + MAX_LOG_RANGE - 1n;
      ranges.push([from, to]);
      from = to + 1n;
    }
    const results = await Promise.all(ranges.map(([a, b]) => scanRange(client as PublicClient, net.rails!, a, b)));
    entry.cache.events.push(...results.flat());
    entry.cache.scannedTo = ranges[ranges.length - 1]![1].toString();
  }
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cacheFile(net), JSON.stringify(entry.cache));
}

/** All PocketRails events up to (nearly) now. Concurrent callers share one scan. */
export async function railsEvents(net: Network, maxAgeMs = 3000): Promise<{ events: RailsEvent[]; scannedTo: string }> {
  if (!net.rails) return { events: [], scannedTo: "0" };
  const key = `${net.chain.id}:${net.rails.toLowerCase()}`;
  let entry = state.get(key);
  if (!entry) {
    entry = { cache: await load(net), lastRun: 0 };
    state.set(key, entry);
  }
  if (!entry.running && Date.now() - entry.lastRun > maxAgeMs) {
    const e = entry;
    e.running = catchUp(net, e)
      .catch((err) => console.error("[indexer] scan failed, will retry", err))
      .finally(() => {
        e.running = undefined;
        e.lastRun = Date.now();
      });
  }
  if (entry.running) await entry.running;
  return { events: entry.cache.events, scannedTo: entry.cache.scannedTo };
}
