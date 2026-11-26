/**
 * Evidence run for PocketRails v3: every feature, live on Aevum, through the HOSTED system.
 *
 *   - the child's payments go through the hosted relayer (APP_URL), the child never pays gas;
 *   - school charges are reviewed by the hosted guardian agent (the veto-only smart account, GUARDIAN_ACCOUNT),
 *     which vetoes on its own; this script only waits and reads the result.
 *
 * It opens a fresh evidence allowance (so the showcase allowance is untouched), runs the scenarios, then the
 * parent withdraws what's left. Every step is checked against the chain and written to docs/evidence/v3-run.json.
 *
 *   pnpm --filter examples evidence
 *
 * Env (examples/.env): RPC_URL, RAILS_ADDRESS, PARENT_KEY (TEST wallet: ~1.2 tUSD8 + a little tQDAY),
 * RELAYER_KEY (submits the gas-free deposit; any funded TEST key), APP_URL (the hosted app), CANTEEN_ADDRESS,
 * GUARDIAN_ACCOUNT (the hosted guardian smart account).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BaseError, ContractFunctionRevertedError, createWalletClient, http, parseEventLogs, parseUnits, type Address, type Hash, type Hex, type Account } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { txUrl } from "@aevum-kit/aevum";
import {
  decodeOutcome,
  deadlineIn,
  exceptionRequestTypes,
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
const money = (v: bigint) => `${Number(v) / 1e6} tUSD8`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const { client, chain, rpcUrl } = await connect();
const rails = requiredAddress("RAILS_ADDRESS");
const canteen = requiredAddress("CANTEEN_ADDRESS");
const guardianAccount = requiredAddress("GUARDIAN_ACCOUNT");
const parent = privateKeyToAccount(requiredKey("PARENT_KEY"));
const submitter = privateKeyToAccount(requiredKey("RELAYER_KEY"));
const child = privateKeyToAccount(generatePrivateKey()); // fresh: it never holds any gas
const biller = privateKeyToAccount(generatePrivateKey()); // this run's own school billing key
const museum = privateKeyToAccount(generatePrivateKey()).address; // a place that is NOT approved
const domain = pocketRailsDomain(chain.id, rails);
const wallet = (a: Account) => createWalletClient({ account: a, chain, transport: http(rpcUrl) });

type Step = {
  feature: string;
  step: string;
  actor: string;
  expected: string;
  ok: boolean;
  outcome?: string;
  reason?: number;
  tx?: Hash;
  note?: string;
};
const steps: Step[] = [];
function record(s: Step) {
  steps.push(s);
  console.log(`${s.ok ? "✓" : "✗"} [${s.feature}] ${s.step}  ${s.tx ? txUrl(s.tx) : ""}${s.outcome ? `  ⇒ ${s.outcome}` : ""}${s.note ? `  (${s.note})` : ""}`);
}

/** A contract call from one of our test keys: simulate, send (legacy), wait, decode what happened. */
async function call(from: Account, functionName: string, args: readonly unknown[]) {
  const { request, result } = await client.simulateContract({ account: from, address: rails, abi: pocketRailsAbi, functionName: functionName as never, args: args as never });
  const hash = await wallet(from).writeContract({ ...(request as object), type: "legacy" } as never);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  return { hash, receipt, result, outcome: decodeOutcome(receipt, rails) };
}

