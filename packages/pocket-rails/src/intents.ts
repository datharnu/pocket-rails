import { keccak256, toHex, zeroHash, type Address, type Hex } from "viem";

/**
 * EIP-712 intents a child signs. The contract recomputes the same digest, so any change to a field
 * (payee, amount, memo…) makes the signature invalid. The domain binds it to one chain and one contract.
 */

export function pocketRailsDomain(chainId: number, verifyingContract: Address) {
  return { name: "PocketRails", version: "1", chainId, verifyingContract } as const;
}

export const paymentTypes = {
  Payment: [
    { name: "vaultId", type: "uint256" },
    { name: "payee", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "memoHash", type: "bytes32" },
    { name: "exceptionId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "epoch", type: "uint64" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const exceptionRequestTypes = {
  ExceptionRequest: [
    { name: "vaultId", type: "uint256" },
    { name: "payee", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "memoHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "epoch", type: "uint64" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export interface Payment {
  vaultId: bigint;
  payee: Address;
  amount: bigint;
  memoHash: Hex;
  exceptionId: bigint;
  nonce: bigint;
  epoch: bigint;
  deadline: bigint;
}

export interface ExceptionRequest {
  vaultId: bigint;
  payee: Address;
  amount: bigint;
  memoHash: Hex;
  nonce: bigint;
  epoch: bigint;
  deadline: bigint;
}

/**
 * Memos are stored on-chain as a hash only. Keep the text in your app (or nowhere).
 * An empty memo hashes to zero, so "no memo" is easy to recognise.
 */
export function memoHash(memo: string | undefined): Hex {
  const text = memo?.trim() ?? "";
  return text ? keccak256(toHex(text)) : zeroHash;
}

/**
 * A random 256-bit nonce. The contract uses unordered nonces (any unused number works), so a child
 * can sign several payments offline without coordinating a counter.
 */
export function randomNonce(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return BigInt(toHex(bytes));
}

/** Deadline `seconds` from now, in unix seconds. Keep it short: a few minutes is plenty. */
export function deadlineIn(seconds: number, now = Date.now()): bigint {
  return BigInt(Math.floor(now / 1000) + seconds);
}

/** JSON can't carry bigint. These turn intents into strings for an HTTP body and back. */
export type Wire<T> = { [K in keyof T]: T[K] extends bigint ? string : T[K] };

export function toWire<T extends object>(intent: T): Wire<T> {
  return Object.fromEntries(
    Object.entries(intent).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
  ) as Wire<T>;
}
