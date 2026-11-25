import { NextResponse } from "next/server";
import {
  BaseError,
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  isHex,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import {
  exceptionRequestTypes,
  explainReason,
  paymentTypes,
  pocketRailsAbi,
  pocketRailsDomain,
  Reason,
  type ExceptionRequest,
  type Payment,
} from "@pocket-rails/sdk";
import { defaultNetwork, networkByChainId, type Network } from "@/lib/env";
import { explainRails } from "@/lib/railsErrors";
import {
  claimInFlight,
  clientIp,
  count,
  countSent,
  limited,
  overDailyLimit,
  record,
  releaseInFlight,
  usableOn,
} from "@/lib/relayer";

/**
 * Relayer for children's signed intents. The child only signs (EIP-712); this route submits
 * PocketRails.pay or PocketRails.requestException and pays the gas from RELAYER_PRIVATE_KEY.
 *
 * The contract is the guard: this route can't make a payment the rules don't allow, and it can't change
 * an intent without breaking the signature. Its own checks only protect the relayer's gas:
 *  1. Only YOUR PocketRails, only `pay` and `requestException`. Never arbitrary calls.
 *  2. Well-formed intents with a short deadline (max 15 minutes ahead).
 *  3. The signature is checked off-chain against the vault's child key before any gas is spent.
 *  4. Not already used on-chain, and not already being submitted.
 *  5. Simulated first: reverts cost nothing, and the expected outcome (paid / refused + reason) is known.
 *  6. Refusals are recorded on purpose, but each vault gets a small refusal budget per hour so nobody can
 *     drain the relayer by submitting payments they know will be refused.
 *  7. Rate limits per IP and per vault (the vault limit only counts correctly signed requests, so a
 *     stranger can't lock a child out), and a daily transaction cap.
 *  8. One safe retry when the relayer's own nonce is out of sync.
 */
export const runtime = "nodejs";

const MAX_DEADLINE_AHEAD = 15n * 60n;
const PER_IP_PER_MINUTE = 20;
const PER_VAULT_PER_MINUTE = 12;
// Recorded refusals per vault per hour. 0 turns the limit off (e.g. for demo rehearsals on one vault).
const REFUSALS_PER_VAULT_PER_HOUR = Number(process.env.RELAYER_REFUSALS_PER_VAULT_PER_HOUR ?? 10);
const isDev = process.env.NODE_ENV !== "production";

const isUint = (v: unknown): v is string => typeof v === "string" && /^\d{1,78}$/.test(v);
const isBytes32 = (v: unknown): v is Hex => typeof v === "string" && isHex(v) && v.length === 66;
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

function networkFor(chainId: unknown): Network | undefined {
  if (chainId === undefined || chainId === null || chainId === "") return defaultNetwork;
  return networkByChainId(Number(chainId));
}

type Kind = "pay" | "requestException";

/** Parses a JSON intent (numbers as decimal strings). Returns undefined if anything is off. */
function parseIntent(kind: Kind, raw: unknown): Payment | ExceptionRequest | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const i = raw as Record<string, unknown>;
  const common =
    isUint(i.vaultId) &&
    typeof i.payee === "string" &&
    isAddress(i.payee) &&
    isUint(i.amount) &&
    isBytes32(i.memoHash) &&
    isUint(i.nonce) &&
    isUint(i.epoch) &&
    isUint(i.deadline);
  if (!common) return undefined;
  const base = {
    vaultId: BigInt(i.vaultId as string),
    payee: i.payee as Address,
    amount: BigInt(i.amount as string),
    memoHash: i.memoHash as Hex,
    nonce: BigInt(i.nonce as string),
    epoch: BigInt(i.epoch as string),
    deadline: BigInt(i.deadline as string),
  };
  if (base.amount === 0n) return undefined;
  if (kind === "requestException") return base;
  if (!isUint(i.exceptionId)) return undefined;
  return { ...base, exceptionId: BigInt(i.exceptionId) };
}

/** GET /api/rails/relay?chainId=… tells the app whether gasless mode is available. */
export async function GET(req: Request) {
  const net = networkFor(new URL(req.url).searchParams.get("chainId"));
  const account = net ? usableOn(net) : undefined;
  return NextResponse.json({ enabled: Boolean(account && net?.rails), relayer: account?.address ?? null });
}

