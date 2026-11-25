"use client";

import { useCallback } from "react";
import type { Address, Hash, Hex } from "viem";
import { useAccount, useConfig } from "wagmi";
import { signTypedData } from "wagmi/actions";
import {
  deadlineIn,
  exceptionRequestTypes,
  memoHash,
  paymentTypes,
  pocketRailsDomain,
  randomNonce,
  toWire,
  type ExceptionRequest,
  type Outcome,
  type Payment,
} from "@pocket-rails/sdk";
import { explainRails } from "@/lib/railsErrors";
import { useRails } from "@/lib/rails";

/**
 * The child's two actions. The child only signs (EIP-712, no gas); the relayer submits.
 * Progress is reported through `onStep` so the screen can show signing → unknown (submitted, not yet
 * confirmed) → done (confirmed outcome). Errors are thrown as plain sentences.
 */

const NOTES_KEY = "pocket-rails:notes";

/** Memos are stored on-chain as hashes. The text stays on this device so the child can see it later. */
export function rememberNote(text: string) {
  const t = text.trim();
  if (!t) return;
  try {
    const all = JSON.parse(localStorage.getItem(NOTES_KEY) ?? "{}") as Record<string, string>;
    all[memoHash(t)] = t;
    localStorage.setItem(NOTES_KEY, JSON.stringify(all));
  } catch {
    /* storage blocked: the note just won't be shown later */
  }
}

export function noteFor(hash: string): string | undefined {
  if (/^0x0+$/.test(hash)) return "";
  try {
    return (JSON.parse(localStorage.getItem(NOTES_KEY) ?? "{}") as Record<string, string>)[hash];
  } catch {
    return undefined;
  }
}

export type Step = { state: "signing"; text: string } | { state: "unknown"; text: string; hash?: Hash };

async function waitForOutcome(chainId: number, hash: Hash): Promise<Outcome> {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`/api/rails/tx?hash=${hash}&chainId=${chainId}`);
      const body = (await res.json()) as { state: string; outcome?: Outcome & { blockNumber: string } };
      if (body.state === "confirmed" && body.outcome) return { ...body.outcome, blockNumber: BigInt(body.outcome.blockNumber) };
    } catch {
      /* network blip: keep polling */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Still not confirmed after 2 minutes. It may confirm later: check your activity before trying again.");
}

async function relay(chainId: number, kind: "pay" | "requestException", intent: Payment | ExceptionRequest, signature: Hex): Promise<Hash> {
  let res: Response;
  try {
    res = await fetch("/api/rails/relay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chainId, kind, intent: toWire(intent), signature }),
    });
  } catch {
    throw new Error("Couldn't reach the app's server. Nothing was sent. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as { hash?: Hash; error?: string };
  if (!res.ok || !body.hash) throw new Error(body.error ?? "The relayer couldn't send this. Nothing was sent.");
  return body.hash;
}

export function useChildActions() {
  const config = useConfig();
  const { address, chainId: walletChain } = useAccount();
  const { rails, chainId } = useRails();

  const ready = () => {
    if (!rails || !address) throw new Error("Connect your wallet first.");
    if (walletChain !== chainId) throw new Error("Your wallet is on another network. Use the Switch network button at the top.");
    return rails;
  };

  const pay = useCallback(
    async (
      p: { vaultId: bigint; epoch: bigint; payee: Address; amount: bigint; note: string; exceptionId?: bigint },
      onStep: (s: Step) => void,
    ): Promise<Outcome> => {
      const railsAddr = ready();
      const intent: Payment = {
        vaultId: p.vaultId,
        payee: p.payee,
        amount: p.amount,
        memoHash: memoHash(p.note),
        exceptionId: p.exceptionId ?? 0n,
        nonce: randomNonce(),
        epoch: p.epoch,
        deadline: deadlineIn(600),
      };
      onStep({ state: "signing", text: "Sign the payment in your wallet (no gas)…" });
      let signature: Hex;
      try {
        signature = await signTypedData(config, {
          domain: pocketRailsDomain(chainId, railsAddr),
          types: paymentTypes,
          primaryType: "Payment",
          message: intent,
        });
      } catch (e) {
        throw new Error(explainRails(e));
      }
      rememberNote(p.note);
      onStep({ state: "unknown", text: "Sending…" });
      const hash = await relay(chainId, "pay", intent, signature);
      onStep({ state: "unknown", text: "Waiting for Aevum to confirm…", hash });
      return waitForOutcome(chainId, hash);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, address, walletChain, rails, chainId],
  );

  const requestException = useCallback(
    async (p: { vaultId: bigint; epoch: bigint; payee: Address; amount: bigint; note: string }, onStep: (s: Step) => void): Promise<Outcome> => {
      const railsAddr = ready();
      const intent: ExceptionRequest = {
        vaultId: p.vaultId,
        payee: p.payee,
        amount: p.amount,
        memoHash: memoHash(p.note),
        nonce: randomNonce(),
        epoch: p.epoch,
        deadline: deadlineIn(600),
      };
      onStep({ state: "signing", text: "Sign the request in your wallet (no gas)…" });
      let signature: Hex;
      try {
        signature = await signTypedData(config, {
          domain: pocketRailsDomain(chainId, railsAddr),
          types: exceptionRequestTypes,
          primaryType: "ExceptionRequest",
          message: intent,
        });
      } catch (e) {
        throw new Error(explainRails(e));
      }
      rememberNote(p.note);
      onStep({ state: "unknown", text: "Sending your request…" });
      const hash = await relay(chainId, "requestException", intent, signature);
      onStep({ state: "unknown", text: "Waiting for Aevum to confirm…", hash });
      return waitForOutcome(chainId, hash);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, address, walletChain, rails, chainId],
  );

  return { pay, requestException };
}