async function relay(kind: "pay" | "requestException", intent: Payment | ExceptionRequest, signature: Hex) {
  const res = await fetch(`${APP_URL}/api/rails/relay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chainId: chain.id, kind, intent: toWire(intent), signature }),
  });
  return { status: res.status, ...((await res.json()) as { hash?: Hash; error?: string }) };
}

async function confirmed(hash: Hash) {
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  return decodeOutcome(receipt, rails);
}

const vaultOf = (id: bigint) => client.readContract({ address: rails, abi: pocketRailsAbi, functionName: "getVault", args: [id] });
const chargeOf = (id: bigint) => client.readContract({ address: rails, abi: pocketRailsAbi, functionName: "getCharge", args: [id] });

async function signPayment(vaultId: bigint, payee: Address, amount: bigint, memo: string, exceptionId = 0n): Promise<[Payment, Hex]> {
  const p: Payment = { vaultId, payee, amount, memoHash: memoHash(memo), exceptionId, nonce: randomNonce(), epoch: (await vaultOf(vaultId)).childEpoch, deadline: deadlineIn(300) };
  return [p, await child.signTypedData({ domain, types: paymentTypes, primaryType: "Payment", message: p })];
}

async function childPays(feature: string, step: string, expected: string, want: (o: { kind: string; reason?: number }) => boolean, vaultId: bigint, payee: Address, amount: bigint, memo: string, exceptionId = 0n) {
  const [p, sig] = await signPayment(vaultId, payee, amount, memo, exceptionId);
  const r = await relay("pay", p, sig);
  if (!r.hash) throw new Error(`relayer refused to submit: ${r.error}`);
  const o = await confirmed(r.hash);
  record({ feature, step, actor: "child (via hosted relayer)", expected, ok: want(o), outcome: `${o.kind}: ${o.message}`, reason: o.reason, tx: r.hash });
  return o;
}

async function publishNote(text: string) {
  await fetch(`${APP_URL}/api/rails/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }).catch(() => undefined);
  return memoHash(text);
}

async function charge(billingId: bigint, amount: bigint, note: string) {
  const r = await call(biller, "requestCharge", [billingId, amount, await publishNote(note)]);
  const chargeId = (r.result as readonly [bigint, number])[0];
  return { ...r, chargeId };
}

// ------------------------------------------------------------------------------------------------ run

const startedAt = new Date().toISOString();
const startBlock = await client.getBlockNumber();
console.log(`PocketRails ${rails} on ${chain.name}; relayer and guardian: ${APP_URL}; guardian account ${guardianAccount}`);
console.log(`parent ${parent.address}  child ${child.address} (fresh, no gas)  biller ${biller.address}\n`);

// Setup: the evidence allowance. Approved: canteen. 0.5 per payment, 2 a week, 30 days.
const created = await call(parent, "createVault", [child.address, { perPaymentLimit: usd("0.5"), weeklyLimit: usd("2"), expiresAt: deadlineIn(30 * 86400) }, [canteen], ["School canteen"]]);
const vaultId = parseEventLogs({ abi: pocketRailsAbi, logs: created.receipt.logs, eventName: "VaultCreated" })[0]!.args.vaultId;
record({ feature: "Setup", step: `Parent opens allowance #${vaultId} (canteen approved, 0.5 per payment, 2 a week)`, actor: "parent", expected: "created", ok: true, tx: created.hash });

// 1. Gas-free top-up (EIP-3009): the parent only signs; another account submits and pays the gas.
{
  const token = (await client.readContract({ address: rails, abi: pocketRailsAbi, functionName: "token" })) as Address;
  const amount = usd("1.2");
  const salt = generatePrivateKey();
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonce = await client.readContract({ address: rails, abi: pocketRailsAbi, functionName: "depositNonce", args: [vaultId, salt] });
  const sig = await parent.signTypedData({
    domain: { name: "tUSD8", version: "2", chainId: chain.id, verifyingContract: token },
    types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "ReceiveWithAuthorization",
    message: { from: parent.address, to: rails, value: amount, validAfter: 0n, validBefore, nonce },
  });
  const r = BigInt(`0x${sig.slice(2, 66)}`), s = BigInt(`0x${sig.slice(66, 130)}`), v = parseInt(sig.slice(130, 132), 16);
  const before = await client.getBalance({ address: parent.address });
  const d = await call(submitter, "depositWithAuthorization", [vaultId, parent.address, amount, 0n, validBefore, salt, { v, r: `0x${r.toString(16).padStart(64, "0")}`, s: `0x${s.toString(16).padStart(64, "0")}` }]);
  const after = await client.getBalance({ address: parent.address });
  const bal = (await vaultOf(vaultId)).balance;
  record({ feature: "Gas-free top-up (EIP-3009)", step: `Parent signs a ${money(amount)} top-up; the relayer account submits it`, actor: "relayer account", expected: "allowance funded, parent pays no gas", ok: bal === amount && before === after, tx: d.hash, note: `allowance ${money(bal)}, parent's gas balance unchanged` });
}

