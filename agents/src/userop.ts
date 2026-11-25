import { encodeFunctionData, encodePacked, parseAbi, zeroHash, type Address, type Hash, type Hex } from "viem";
import {
  entryPoint07Abi,
  entryPoint07Address,
  formatUserOperationRequest,
  getUserOperationHash,
  type UserOperation,
} from "viem/account-abstraction";
import { decodeOutcome, pocketRailsAbi, type Outcome } from "@pocket-rails/sdk";
import type { Conn } from "./lib";

/**
 * The guardian as a Kernel v3.1 smart account (ERC-4337 v0.7). Its session key is only allowed, by
 * contracts/src/VetoOnlySessionValidator.sol, to make the account call PocketRails `vetoCharge`, with no value,
 * until the session expires. Operations go through an ERC-4337 bundler (QDay runs one at bundler.qday.info).
 */

const kernelAbi = parseAbi(["function execute(bytes32 mode, bytes executionCalldata) payable"]);

/** Nonce key that selects the veto-only validator: mode 0x00 | type 0x01 (validator) | validator | key 0. */
export function vetoOnlyNonceKey(validator: Address): bigint {
  return (1n << 176n) | (BigInt(validator) << 16n);
}

/** Kernel `execute` in single-call default mode: target (20 bytes) | value (32 bytes) | call data. */
export function kernelExecute(target: Address, value: bigint, data: Hex): Hex {
  return encodeFunctionData({
    abi: kernelAbi,
    functionName: "execute",
    args: [zeroHash, encodePacked(["address", "uint256", "bytes"], [target, value, data])],
  });
}

async function bundlerRpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string; data?: unknown } };
  if (body.error) throw new Error(`bundler ${method}: ${body.error.message}`);
  return body.result as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A placeholder signature with a valid shape, for gas estimation only. */
const DUMMY_SIG: Hex = `0x${"ff".repeat(32)}${"7f".repeat(32)}1b`;

export interface VetoResult {
  userOpHash: Hash;
  txHash: Hash;
  outcome: Outcome;
}

/** Sends a `vetoCharge` from the guardian's smart account through the bundler and waits for it. */
export async function vetoViaSmartAccount(
  c: Conn,
  opts: { account: Address; validator: Address; bundlerUrl: string; chargeId: bigint; reason: string },
): Promise<VetoResult> {
  const nonce = await c.client.readContract({
    address: entryPoint07Address,
    abi: entryPoint07Abi,
    functionName: "getNonce",
    args: [opts.account, vetoOnlyNonceKey(opts.validator)],
  });
  const callData = kernelExecute(
    c.rails,
    0n,
    encodeFunctionData({ abi: pocketRailsAbi, functionName: "vetoCharge", args: [opts.chargeId, opts.reason] }),
  );

  // Fees: the bundler's minimum priority fee plus 10%; Aevum's base fee is tiny.
  const minPriority = BigInt(await bundlerRpc<string>(opts.bundlerUrl, "rundler_maxPriorityFeePerGas", []));
  const maxPriorityFeePerGas = (minPriority * 11n) / 10n;
  const baseFee = (await c.client.getBlock()).baseFeePerGas ?? 0n;
  const maxFeePerGas = maxPriorityFeePerGas + baseFee * 2n + 1n;

  const op: UserOperation<"0.7"> = {
    sender: opts.account,
    nonce,
    callData,
    callGasLimit: 0n,
    verificationGasLimit: 0n,
    preVerificationGas: 0n,
    maxFeePerGas,
    maxPriorityFeePerGas,
    signature: DUMMY_SIG,
  };

  // Gas: ask the bundler; if it can't estimate with a placeholder signature, use measured limits with headroom
  // (the fork test uses ~430k gas in total for this operation).
  try {
    const est = await bundlerRpc<{ preVerificationGas: Hex; verificationGasLimit: Hex; callGasLimit: Hex }>(
      opts.bundlerUrl,
      "eth_estimateUserOperationGas",
      [formatUserOperationRequest(op), entryPoint07Address],
    );
    op.preVerificationGas = (BigInt(est.preVerificationGas) * 12n) / 10n;
    op.verificationGasLimit = (BigInt(est.verificationGasLimit) * 13n) / 10n;
    op.callGasLimit = (BigInt(est.callGasLimit) * 13n) / 10n;
  } catch {
    op.preVerificationGas = 120_000n;
    op.verificationGasLimit = 300_000n;
    op.callGasLimit = 250_000n;
  }

  const hash = getUserOperationHash({
    chainId: c.chain.id,
    entryPointAddress: entryPoint07Address,
    entryPointVersion: "0.7",
    userOperation: op,
  });
  op.signature = await c.account.sign({ hash }); // the session key signs the raw user-operation hash

  const userOpHash = await bundlerRpc<Hash>(opts.bundlerUrl, "eth_sendUserOperation", [formatUserOperationRequest(op), entryPoint07Address]);

  // Aevum has no WebSocket RPC: poll the bundler for the receipt.
  for (let i = 0; i < 60; i++) {
    const r = await bundlerRpc<{ success: boolean; receipt: { transactionHash: Hash } } | null>(
      opts.bundlerUrl,
      "eth_getUserOperationReceipt",
      [userOpHash],
    ).catch(() => null);
    if (r) {
      const receipt = await c.client.getTransactionReceipt({ hash: r.receipt.transactionHash });
      const outcome = decodeOutcome(receipt, c.rails);
      if (!r.success) throw new Error(`user operation ${userOpHash} was included but its call failed (tx ${r.receipt.transactionHash})`);
      return { userOpHash, txHash: r.receipt.transactionHash, outcome };
    }
    await sleep(2000);
  }
  throw new Error(`user operation ${userOpHash} not included after 2 minutes`);
}
