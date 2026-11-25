"use client";

import { erc20Abi } from "@aevum-kit/aevum";
import { pocketRailsAbi } from "@pocket-rails/sdk";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { useRails } from "@/lib/rails";

/** The vault token (tUSD8 on Aevum, MockUSD8 locally), read from PocketRails.token(). */
export function useToken() {
  const { rails, chainId } = useRails();
  const q = useReadContract({ address: rails, abi: pocketRailsAbi, functionName: "token", chainId, query: { enabled: Boolean(rails) } });
  return { address: q.data as Address | undefined, symbol: "tUSD8", decimals: 6 };
}

/** A wallet's token balance. */
export function useTokenBalance(owner?: Address) {
  const { chainId } = useRails();
  const token = useToken();
  return useReadContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: owner ? [owner] : undefined,
    chainId,
    query: { enabled: Boolean(token.address && owner), refetchInterval: 5000 },
  });
}
