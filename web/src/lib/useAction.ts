"use client";

import { useCallback, useState } from "react";
import type { Hash } from "viem";
import type { Status } from "@/components/ui";
import type { TxResult } from "@/lib/rails";

/**
 * One button's lifecycle: wallet prompt → submitted (unknown until confirmed) → confirmed outcome, or a
 * plain-language error. `run` returns true when the transaction confirmed successfully.
 */
export function useAction() {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const run = useCallback(async (fn: (onSent: (hash: Hash) => void) => Promise<TxResult>): Promise<boolean> => {
    setStatus({ state: "signing", text: "Confirm in your wallet…" });
    try {
      const { outcome } = await fn((hash) => setStatus({ state: "unknown", text: "Waiting for Aevum to confirm…", hash }));
      setStatus({ state: "done", outcome });
      return outcome.kind !== "failed";
    } catch (e) {
      setStatus({ state: "error", text: e instanceof Error ? e.message : "Something went wrong." });
      return false;
    }
  }, []);
  const busy = status.state === "signing" || status.state === "unknown";
  return { status, run, busy, reset: () => setStatus({ state: "idle" }) };
}
