/**
 * The Pocket Rails core flow, end to end, through the real HTTP relayer:
 *
 *   parent creates a vault and funds it → child pays the canteen (allowed) → child overspends (refused,
 *   recorded) → child asks for an exception → parent allows it once → child pays it → a reuse is refused →
 *   a tampered intent is rejected by the relayer → a replay is rejected → parent revokes → child is refused.
 *
 * The child only signs; the relayer pays gas. Every on-chain step prints its transaction hash (and an
 * explorer link on Aevum), so you can use this to create verifiable demo history.
 *
 *   pnpm example demo-flow
 *
 * Env (examples/.env): RPC_URL, RAILS_ADDRESS, PARENT_KEY (a TEST wallet holding a little tQDAY + 2 tUSD8),
 * APP_URL (where the web app runs; default http://localhost:3000).
 * Optional: CHILD_KEY (the child's TEST wallet; it needs no funds. Default: a fresh key each run) and
 * CANTEEN_ADDRESS (the approved payee; default: a fresh address).
 */
import {
  createWalletClient,
  http,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { erc20Abi, txUrl } from "@aevum-kit/aevum";
import {
  deadlineIn,
  exceptionRequestTypes,
  explainReason,
  memoHash,
  paymentTypes,
  pocketRailsAbi,
  pocketRailsDomain,
  randomNonce,
  Reason,
  toWire,
  type ExceptionRequest,
  type Payment,
} from "@pocket-rails/sdk";
import { connect, requiredAddress, requiredKey } from "./env";

const APP_URL = (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
const usd = (n: string) => parseUnits(n, 6);

const { client, chain, rpcUrl } = await connect();
const rails = requiredAddress("RAILS_ADDRESS");
const parent = privateKeyToAccount(requiredKey("PARENT_KEY"));
// The child never needs gas: it only signs.
const child = privateKeyToAccount(process.env.CHILD_KEY?.trim() ? requiredKey("CHILD_KEY") : generatePrivateKey());
const canteen = process.env.CANTEEN_ADDRESS?.trim() ? requiredAddress("CANTEEN_ADDRESS") : privateKeyToAccount(generatePrivateKey()).address;
const museum = privateKeyToAccount(generatePrivateKey()).address;
const parentWallet = createWalletClient({ account: parent, chain, transport: http(rpcUrl) });
const domain = pocketRailsDomain(chain.id, rails);
const onAevum = chain.id === 44005;
let failures = 0;

const link = (hash: Hash) => (onAevum ? txUrl(hash) : hash);
function check(ok: boolean, what: string) {
  console.log(`   ${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
}

/** Parent transactions: simulate, send (legacy, as Aevum prefers), wait for the receipt. */
async function parentTx(functionName: string, args: readonly unknown[]) {
  const { request, result } = await client.simulateContract({
    account: parent,
    address: rails,
    abi: pocketRailsAbi,
    functionName: functionName as never,
    args: args as never,
  });
  const hash = await parentWallet.writeContract({ ...(request as object), type: "legacy" } as never);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} failed: ${hash}`);
  console.log(`   parent → ${functionName}  ${link(hash)}`);
  return { result, receipt };
}

/** Child intents go through the relayer, then we poll for the confirmed outcome (no WebSocket on Aevum). */
async function relay(kind: "pay" | "requestException", intent: Payment | ExceptionRequest, signature: Hex) {
  const res = await fetch(`${APP_URL}/api/rails/relay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chainId: chain.id, kind, intent: toWire(intent), signature }),
  });
  const body = (await res.json()) as { hash?: Hash; error?: string };
  return { status: res.status, ...body };
}

async function confirmed(hash: Hash) {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${APP_URL}/api/rails/tx?hash=${hash}&chainId=${chain.id}`);
    const body = (await res.json()) as { state: string; outcome?: { kind: string; reason?: number; message: string } };
    if (body.state === "confirmed" && body.outcome) return body.outcome;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { kind: "unknown", message: "Not confirmed after 90 seconds." };
}

async function epoch(vaultId: bigint) {
  return (await client.readContract({ address: rails, abi: pocketRailsAbi, functionName: "getVault", args: [vaultId] })).childEpoch;
}

async function signPayment(vaultId: bigint, payee: Address, amount: bigint, memo: string, exceptionId = 0n): Promise<[Payment, Hex]> {
  const p: Payment = {
    vaultId,
    payee,
    amount,
    memoHash: memoHash(memo),
    exceptionId,
    nonce: randomNonce(),
    epoch: await epoch(vaultId),
    deadline: deadlineIn(300),
  };
  return [p, await child.signTypedData({ domain, types: paymentTypes, primaryType: "Payment", message: p })];
}

async function childPays(vaultId: bigint, payee: Address, amount: bigint, memo: string, exceptionId = 0n) {
  const [p, sig] = await signPayment(vaultId, payee, amount, memo, exceptionId);
  const r = await relay("pay", p, sig);
  if (!r.hash) throw new Error(`relayer refused to submit: ${r.error}`);
  const outcome = await confirmed(r.hash);
  console.log(`   child → pay ${Number(amount) / 1e6} tUSD8  ${link(r.hash)}  ⇒ ${outcome.kind}: ${outcome.message}`);
  return outcome;
}

// ---------------------------------------------------------------------------------------------

console.log(`Network: ${chain.name} (${chain.id})  PocketRails: ${rails}  relayer: ${APP_URL}`);
console.log(`Parent ${parent.address}  child ${child.address} (signs only, no gas)  canteen ${canteen}\n`);

const token = (await client.readContract({ address: rails, abi: pocketRailsAbi, functionName: "token" })) as Address;

console.log("1. Parent opens and funds a vault: canteen approved, 0.5 per payment, 2 a week, 30 days");
const { receipt: created } = await parentTx("createVault", [
  child.address,
  { perPaymentLimit: usd("0.5"), weeklyLimit: usd("2"), expiresAt: deadlineIn(30 * 24 * 3600) },
  [canteen],
  ["School canteen"],
]);
const vaultId = parseEventLogs({ abi: pocketRailsAbi, logs: created.logs, eventName: "VaultCreated" })[0]!.args.vaultId;
// Amounts are small so one Discord faucet claim (5 tUSD8) covers two runs. The flow spends 1.6 of 2.
const approveHash = await parentWallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [rails, usd("2")], type: "legacy" });
await client.waitForTransactionReceipt({ hash: approveHash });
await parentTx("deposit", [vaultId, usd("2")]);
console.log(`   vault #${vaultId}\n`);