// 2. The child pays inside the rules, gas-free.
await childPays("Child pays on their own", "Child pays the canteen 0.2", "paid, no parent needed", (o) => o.kind === "allow", vaultId, canteen, usd("0.2"), "lunch");
await childPays("Refusals are recorded", "Child tries 0.8 (over the 0.5 per-payment limit)", "refused with a reason, no money moves", (o) => o.kind === "refuse" && o.reason === Reason.OverPaymentLimit, vaultId, canteen, usd("0.8"), "snacks");
await childPays("Refusals are recorded", "Child tries to pay a place that isn't approved", "refused with a reason", (o) => o.kind === "refuse" && o.reason === Reason.PayeeNotApproved, vaultId, museum, usd("0.1"), "toy shop");

// 3. A one-time exception.
{
  const req: ExceptionRequest = { vaultId, payee: museum, amount: usd("0.3"), memoHash: memoHash("museum trip"), nonce: randomNonce(), epoch: (await vaultOf(vaultId)).childEpoch, deadline: deadlineIn(300) };
  const sig = await child.signTypedData({ domain, types: exceptionRequestTypes, primaryType: "ExceptionRequest", message: req });
  const rr = await relay("requestException", req, sig);
  if (!rr.hash) throw new Error(`relayer refused the request: ${rr.error}`);
  const o = await confirmed(rr.hash);
  record({ feature: "One-time exception", step: "Child asks: 0.3 to the museum, “museum trip”", actor: "child (via hosted relayer)", expected: "pending", ok: o.kind === "pending", outcome: `${o.kind}: ${o.message}`, tx: rr.hash });
  const exceptionId = (await client.readContract({ address: rails, abi: pocketRailsAbi, functionName: "exceptionCount" })) as bigint;
  const a = await call(parent, "allowOnce", [exceptionId, deadlineIn(3600)]);
  record({ feature: "One-time exception", step: `Parent allows exception #${exceptionId} once`, actor: "parent", expected: "allowed, rules unchanged", ok: true, tx: a.hash });
  await childPays("One-time exception", "Child pays 0.4 with it (amount changed)", "refused: must match exactly", (x) => x.kind === "refuse" && x.reason === Reason.ExceptionMismatch, vaultId, museum, usd("0.4"), "museum trip", exceptionId);
  await childPays("One-time exception", "Child pays exactly 0.3 with it", "paid", (x) => x.kind === "allow", vaultId, museum, usd("0.3"), "museum trip", exceptionId);
  await childPays("One-time exception", "Child tries to use it again", "refused: used up", (x) => x.kind === "refuse" && x.reason === Reason.ExceptionNotApproved, vaultId, museum, usd("0.3"), "museum trip", exceptionId);
}

// 4. The relayer can't change or replay a signed payment.
{
  const [tp, tsig] = await signPayment(vaultId, canteen, usd("0.1"), "lunch");
  const t = await relay("pay", { ...tp, payee: museum }, tsig);
  record({ feature: "Relayer can't cheat", step: "A signed payment with its payee changed is sent to the relayer", actor: "attacker", expected: "rejected before any gas is spent", ok: !t.hash && t.status === 400, outcome: t.error, note: "no transaction" });
  const [rp, rsig] = await signPayment(vaultId, canteen, usd("0.1"), "bus");
  const first = await relay("pay", rp, rsig);
  if (first.hash) await confirmed(first.hash);
  const again = await relay("pay", rp, rsig);
  record({ feature: "Relayer can't cheat", step: "The same signed 0.1 payment is sent twice", actor: "attacker", expected: "first paid, second rejected", ok: Boolean(first.hash) && !again.hash && again.status === 409, outcome: again.error, tx: first.hash });
}