export async function POST(req: Request) {
  if (limited(`ip:${clientIp(req)}`, PER_IP_PER_MINUTE)) return fail("Too many requests. Wait a minute.", 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON.");
  }

  const net = networkFor(body.chainId);
  if (!net) return fail("This network isn't enabled in the app.");
  const account = usableOn(net);
  const rails = net.rails;
  if (!account || !rails) {
    return fail(
      isDev
        ? `The relayer is off on ${net.label}. Set RELAYER_PRIVATE_KEY (not an anvil key, except on local chains) and NEXT_PUBLIC_RAILS_${net.key.toUpperCase()} in web/.env.local.`
        : "Sending without gas isn't available right now. Try again later.",
      503,
    );
  }

  const kind = body.kind;
  if (kind !== "pay" && kind !== "requestException") return fail("Unknown request type.");
  const intent = parseIntent(kind, body.intent);
  const signature = body.signature;
  if (!intent || !(typeof signature === "string" && isHex(signature))) return fail("Malformed request.");

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (intent.deadline < now) return fail("This request expired before it reached us. Nothing was sent. Try again.");
  if (intent.deadline > now + MAX_DEADLINE_AHEAD) return fail("The request's deadline is too far ahead (max 15 minutes).");

  const vaultKey = `${net.chain.id}:${intent.vaultId}`;

  const transport = http();
  const client = createPublicClient({ chain: net.chain, transport });
  const wallet = createWalletClient({ account, chain: net.chain, transport });

  // 3. Signature check off-chain, against the vault's current child key.
  let vault;
  try {
    vault = await client.readContract({ address: rails, abi: pocketRailsAbi, functionName: "getVault", args: [intent.vaultId] });
  } catch (e) {
    return fail(explainRails(e));
  }
  const domain = pocketRailsDomain(net.chain.id, rails);
  let signer: Address;
  try {
    signer =
      kind === "pay"
        ? await recoverTypedDataAddress({ domain, types: paymentTypes, primaryType: "Payment", message: intent as Payment, signature })
        : await recoverTypedDataAddress({
            domain,
            types: exceptionRequestTypes,
            primaryType: "ExceptionRequest",
            message: intent as ExceptionRequest,
            signature,
          });
  } catch {
    return fail("Invalid signature.");
  }
  const childIsContract = ((await client.getCode({ address: vault.child }).catch(() => undefined)) ?? "0x") !== "0x";
  if (!childIsContract && signer.toLowerCase() !== vault.child.toLowerCase()) {
    return fail("This wasn't signed by the child's key for this allowance. Nothing was sent.");
  }
  // Counted only for correctly signed requests, so strangers can't use up a family's limit.
  if (limited(`vault:${vaultKey}`, PER_VAULT_PER_MINUTE)) return fail("Too many requests for this allowance. Wait a minute.", 429);

  // 4. Already used, or already in flight.
  if (await client.readContract({ address: rails, abi: pocketRailsAbi, functionName: "nonceUsed", args: [intent.vaultId, intent.nonce] })) {
    return fail("This exact request was already submitted.", 409);
  }
  const flightKey = `${vaultKey}:${intent.nonce}`;
  if (!claimInFlight(flightKey)) return fail("This request is already being submitted.", 409);

  try {
    // 5. Simulate: reverts cost nothing, and we learn the expected outcome.
    const sim =
      kind === "pay"
        ? await client.simulateContract({ account, address: rails, abi: pocketRailsAbi, functionName: "pay", args: [intent as Payment, signature] })
        : await client.simulateContract({
            account,
            address: rails,
            abi: pocketRailsAbi,
            functionName: "requestException",
            args: [intent as ExceptionRequest, signature],
          });

    const expectedReason = kind === "pay" ? (Number(sim.result) as Reason) : Reason.None;

    // 6. Refusal budget.
    const refusalBucket = `refusals:${vaultKey}`;
    if (expectedReason !== Reason.None && REFUSALS_PER_VAULT_PER_HOUR > 0 && count(refusalBucket, 3_600_000) >= REFUSALS_PER_VAULT_PER_HOUR) {
      releaseInFlight(flightKey);
      const text = explainReason(expectedReason);
      return fail(`${text.message} ${text.nextStep} (Too many refused attempts this hour, so this one wasn't recorded on-chain.)`, 429);
    }

    if (overDailyLimit()) {
      releaseInFlight(flightKey);
      return fail("The relayer reached its daily limit. Try again tomorrow.", 503);
    }

    // 8. Submit, with one retry if our own nonce is stale.
    const submit = (): Promise<Hex> =>
      kind === "pay"
        ? wallet.writeContract({ address: rails, abi: pocketRailsAbi, functionName: "pay", args: [intent as Payment, signature], type: "legacy" })
        : wallet.writeContract({
            address: rails,
            abi: pocketRailsAbi,
            functionName: "requestException",
            args: [intent as ExceptionRequest, signature],
            type: "legacy",
          });
    const hash = await sendWithRetry(submit, account.address, net.chain.id);
    countSent();
    if (expectedReason !== Reason.None) record(refusalBucket);

    const text = explainReason(expectedReason);
    return NextResponse.json({
      hash,
      // What the simulation predicts. The confirmed receipt is the truth: until then, the UI shows "unknown".
      expected: kind === "pay" ? { reason: expectedReason, name: text.name, message: text.message, nextStep: text.nextStep } : { reason: 0, name: "Requested", message: "Request sent.", nextStep: "" },
    });
  } catch (e) {
    releaseInFlight(flightKey);
    if (e instanceof BaseError && /insufficient funds/i.test(e.message)) {
      console.error("[rails relay] relayer is out of gas", account.address);
      return fail("The relayer is out of gas. Try again later.", 503);
    }
    return fail(explainRails(e));
  }
}

const NONCE_ERROR = /nonce too low|nonce has already been used|replacement transaction underpriced|already known/i;

async function sendWithRetry(send: () => Promise<Hex>, address: Address, chainId: number): Promise<Hex> {
  try {
    return await send();
  } catch (e) {
    if (e instanceof BaseError && NONCE_ERROR.test(e.message)) {
      const { nonceManager } = await import("viem/accounts");
      nonceManager.reset({ address, chainId });
      return await send();
    }
    throw e;
  }
}