console.log("2. Child pays the canteen 0.3 (inside the rules)");
const paid = await childPays(vaultId, canteen, usd("0.3"), "lunch");
check(paid.kind === "allow", "paid without asking the parent");

console.log("\n3. Child tries 0.8 at the canteen (over the per-payment limit)");
const over = await childPays(vaultId, canteen, usd("0.8"), "snacks");
check(over.kind === "refuse" && over.reason === Reason.OverPaymentLimit, "refused, recorded on-chain with a reason code");
console.log(`   next step shown to the child: "${explainReason(Reason.OverPaymentLimit).nextStep}"`);

console.log("\n4. Child asks for a one-time exception: 1.2 to the museum for a school trip");
const req: ExceptionRequest = {
  vaultId,
  payee: museum,
  amount: usd("1.2"),
  memoHash: memoHash("museum trip"),
  nonce: randomNonce(),
  epoch: await epoch(vaultId),
  deadline: deadlineIn(300),
};
const reqSig = await child.signTypedData({ domain, types: exceptionRequestTypes, primaryType: "ExceptionRequest", message: req });
const reqRes = await relay("requestException", req, reqSig);
if (!reqRes.hash) throw new Error(`relayer refused the request: ${reqRes.error}`);
const reqOutcome = await confirmed(reqRes.hash);
console.log(`   child → requestException  ${link(reqRes.hash)}  ⇒ ${reqOutcome.kind}: ${reqOutcome.message}`);
check(reqOutcome.kind === "pending", "request is pending");
const exceptionId = (await client.readContract({ address: rails, abi: pocketRailsAbi, functionName: "exceptionCount" })) as bigint;

console.log("\n5. Parent allows it once (valid 1 hour); standing rules don't change");
await parentTx("allowOnce", [exceptionId, deadlineIn(3600)]);

console.log("\n6. Child pays a different amount with the exception, then the exact one, then tries again");
const mismatch = await childPays(vaultId, museum, usd("1.3"), "museum trip", exceptionId);
check(mismatch.kind === "refuse" && mismatch.reason === Reason.ExceptionMismatch, "changed amount is refused");
const exact = await childPays(vaultId, museum, usd("1.2"), "museum trip", exceptionId);
check(exact.kind === "allow", "exact payment goes through");
const reuse = await childPays(vaultId, museum, usd("1.2"), "museum trip", exceptionId);
check(reuse.kind === "refuse" && reuse.reason === Reason.ExceptionNotApproved, "second use is refused");

console.log("\n7. A relayer (or attacker) changes a signed payment's payee");
const [tp, tsig] = await signPayment(vaultId, canteen, usd("0.1"), "lunch");
const tampered = await relay("pay", { ...tp, payee: museum }, tsig);
check(!tampered.hash && tampered.status === 400, `rejected before any gas is spent: "${tampered.error}"`);

console.log("\n8. The same signed payment is submitted twice");
const [rp, rsig] = await signPayment(vaultId, canteen, usd("0.1"), "bus");
const first = await relay("pay", rp, rsig);
if (first.hash) await confirmed(first.hash);
const again = await relay("pay", rp, rsig);
check(Boolean(first.hash) && !again.hash && again.status === 409, `replay rejected: "${again.error}"`);

console.log("\n9. Parent revokes access; the child tries to pay");
await parentTx("revokeChild", [vaultId]);
const revoked = await childPays(vaultId, canteen, usd("0.1"), "lunch");
check(revoked.kind === "refuse" && revoked.reason === Reason.AccessRevoked, "refused after revoke, recorded");

const v = await client.readContract({ address: rails, abi: pocketRailsAbi, functionName: "getVault", args: [vaultId] });
console.log(`\nVault #${vaultId}: balance ${Number(v.balance) / 1e6} tUSD8, rules version ${v.version}`);
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