// 5. Money set aside for school.
{
  const v = await vaultOf(vaultId);
  const reserve = v.balance - usd("0.1"); // leaves the child 0.1 to spend
  const r = await call(parent, "setSchoolReserve", [vaultId, reserve]);
  record({ feature: "Money set aside for school", step: `Parent sets aside ${money(reserve)} of ${money(v.balance)} for school`, actor: "parent", expected: "child can spend only 0.1", ok: (await vaultOf(vaultId)).schoolReserve === reserve, tx: r.hash });
  await childPays("Money set aside for school", "Child tries 0.2 (inside the limits, but the rest is set aside)", "refused: earmarked for school", (o) => o.kind === "refuse" && o.reason === Reason.EarmarkedForSchool, vaultId, canteen, usd("0.2"), "snacks");
}

// 6. School billing with the hosted AI guardian (a veto-only smart account).
{
  const g = await call(parent, "setGuardian", [vaultId, guardianAccount]);
  record({ feature: "School billing", step: "Parent makes the hosted guardian smart account this allowance's guardian", actor: "parent", expected: "set", ok: true, tx: g.hash });
  const fund = await wallet(parent).sendTransaction({ to: biller.address, value: parseUnits("0.02", 18), type: "legacy" });
  await client.waitForTransactionReceipt({ hash: fund });
  const terms = { biller: biller.address, payTo: canteen, maxPerCharge: usd("0.2"), maxPerPeriod: usd("1"), period: 7n * 86400n, expiresAt: deadlineIn(7 * 86400), vetoWindow: 120n, firstChargeNeedsApproval: true };
  const gb = await call(parent, "grantBilling", [vaultId, terms, "Meal plan (evidence)"]);
  const billingId = parseEventLogs({ abi: pocketRailsAbi, logs: gb.receipt.logs, eventName: "BillingGranted" })[0]!.args.billingId;
  record({ feature: "School billing", step: `Parent grants billing #${billingId}: 0.2 per charge, 1 a week, 2-minute veto window, first charge needs approval`, actor: "parent", expected: "granted", ok: true, tx: gb.hash });

  const note = `Lunch ${new Date().toISOString().slice(0, 16)} (evidence)`;
  const c1 = await charge(billingId, usd("0.1"), note);
  const s1 = (await chargeOf(c1.chargeId)).status;
  record({ feature: "School billing", step: `School charges 0.1, “${note}” (charge #${c1.chargeId})`, actor: "school", expected: "first charge waits for the parent", ok: s1 === 2, outcome: c1.outcome.message, tx: c1.hash });
  const reserveBefore = (await vaultOf(vaultId)).schoolReserve;
  const ap = await call(parent, "approveCharge", [c1.chargeId]);
  const after1 = await vaultOf(vaultId);
  record({ feature: "School billing", step: `Parent approves the first charge`, actor: "parent", expected: "paid from the money set aside", ok: (await chargeOf(c1.chargeId)).status === 4 && after1.schoolReserve === reserveBefore - usd("0.1"), tx: ap.hash, note: `set aside ${money(reserveBefore)} → ${money(after1.schoolReserve)}` });

  const over = await charge(billingId, usd("0.5"), "School trip deposit");
  record({ feature: "School billing", step: "School asks for 0.5 (above the 0.2 per-charge limit)", actor: "school", expected: "refused and recorded", ok: over.outcome.kind === "refuse", outcome: over.outcome.message, reason: over.outcome.reason, tx: over.hash });

  const c2 = await charge(billingId, usd("0.1"), note);
  record({ feature: "AI guardian can only say no", step: `School sends the same lunch again (charge #${c2.chargeId})`, actor: "school", expected: "waits 2 minutes for a check", ok: (await chargeOf(c2.chargeId)).status === 1, tx: c2.hash });
  let vetoTx: Hash | undefined;
  let vetoReason = "";
  for (let i = 0; i < 30 && !vetoTx; i++) {
    await sleep(5000);
    const logs = await client.getContractEvents({ address: rails, abi: pocketRailsAbi, eventName: "ChargeVetoed", args: { chargeId: c2.chargeId }, fromBlock: c2.receipt.blockNumber });
    if (logs[0]) {
      vetoTx = logs[0].transactionHash;
      vetoReason = String(logs[0].args.reason ?? "");
    }
  }
  const vetoedBy = vetoTx ? (await client.getContractEvents({ address: rails, abi: pocketRailsAbi, eventName: "ChargeVetoed", args: { chargeId: c2.chargeId }, fromBlock: c2.receipt.blockNumber }))[0]!.args.by : undefined;
  record({ feature: "AI guardian can only say no", step: "The hosted guardian agent reviews it", actor: "guardian smart account (hosted agent)", expected: "vetoed by the smart account within the window", ok: Boolean(vetoTx) && vetoedBy?.toLowerCase() === guardianAccount.toLowerCase(), outcome: vetoReason ? `vetoed: “${vetoReason}”` : "no veto seen", tx: vetoTx, note: "ERC-4337 user operation signed by the veto-only session key" });

  // The guardian can't say yes: approving from the guardian account is refused by the contract (checked with a simulation, no transaction).
  let guardianYes = "";
  try {
    await client.simulateContract({ account: guardianAccount, address: rails, abi: pocketRailsAbi, functionName: "approveCharge", args: [c2.chargeId] });
    guardianYes = "accepted (unexpected)";
  } catch (e) {
    const reverted = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : undefined;
    guardianYes = reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName ? `reverted with ${reverted.data.errorName}(): only the parent can approve` : e instanceof BaseError ? e.shortMessage : String(e);
  }
  record({ feature: "AI guardian can only say no", step: "The guardian account tries to approve the charge instead", actor: "guardian smart account", expected: "the contract refuses", ok: guardianYes !== "accepted (unexpected)", outcome: guardianYes, note: "simulation, no transaction" });

  if (vetoTx) {
    const ov = await call(parent, "approveCharge", [c2.chargeId]);
    record({ feature: "Parent override", step: `Parent decides the vetoed charge #${c2.chargeId} was fine and pays it anyway`, actor: "parent", expected: "paid; only the parent can do this", ok: (await chargeOf(c2.chargeId)).status === 4, tx: ov.hash });
  }

  // Hold while the guardian is offline: the parent switches to a guardian that's offline and turns the hold on.
  // Silence must no longer mean "paid": the charge waits past its window until the guardian checks in.
  const offline = privateKeyToAccount(generatePrivateKey());
  const gasTx = await wallet(parent).sendTransaction({ to: offline.address, value: parseUnits("0.005", 18), type: "legacy" });
  await client.waitForTransactionReceipt({ hash: gasTx });
  await call(parent, "setGuardian", [vaultId, offline.address]);
  const h = await call(parent, "setGuardianHold", [vaultId, true]);
  record({ feature: "Hold while the guardian is offline", step: "Parent switches to a guardian that is offline and turns the hold on", actor: "parent", expected: "hold on", ok: (await client.readContract({ address: rails, abi: pocketRailsAbi, functionName: "holdIfGuardianSilent", args: [vaultId] })) === true, tx: h.hash });
  const c3 = await charge(billingId, usd("0.1"), `Lunch ${new Date().toISOString().slice(0, 16)} (evidence, guardian offline)`);
  const due = (await chargeOf(c3.chargeId)).settleAfter;
  while ((await client.getBlock()).timestamp < due + 2n) await sleep(5000);
  const held = await client.readContract({ address: rails, abi: pocketRailsAbi, functionName: "isHeld", args: [c3.chargeId] });
  let early = "";
  try {
    await client.simulateContract({ account: parent, address: rails, abi: pocketRailsAbi, functionName: "settle", args: [c3.chargeId] });
    early = "accepted (unexpected)";
  } catch (e) {
    const reverted = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : undefined;
    early = reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName ? `reverted with ${reverted.data.errorName}()` : e instanceof BaseError ? e.shortMessage : String(e);
  }
  record({ feature: "Hold while the guardian is offline", step: `School charge #${c3.chargeId} passes its 2-minute window while the guardian is offline; someone tries to settle it`, actor: "anyone", expected: "held: not paid", ok: held && early.includes("GuardianSilent") && (await chargeOf(c3.chargeId)).status === 1, outcome: early, tx: c3.hash, note: "settle checked with a simulation" });
  const reviewedUntil = (await client.getBlock()).timestamp;
  const ci = await call(offline, "guardianCheckIn", [reviewedUntil]);
  record({ feature: "Hold while the guardian is offline", step: "The guardian comes back online and checks in (it has seen the charge and lets it through)", actor: "guardian", expected: "charge no longer held", ok: !(await client.readContract({ address: rails, abi: pocketRailsAbi, functionName: "isHeld", args: [c3.chargeId] })), tx: ci.hash });
  const st = await call(parent, "settle", [c3.chargeId]);
  record({ feature: "Hold while the guardian is offline", step: `Charge #${c3.chargeId} is settled`, actor: "anyone", expected: "paid", ok: (await chargeOf(c3.chargeId)).status === 4, tx: st.hash });

  const rb = await call(parent, "revokeBilling", [billingId]);
  record({ feature: "Stop anything", step: `Parent revokes billing #${billingId}`, actor: "parent", expected: "revoked", ok: true, tx: rb.hash });
  const late = await charge(billingId, usd("0.1"), "Lunch (after revoke)");
  record({ feature: "Stop anything", step: "School tries to charge after the revoke", actor: "school", expected: "refused and recorded", ok: late.outcome.kind === "refuse", outcome: late.outcome.message, reason: late.outcome.reason, tx: late.hash });
}

