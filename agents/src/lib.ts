import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  isHex,
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { aevumFork, aevumTestnet, localAnvil, txUrl } from "@aevum-kit/aevum";
import { decodeOutcome, memoHash, pocketRailsAbi, revertText, type Outcome } from "@pocket-rails/sdk";

// ------------------------------------------------------------------ settings

export function env(name: string, fallback?: string): string {
  const v = process.env[name]?.trim();
  if (v) return v;
  if (fallback !== undefined) return fallback;
  console.error(`Missing ${name}. Copy agents/.env.example to agents/.env and fill it in.`);
  process.exit(1);
}

export function envKey(name: string): Hex {
  const v = env(name);
  const k = (v.startsWith("0x") ? v : `0x${v}`) as Hex;
  if (!isHex(k) || k.length !== 66) {
    console.error(`${name} must be a 32-byte hex private key.`);
    process.exit(1);
  }
  return k;
}

export function envAddress(name: string): Address {
  const v = env(name);
  if (!isAddress(v)) {
    console.error(`${name} is not a valid address.`);
    process.exit(1);
  }
  return v;
}

export function log(agent: string, msg: string) {
  console.log(`${new Date().toISOString().slice(11, 19)} [${agent}] ${msg}`);
}

// ------------------------------------------------------------------ chain

export async function connect(keyVar: string) {
  const rpcUrl = env("RPC_URL", aevumTestnet.rpcUrls.default.http[0]);
  const probe = createPublicClient({ transport: http(rpcUrl) });
  const id = await probe.getChainId();
  const chain = id === aevumTestnet.id ? aevumTestnet : id === aevumFork.id ? aevumFork : { ...localAnvil, id };
  const transport = http(rpcUrl, { retryCount: 3, retryDelay: 500 });
  const client = createPublicClient({ chain, transport });
  const account = privateKeyToAccount(envKey(keyVar), { nonceManager });
  const wallet = createWalletClient({ account, chain, transport });
  const rails = envAddress("RAILS_ADDRESS");
  const link = (h: string) => (chain.id === aevumTestnet.id ? txUrl(h) : h);
  return { client, wallet, account, chain, rails, link };
}

export type Conn = Awaited<ReturnType<typeof connect>>;

export type Vault = {
  parent: Address;
  child: Address;
  guardian: Address;
  childActive: boolean;
  childEpoch: bigint;
  billingEpoch: bigint;
  version: bigint;
  week: bigint;
  weekSpent: bigint;
  balance: bigint;
  schoolReserve: bigint;
  rules: { perPaymentLimit: bigint; weeklyLimit: bigint; expiresAt: bigint };
};
export type Billing = {
  vaultId: bigint;
  biller: Address;
  payTo: Address;
  maxPerCharge: bigint;
  maxPerPeriod: bigint;
  period: bigint;
  startAt: bigint;
  expiresAt: bigint;
  vetoWindow: bigint;
  epoch: bigint;
  periodIndex: bigint;
  revoked: boolean;
  firstChargeNeedsApproval: boolean;
  hasSettled: boolean;
  periodUsed: bigint;
};
export type Charge = { billingId: bigint; amount: bigint; memoHash: Hex; settleAfter: bigint; periodIndex: bigint; status: number };

export const ChargeStatus = { None: 0, Pending: 1, AwaitingParent: 2, Vetoed: 3, Settled: 4, Failed: 5 } as const;

/** Reads a whole list (vaults, billings or charges) by id with one multicall. Current state, never history. */
async function readAll<T>(c: Conn, counter: "vaultCount" | "billingCount" | "chargeCount", getter: "getVault" | "getBilling" | "getCharge") {
  const count = (await c.client.readContract({ address: c.rails, abi: pocketRailsAbi, functionName: counter })) as bigint;
  const ids: bigint[] = [];
  for (let i = 1n; i <= count; i++) ids.push(i);
  if (ids.length === 0) return new Map<bigint, T>();
  const calls = ids.map((id) => ({ address: c.rails, abi: pocketRailsAbi, functionName: getter, args: [id] }) as const);
  // Aevum has Multicall3 (one request for the whole list); a blank local chain doesn't, so read one by one.
  const res = c.chain.contracts?.multicall3
    ? await c.client.multicall({ contracts: calls, allowFailure: false })
    : await Promise.all(calls.map((call) => c.client.readContract(call)));
  return new Map(ids.map((id, i) => [id, res[i] as T]));
}

