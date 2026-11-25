"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { formatUnits, parseUnits, type Abi, type Address, type Hash } from "viem";
import { useAccount, useConfig, useReadContract, useReadContracts } from "wagmi";
import { simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { decodeOutcome, pocketRailsAbi, type Outcome } from "@pocket-rails/sdk";
import { useNetwork } from "@/lib/network";
import { explainRails } from "@/lib/railsErrors";

/** tUSD8 has 6 decimals. */
export const DECIMALS = 6;

export function fmt(v: bigint | undefined, max = 2): string {
  if (v === undefined) return "…";
  const n = Number(formatUnits(v, DECIMALS));
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: max });
}

/** Parses a user-typed amount ("1.5") into token units, or undefined if it isn't a positive number. */
export function parseAmount(s: string): bigint | undefined {
  const t = s.trim();
  if (!/^\d+(\.\d{0,6})?$/.test(t)) return undefined;
  const v = parseUnits(t, DECIMALS);
  return v > 0n ? v : undefined;
}

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
export const sameAddr = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
export const nowSec = () => BigInt(Math.floor(Date.now() / 1000));

export function timeLeft(until: bigint | number): string {
  const s = Number(until) - Math.floor(Date.now() / 1000);
  if (s <= 0) return "now";
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}

export function dateOf(ts: bigint | number): string {
  return new Date(Number(ts) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function useRails() {
  const { net } = useNetwork();
  return { rails: net.rails, chainId: net.chain.id, net };
}

// ------------------------------------------------------------------ reads (current state, from the contract)

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

export type Exception = {
  vaultId: bigint;
  payee: Address;
  amount: bigint;
  memoHash: `0x${string}`;
  epoch: bigint;
  validUntil: bigint;
  status: number;
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

export type Charge = {
  billingId: bigint;
  amount: bigint;
  memoHash: `0x${string}`;
  settleAfter: bigint;
  periodIndex: bigint;
  status: number;
};

export const ExceptionStatus = ["None", "Pending", "Allowed", "Declined", "Used"] as const;
export const ChargeStatus = ["None", "Pending", "Awaiting parent", "Vetoed", "Settled", "Failed"] as const;

const counters = ["vaultCount", "exceptionCount", "billingCount", "chargeCount"] as const;

/** The four counters. Everything else is read by id (1..count), in one multicall per list. */
export function useCounts() {
  const { rails, chainId } = useRails();
  const q = useReadContracts({
    contracts: counters.map((functionName) => ({ address: rails, abi: pocketRailsAbi, functionName, chainId })),
    query: { enabled: Boolean(rails), refetchInterval: 4000 },
  });
  const n = (i: number) => (q.data?.[i]?.result as bigint | undefined) ?? 0n;
  return { vaults: n(0), exceptions: n(1), billings: n(2), charges: n(3), isLoading: q.isLoading, refetch: q.refetch };
}

const ids = (count: bigint, max = 200n) => {
  const from = count > max ? count - max + 1n : 1n;
  const out: bigint[] = [];
  for (let i = count; i >= from; i--) out.push(i);
  return out; // newest first
};

function useList<T>(functionName: "getVault" | "getException" | "getBilling" | "getCharge", count: bigint) {
  const { rails, chainId } = useRails();
  const list = ids(count);
  const q = useReadContracts({
    contracts: list.map((id) => ({ address: rails, abi: pocketRailsAbi, functionName, args: [id], chainId })),
    query: { enabled: Boolean(rails) && list.length > 0, refetchInterval: 4000 },
  });
  const items = list
    .map((id, i) => ({ id, data: q.data?.[i]?.result as T | undefined }))
    .filter((x): x is { id: bigint; data: T } => x.data !== undefined);
  return { items, isLoading: q.isLoading, refetch: q.refetch };
}

export function useAllVaults() {
  const c = useCounts();
  const l = useList<Vault>("getVault", c.vaults);
  return { ...l, refetch: () => (c.refetch(), l.refetch()) };
}

export function useAllExceptions() {
  const c = useCounts();
  return useList<Exception>("getException", c.exceptions);
}

export function useAllBillings() {
  const c = useCounts();
  return useList<Billing>("getBilling", c.billings);
}

export function useAllCharges() {
  const c = useCounts();
  return useList<Charge>("getCharge", c.charges);
}

export function useSpentThisWeek(vaultId?: bigint) {
  const { rails, chainId } = useRails();
  return useReadContract({
    address: rails,
    abi: pocketRailsAbi,
    functionName: "spentThisWeek",
    args: vaultId ? [vaultId] : undefined,
    chainId,
    query: { enabled: Boolean(rails && vaultId), refetchInterval: 4000 },
  });
}

// ------------------------------------------------------------------ history (from the server's event cache)

export interface HistoryEvent {
  eventName: string;
  args: Record<string, string | number | boolean>;
  blockNumber: string;
  txHash: Hash;
  logIndex: number;
}

export function useHistory(vaultId?: bigint) {
  const { rails, chainId } = useRails();
  return useQuery({
    queryKey: ["history", chainId, rails, vaultId?.toString()],
    enabled: Boolean(rails && vaultId),
    refetchInterval: 6000,
    queryFn: async () => {
      const res = await fetch(`/api/rails/events?chainId=${chainId}&vaultId=${vaultId}`);
      const body = (await res.json()) as { events?: HistoryEvent[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't load history.");
      return body.events ?? [];
    },
  });
}

/** Payee labels the parent gave, from PayeeChanged events (latest wins). */
export function payeeLabels(history: HistoryEvent[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of [...(history ?? [])].reverse()) {
    if (e.eventName === "PayeeChanged" && e.args.label) m.set(String(e.args.payee).toLowerCase(), String(e.args.label));
    if (e.eventName === "BillingGranted") {
      try {
        const t = JSON.parse(String(e.args.terms)) as { payTo?: string };
        if (t.payTo && e.args.label) m.set(t.payTo.toLowerCase(), String(e.args.label));
      } catch {
        /* terms not JSON: ignore */
      }
    }
  }
  return m;
}

// ------------------------------------------------------------------ writes (parent, school, guardian pay their own gas)

export type TxResult = { hash: Hash; outcome: Outcome };

/**
 * Simulate → send (legacy, as Aevum prefers) → wait → decode what happened.
 * Throws an Error with a plain-language message.
 */
export function useRailsWrite() {
  const config = useConfig();
  const { address } = useAccount();
  const { rails, chainId } = useRails();
  return useCallback(
    async (functionName: string, args: readonly unknown[], onSent?: (hash: Hash) => void): Promise<TxResult> => {
      if (!rails || !address) throw new Error("Connect your wallet first.");
      try {
        const { request } = await simulateContract(config, {
          account: address,
          address: rails,
          abi: pocketRailsAbi as Abi,
          functionName,
          args,
          chainId,
        } as never);
        const hash = await writeContract(config, { ...(request as object), type: "legacy" } as never);
        onSent?.(hash);
        const receipt = await waitForTransactionReceipt(config, { hash, chainId, timeout: 120_000 });
        return { hash, outcome: decodeOutcome(receipt, rails) };
      } catch (e) {
        throw new Error(explainRails(e));
      }
    },
    [config, address, rails, chainId],
  );
}

/** Note texts published to the app's notes service (school charges), by memo hash. */
export function useServerNotes(hashes: string[]) {
  const key = [...new Set(hashes.map((h) => h.toLowerCase()))].sort();
  const q = useQuery({
    queryKey: ["notes", key.join(",")],
    enabled: key.length > 0,
    staleTime: 10_000,
    queryFn: async () => {
      const res = await fetch(`/api/rails/notes?hashes=${key.join(",")}`);
      return ((await res.json()) as { notes?: Record<string, string> }).notes ?? {};
    },
  });
  return (hash: string): string | undefined => q.data?.[hash.toLowerCase()];
}