// 7. Pause the child.
{
  const r = await call(parent, "revokeChild", [vaultId]);
  record({ feature: "Stop anything", step: "Parent pauses the child's spending", actor: "parent", expected: "paused", ok: true, tx: r.hash });
  await childPays("Stop anything", "Child tries to pay 0.1 at the canteen", "refused: paused", (o) => o.kind === "refuse" && o.reason === Reason.AccessRevoked, vaultId, canteen, usd("0.1"), "lunch");
}

// Clean up: the parent takes back what's left.
const end = await vaultOf(vaultId);
if (end.balance > 0n) {
  const w = await call(parent, "withdraw", [vaultId, end.balance, parent.address]);
  record({ feature: "Clean-up", step: `Parent withdraws the remaining ${money(end.balance)}`, actor: "parent", expected: "allowance empty", ok: (await vaultOf(vaultId)).balance === 0n, tx: w.hash });
}
const childGas = await client.getBalance({ address: child.address });
record({ feature: "Child pays on their own", step: "Child's gas balance after the whole run", actor: "child", expected: "0: it only signed", ok: childGas === 0n, outcome: `${childGas} wei` });

const failed = steps.filter((s) => !s.ok).length;
const out = {
  run: "PocketRails v3 evidence run",
  network: { name: chain.name, chainId: chain.id, explorer: "https://explorer-test.qday.info" },
  contract: rails,
  hostedApp: APP_URL,
  guardianAccount,
  vaultId: vaultId.toString(),
  accounts: { parent: parent.address, child: child.address, schoolBillingKey: biller.address, canteen, museum, submitter: submitter.address },
  startedAt,
  finishedAt: new Date().toISOString(),
  blocks: { from: startBlock.toString(), to: (await client.getBlockNumber()).toString() },
  passed: steps.length - failed,
  failed,
  steps: steps.map((s) => ({ ...s, explorer: s.tx ? txUrl(s.tx) : undefined })),
};
const file = path.resolve(import.meta.dirname, "../../docs/evidence/v3-run.json");
await mkdir(path.dirname(file), { recursive: true });
await writeFile(file, JSON.stringify(out, null, 2) + "\n");
console.log(`\n${steps.length - failed}/${steps.length} checks passed. Written to docs/evidence/v3-run.json`);
process.exit(failed === 0 ? 0 : 1);