export async function snapshot(c: Conn) {
  const [vaults, billings, charges, block] = await Promise.all([
    readAll<Vault>(c, "vaultCount", "getVault"),
    readAll<Billing>(c, "billingCount", "getBilling"),
    readAll<Charge>(c, "chargeCount", "getCharge"),
    c.client.getBlock(),
  ]);
  // "Hold while the guardian is offline": per-vault switch, and how far each guardian has reviewed.
  const vaultIds = [...vaults.keys()];
  const guardians = [...new Set([...vaults.values()].map((v) => v.guardian.toLowerCase()))].filter((g) => g !== zeroAddress) as Address[];
  const [holdList, seenList] = await Promise.all([
    Promise.all(vaultIds.map((id) => c.client.readContract({ address: c.rails, abi: pocketRailsAbi, functionName: "holdIfGuardianSilent", args: [id] }))),
    Promise.all(guardians.map((g) => c.client.readContract({ address: c.rails, abi: pocketRailsAbi, functionName: "guardianLastSeen", args: [g] }))),
  ]);
  const holds = new Map(vaultIds.map((id, i) => [id, holdList[i]] as const));
  const lastSeen = new Map(guardians.map((g, i) => [g, BigInt(seenList[i])] as const));
  return { vaults, billings, charges, holds, lastSeen, now: block.timestamp };
}

/** Mirrors the contract: the hold is on, there's a guardian, and it hasn't reviewed up to the charge's request time. */
export function guardianSilentFor(s: { vaults: Map<bigint, Vault>; billings: Map<bigint, Billing>; holds: Map<bigint, boolean>; lastSeen: Map<string, bigint> }, ch: Charge): boolean {
  const b = s.billings.get(ch.billingId);
  if (!b) return false;
  const v = s.vaults.get(b.vaultId);
  if (!v || !s.holds.get(b.vaultId) || v.guardian === zeroAddress) return false;
  return (s.lastSeen.get(v.guardian.toLowerCase()) ?? 0n) <= ch.settleAfter - b.vetoWindow;
}

export type Snapshot = Awaited<ReturnType<typeof snapshot>>;

export function billingIsLive(s: Snapshot, b: Billing): boolean {
  const v = s.vaults.get(b.vaultId);
  return Boolean(v) && !b.revoked && b.epoch === v!.billingEpoch && s.now < b.expiresAt;
}

// ------------------------------------------------------------------ transactions

const NONCE_ERROR = /nonce too low|nonce has already been used|replacement transaction underpriced|already known/i;

export function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName) {
      return revertText[revert.data.errorName] ?? revert.data.errorName;
    }
    if (/insufficient funds/i.test(e.message)) return "This agent's wallet is out of tQDAY for gas.";
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Simulate (reverts cost nothing) → send as a legacy transaction → wait for the receipt → decode the outcome.
 * Retries once if this agent's own nonce is out of sync (e.g. after a restart while a tx was pending).
 */
export async function send(c: Conn, functionName: string, args: readonly unknown[]): Promise<{ hash: Hash; outcome: Outcome }> {
  const call = { account: c.account, address: c.rails, abi: pocketRailsAbi, functionName, args } as never;
  await c.client.simulateContract(call);
  let hash: Hash;
  try {
    hash = await c.wallet.writeContract({ ...(call as object), type: "legacy" } as never);
  } catch (e) {
    if (!(e instanceof BaseError && NONCE_ERROR.test(e.message))) throw e;
    nonceManager.reset({ address: c.account.address, chainId: c.chain.id });
    hash = await c.wallet.writeContract({ ...(call as object), type: "legacy" } as never);
  }
  const receipt = await c.client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  return { hash, outcome: decodeOutcome(receipt, c.rails) };
}

// ------------------------------------------------------------------ notes (off-chain text for memo hashes)

const APP_URL = () => env("APP_URL", "http://localhost:3000").replace(/\/+$/, "");

/** Publishes a note so the parent and guardian can read it. Returns its memo hash (computed locally either way). */
export async function publishNote(text: string): Promise<Hex> {
  const hash = memoHash(text);
  try {
    await fetch(`${APP_URL()}/api/rails/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    /* the charge still works without the note; the guardian will treat it as "unknown" */
  }
  return hash;
}

export async function readNotes(hashes: string[]): Promise<Record<string, string>> {
  if (hashes.length === 0) return {};
  try {
    const res = await fetch(`${APP_URL()}/api/rails/notes?hashes=${hashes.join(",")}`);
    return ((await res.json()) as { notes?: Record<string, string> }).notes ?? {};
  } catch {
    return {};
  }
}

export const usd = (v: bigint) => (Number(v) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
