"use client";

import { erc20Abi } from "@aevum-kit/aevum";
import { decodeOutcome } from "@pocket-rails/sdk";
import { useMemo, useState } from "react";
import { isAddress, zeroAddress, type Address } from "viem";
import { useAccount, useConfig } from "wagmi";
import { readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { Explain, Guide } from "@/components/help";
import { NeedWallet, NotDeployed, StatusNotice, Timeline } from "@/components/ui";
import { useToken, useTokenBalance } from "@/components/useToken";
import { demo } from "@/lib/env";
import { noteFor } from "@/lib/childActions";
import {
  ChargeStatus,
  dateOf,
  fmt,
  nowSec,
  parseAmount,
  payeeLabels,
  sameAddr,
  short,
  timeLeft,
  useAllBillings,
  useAllCharges,
  useAllExceptions,
  useAllVaults,
  useServerNotes,
  useHistory,
  useRails,
  useRailsWrite,
  useSpentThisWeek,
  type Vault,
} from "@/lib/rails";
import { explainRails } from "@/lib/railsErrors";
import { useAction } from "@/lib/useAction";

const DAY = 86400n;
const days = (n: string) => BigInt(Math.max(1, Math.floor(Number(n) || 0))) * DAY;

export default function ParentPage() {
  const { address, isConnected } = useAccount();
  const { rails } = useRails();
  const vaults = useAllVaults();
  const mine = vaults.items.filter((v) => sameAddr(v.data.parent, address));
  const [selected, setSelected] = useState<bigint | "new" | null>(null);
  const showNew = selected === "new" || (!vaults.isLoading && mine.length === 0);
  const current = showNew ? undefined : (mine.find((v) => v.id === selected) ?? mine[0]);

  if (!rails) return <main className="shell"><NotDeployed /></main>;
  if (!isConnected) return <main className="shell"><NeedWallet role="parent" emoji="🧑‍🍼">The parent account funds the allowance and is the only one who can change the rules or say yes.</NeedWallet></main>;

  return (
    <main className="shell">
      <section className="page-head">
        <div>
          <p className="eyebrow">Parent</p>
          <h1>🧑‍🍼 Set the rules once.</h1>
          <p className="lede">Your child pays freely inside them. You only hear about what falls outside.</p>
        </div>
      </section>

      <div className="tabs" role="group" aria-label="Your allowances">
        {mine.map((v) => (
          <button key={v.id.toString()} type="button" aria-pressed={current?.id === v.id} onClick={() => setSelected(v.id)}>
            💰 Allowance #{v.id.toString()} · {short(v.data.child)}
          </button>
        ))}
        <button type="button" aria-pressed={showNew} onClick={() => setSelected("new")}>
          + New allowance
        </button>
      </div>

      {vaults.isLoading && <p className="empty">Loading your allowances…</p>}
      {showNew && !vaults.isLoading && (
        <Guide emoji="👇" title="Step 1: open your child's allowance">
          Paste your child&apos;s wallet address, choose the limits and the places they can pay. In demo mode it&apos;s already filled in.
        </Guide>
      )}
      {showNew && !vaults.isLoading && <CreateVault onCreated={(id) => (vaults.refetch(), setSelected(id))} />}
      {current && <VaultDashboard vaultId={current.id} vault={current.data} />}
    </main>
  );
}

// ---------------------------------------------------------------------------------------------- create

function CreateVault({ onCreated }: { onCreated: (id: bigint) => void }) {
  const write = useRailsWrite();
  const { status, run, busy } = useAction();
  const [child, setChild] = useState<string>(demo.child ?? "");
  const [perPayment, setPerPayment] = useState("0.5");
  const [weekly, setWeekly] = useState("2");
  const [ttl, setTtl] = useState("30");
  const [payees, setPayees] = useState([{ label: "School canteen", address: (demo.school as string) ?? "" }]);

  const per = parseAmount(perPayment);
  const week = parseAmount(weekly);
  const valid = isAddress(child) && per && week && week >= per && payees.every((p) => isAddress(p.address) && p.label.trim());

  async function submit() {
    if (!valid || !per || !week) return;
    const ok = await run(async (onSent) => {
      const r = await write(
        "createVault",
        [child, { perPaymentLimit: per, weeklyLimit: week, expiresAt: nowSec() + days(ttl) }, payees.map((p) => p.address), payees.map((p) => p.label.trim())],
        onSent,
      );
      const created = r.outcome.events.find((e) => e.eventName === "VaultCreated");
      if (created) setTimeout(() => onCreated(BigInt(String(created.args.vaultId))), 1500);
      return r;
    });
    if (!ok) return;
  }

  return (
    <section className="card form" aria-label="Open an allowance">
      <h2>💰 Open an allowance</h2>
      <p className="sub">This is version 1 of the rules <Explain term="rules" label="Rules" />. You can change anything later; every change becomes a new version.</p>
      <label className="lbl">
        Child&apos;s wallet address
        <input className="field" value={child} onChange={(e) => setChild(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
        {child && !isAddress(child) && <span className="field-error">That isn&apos;t a valid address.</span>}
      </label>
      <div className="form-row">
        <div className="lbl">
          <span>
            <label htmlFor="new-per-payment">Per payment (tUSD8</label> <Explain term="tUSD8" />)
          </span>
          <input id="new-per-payment" className="field" inputMode="decimal" value={perPayment} onChange={(e) => setPerPayment(e.target.value)} />
        </div>
        <label className="lbl">
          Per week (tUSD8) <span className="hint">resets Monday 00:00 UTC</span>
          <input className="field" inputMode="decimal" value={weekly} onChange={(e) => setWeekly(e.target.value)} />
        </label>
        <label className="lbl">
          Access ends in (days)
          <input className="field" inputMode="numeric" value={ttl} onChange={(e) => setTtl(e.target.value)} />
        </label>
      </div>
      {per && week && week < per && <span className="field-error">The weekly limit must be at least the per-payment limit.</span>}
      <div className="stack" style={{ gap: 10 }}>
        <span className="lbl">
          <span>Approved places <Explain term="approvedPlace" label="Approved place" /></span>
        </span>
        {payees.map((p, i) => (
          <div key={i} className="form-row">
            <input className="field text" value={p.label} placeholder="Name, e.g. School canteen" onChange={(e) => setPayees(payees.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input className="field" value={p.address} placeholder="0x…" spellCheck={false} onChange={(e) => setPayees(payees.map((x, j) => (j === i ? { ...x, address: e.target.value.trim() } : x)))} />
          </div>
        ))}
        <div className="actions">
          <button type="button" className="btn small ghost" onClick={() => setPayees([...payees, { label: "", address: "" }])}>
            + Add a place
          </button>
          {payees.length > 1 && (
            <button type="button" className="btn small ghost" onClick={() => setPayees(payees.slice(0, -1))}>
              Remove last
            </button>
          )}
        </div>
      </div>
      <button type="button" className="btn big" disabled={!valid || busy} onClick={submit}>
        Open allowance
      </button>
      <StatusNotice status={status} />
      <p className="fine">Next you&apos;ll top it up. Anyone can add money, but only you can take money out or change the rules.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- dashboard

function VaultDashboard({ vaultId, vault }: { vaultId: bigint; vault: Vault }) {
  const spent = useSpentThisWeek(vaultId);
  const history = useHistory(vaultId);
  const labels = useMemo(() => payeeLabels(history.data), [history.data]);
  const label = (a: string) => (sameAddr(a, vault.child) ? "your child" : sameAddr(a, vault.parent) ? "you" : sameAddr(a, vault.guardian) ? "the guardian" : labels.get(a.toLowerCase()) ?? short(a));
  const expired = nowSec() >= vault.rules.expiresAt;

  return (
    <>
      <ParentGuide vaultId={vaultId} vault={vault} spent={spent.data} />
      <section className="stats" aria-label="Allowance summary">
        <div className="stat">
          <span className="stat-label">💰 Balance</span>
          <span className="stat-value">
            {fmt(vault.balance)} <small>tUSD8</small>
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">🗓️ Spent this week</span>
          <span className="stat-value">
            {fmt(spent.data)} <small>/ {fmt(vault.rules.weeklyLimit)}</small>
          </span>
          <span className="stat-note">max {fmt(vault.rules.perPaymentLimit)} per payment</span>
        </div>
        <div className="stat">
          <span className="stat-label">🎒 Child can spend</span>
          <span className="stat-value" style={{ fontSize: 20 }}>
            {!vault.childActive ? <span className="badge bad">Paused</span> : expired ? <span className="badge bad">Ended</span> : <span className="badge good">Active</span>}
          </span>
          <span className="stat-note">until {dateOf(vault.rules.expiresAt)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">📋 Rules</span>
          <span className="stat-value">v{vault.version.toString()}</span>
          <span className="stat-note">child {short(vault.child)}</span>
        </div>
      </section>

      <Requests vaultId={vaultId} vault={vault} label={label} />
      <SchoolCharges vaultId={vaultId} vault={vault} label={label} />
      <StoppedCharges vaultId={vaultId} vault={vault} label={label} history={history.data} />

      <div className="grid-2">
        <Money vaultId={vaultId} vault={vault} />
        <Rules vaultId={vaultId} vault={vault} places={labels} history={history.data} />
        <SchoolBilling vaultId={vaultId} vault={vault} label={label} />
        <Guardian vaultId={vaultId} vault={vault} />
        <Danger vaultId={vaultId} vault={vault} />
        <section className="card">
          <h2>🧾 History <Explain term="onChain" label="On Aevum" /></h2>
          <p className="sub">Every change, payment, refusal and decision, with a public record for each.</p>
          <div style={{ maxHeight: 520, overflowY: "auto" }}>
            <Timeline events={history.data} label={label} money={(v) => `${fmt(BigInt(String(v)))} tUSD8`} loading={history.isLoading} error={history.error?.message} />
          </div>
        </section>
      </div>
    </>
  );
}

/** The single most useful next step for this allowance, based on what's happening right now. */
function ParentGuide({ vaultId, vault, spent }: { vaultId: bigint; vault: Vault; spent?: bigint }) {
  const exceptions = useAllExceptions();
  const billings = useAllBillings();
  const charges = useAllCharges();
  const go = (id: string) => () => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const requests = exceptions.items.filter((x) => x.data.vaultId === vaultId && x.data.status === 1 && x.data.epoch === vault.childEpoch).length;
  const myBillings = new Set(billings.items.filter((b) => b.data.vaultId === vaultId && !b.data.revoked && b.data.epoch === vault.billingEpoch).map((b) => b.id));
  const waiting = charges.items.filter((c) => myBillings.has(c.data.billingId) && (c.data.status === 1 || c.data.status === 2)).length;

  if (requests > 0)
    return <Guide emoji="🙋" title={`Your child is asking for ${requests === 1 ? "something" : `${requests} things`}`} action={{ label: "See the request", onClick: go("requests") }}>Allow it once, or decline. Nothing is paid until you decide.</Guide>;
  if (waiting > 0)
    return <Guide emoji="🏫" title="A school charge is waiting" action={{ label: "Check it", onClick: go("charges") }}>It will be paid when its waiting time ends, unless you or the guardian stop it.</Guide>;
  if (!vault.childActive)
    return <Guide emoji="⏸️" title="Your child's spending is paused" action={{ label: "Turn it back on", onClick: go("stop") }}>Payments are refused (and recorded) until you turn spending back on.</Guide>;
  if (vault.balance === 0n)
    return <Guide emoji="💵" title="Step 2: top up the allowance" action={{ label: "Add money", onClick: go("money") }}>Your child can&apos;t pay anything until there&apos;s money in it.</Guide>;
  if (myBillings.size === 0)
    return <Guide emoji="🏫" title="Optional: let the school bill meals" action={{ label: "Set up school billing", onClick: go("billing") }}>Choose a limit per charge and per week. Every charge waits a few minutes so it can be stopped.</Guide>;
  if (vault.guardian === zeroAddress)
    return <Guide emoji="🛡️" title="Optional: add a guardian" action={{ label: "Add a guardian", onClick: go("guardian") }}>A guardian, even an AI one, checks school charges for you. It can only say no.</Guide>;
  return (
    <Guide emoji="🌟" title="All set">
      Your child can pay approved places on their own{spent !== undefined ? ` (${fmt(spent)} of ${fmt(vault.rules.weeklyLimit)} spent this week)` : ""}. You&apos;ll see requests and school charges here.
    </Guide>
  );
}

function Requests({ vaultId, vault, label }: { vaultId: bigint; vault: Vault; label: (a: string) => string }) {
  const exceptions = useAllExceptions();
  const write = useRailsWrite();
  const { status, run, busy } = useAction();
  const pending = exceptions.items.filter((x) => x.data.vaultId === vaultId && x.data.status === 1 && x.data.epoch === vault.childEpoch);
  if (pending.length === 0 && status.state === "idle") return null;
  return (
    <section id="requests" className="card info" aria-label="Requests from your child">
      <h2>🙋 Requests from your child</h2>
      <p className="sub">“Allow once” covers only that exact place, amount and note, once, for 24 hours <Explain term="exception" label="Exception" />. Your everyday rules don&apos;t change.</p>
      <div className="list">
        {pending.map(({ id, data: x }) => (
          <div key={id.toString()} className="item">
            <div className="item-main">
              <span className="item-title">
                {fmt(x.amount)} tUSD8 to {label(x.payee)}
              </span>
              <span className="item-sub">
                Request #{id.toString()} · {noteFor(x.memoHash) ?? "note kept on the child's device"} · {short(x.payee)}
              </span>
            </div>
            <div className="actions">
              <button type="button" className="btn small" disabled={busy} onClick={() => run((s) => write("allowOnce", [id, nowSec() + DAY], s))}>
                Allow once
              </button>
              <button type="button" className="btn small secondary" disabled={busy} onClick={() => run((s) => write("declineException", [id], s))}>
                Decline
              </button>
            </div>
          </div>
        ))}
        {pending.length === 0 && <p className="fine">No requests waiting.</p>}
      </div>
      <StatusNotice status={status} />
    </section>
  );
}

function SchoolCharges({ vaultId, vault, label }: { vaultId: bigint; vault: Vault; label: (a: string) => string }) {
  const billings = useAllBillings();
  const charges = useAllCharges();
  const write = useRailsWrite();
  const { status, run, busy } = useAction();
  const myBillings = new Map(billings.items.filter((b) => b.data.vaultId === vaultId).map((b) => [b.id, b.data]));
  const open = charges.items.filter((c) => myBillings.has(c.data.billingId) && (c.data.status === 1 || c.data.status === 2));
  const serverNote = useServerNotes(open.map((c) => c.data.memoHash));
  if (open.length === 0 && status.state === "idle") return null;
  return (
    <section id="charges" className="card info" aria-label="School charges waiting">
      <h2>🏫 School charges waiting</h2>
      <p className="sub">Each charge is paid automatically when its waiting time ends <Explain term="vetoWindow" label="Waiting time" />, unless you or the guardian stop it. You can also approve early.</p>
      <div className="list">
        {open.map(({ id, data: c }) => {
          const b = myBillings.get(c.billingId)!;
          const awaiting = c.status === 2;
          const windowOpen = nowSec() < c.settleAfter;
          return (
            <div key={id.toString()} className="item">
              <div className="item-main">
                <span className="item-title">
                  {fmt(c.amount)} tUSD8 to {label(b.payTo)}
                </span>
                <span className="item-sub">
                  “{serverNote(c.memoHash) ?? noteFor(c.memoHash) ?? "no note"}” · Charge #{id.toString()} ·{" "}
                  {awaiting ? "first charge: waits for your approval" : windowOpen ? `settles in ${timeLeft(c.settleAfter)} unless vetoed` : "veto window over: ready to settle"}
                </span>
              </div>
              <div className="actions">
                <button type="button" className="btn small" disabled={busy} onClick={() => run((s) => write("approveCharge", [id], s))}>
                  Approve
                </button>
                {(awaiting || windowOpen) && (
                  <button type="button" className="btn small secondary" disabled={busy} onClick={() => run((s) => write("vetoCharge", [id, "Vetoed by parent"], s))}>
                    Veto
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {open.length === 0 && <p className="fine">Nothing waiting.</p>}
      </div>
      <StatusNotice status={status} />
      {!vault.guardian || vault.guardian === zeroAddress ? <p className="fine">Tip: set a guardian below to review charges for you.</p> : null}
    </section>
  );
}

/**
 * Charges that were vetoed (by the guardian or the parent), with the parent's override.
 * approveCharge on a vetoed charge pays it now. Only the parent can do this; the guardian never can.
 * It's the parent's explicit decision, so the period cap doesn't block it (the amount still counts toward it).
 * A charge from a revoked permission can't be paid, even by the parent.
 */
function StoppedCharges({
  vaultId,
  vault,
  label,
  history,
}: {
  vaultId: bigint;
  vault: Vault;
  label: (a: string) => string;
  history: ReturnType<typeof useHistory>["data"];
}) {
  const billings = useAllBillings();
  const charges = useAllCharges();
  const write = useRailsWrite();
  const { status, run, busy } = useAction();
  const [confirming, setConfirming] = useState<bigint | null>(null);
  const myBillings = new Map(billings.items.filter((b) => b.data.vaultId === vaultId).map((b) => [b.id, b.data]));
  const stopped = charges.items.filter((c) => myBillings.has(c.data.billingId) && c.data.status === 3).slice(0, 5);
  const serverNote = useServerNotes(stopped.map((c) => c.data.memoHash));
  // Who vetoed each charge and why, from the ChargeVetoed events.
  const vetoes = new Map<string, { by: string; reason: string }>();
  for (const e of history ?? []) {
    if (e.eventName === "ChargeVetoed" && !vetoes.has(String(e.args.chargeId))) vetoes.set(String(e.args.chargeId), { by: String(e.args.by), reason: String(e.args.reason ?? "") });
  }
  if (stopped.length === 0 && status.state === "idle") return null;

  return (
    <section id="stopped" className="card" aria-label="Stopped charges">
      <h2>✋ Stopped charges</h2>
      <p className="sub">
        These school charges were vetoed, so nothing was paid. If one was stopped by mistake, you can still pay it. Only you can do this; the guardian
        never can.
      </p>
      <div className="list">
        {stopped.map(({ id, data: c }) => {
          const b = myBillings.get(c.billingId)!;
          const veto = vetoes.get(id.toString());
          const who = veto ? label(veto.by) : "someone";
          const live = !b.revoked && b.epoch === vault.billingEpoch;
          const enough = vault.balance >= c.amount;
          return (
            <div key={id.toString()} className="item">
              <div className="item-main">
                <span className="item-title">
                  {fmt(c.amount)} tUSD8 to {label(b.payTo)}
                </span>
                <span className="item-sub">
                  “{serverNote(c.memoHash) ?? noteFor(c.memoHash) ?? "no note"}” · Charge #{id.toString()} · stopped by {who}
                  {veto?.reason ? `: “${veto.reason}”` : ""}
                </span>
                {confirming === id && (
                  <div className="notice warn" style={{ marginTop: 10 }}>
                    <strong>Pay this charge anyway?</strong>
                    <span>
                      {fmt(c.amount)} tUSD8 goes to {label(b.payTo)} right away. {veto?.reason ? `It was stopped because: “${veto.reason}”. ` : ""}It counts toward this
                      period&apos;s school limit, and it&apos;s allowed even if it goes over, because this is your decision.
                    </span>
                    <div className="actions">
                      <button type="button" className="btn small" disabled={busy} onClick={() => (setConfirming(null), run((s) => write("approveCharge", [id], s)))}>
                        Yes, pay it
                      </button>
                      <button type="button" className="btn small secondary" disabled={busy} onClick={() => setConfirming(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {!live ? (
                <span className="badge bad" title="A charge from a cancelled billing permission can't be paid, even by you.">
                  Can&apos;t be paid: billing cancelled
                </span>
              ) : !enough ? (
                <span className="badge warn">Not enough in the allowance</span>
              ) : (
                confirming !== id && (
                  <button type="button" className="btn small secondary" disabled={busy} onClick={() => setConfirming(id)}>
                    Pay it anyway
                  </button>
                )
              )}
            </div>
          );
        })}
        {stopped.length === 0 && <p className="fine">No stopped charges.</p>}
      </div>
      <StatusNotice status={status} />
    </section>
  );
}

function Money({ vaultId, vault }: { vaultId: bigint; vault: Vault }) {
  const config = useConfig();
  const { address } = useAccount();
  const { rails, chainId } = useRails();
  const token = useToken();
  const wallet = useTokenBalance(address);
  const write = useRailsWrite();
  const { status, run, busy } = useAction();
  const [amountText, setAmountText] = useState("1");
  const amount = parseAmount(amountText);

  async function topUp() {
    if (!amount || !token.address || !rails || !address) return;
    await run(async (onSent) => {
      // Approve exactly this amount (never unlimited), then deposit.
      const allowance = await readContract(config, { address: token.address!, abi: erc20Abi, functionName: "allowance", args: [address, rails], chainId });
      if (allowance < amount) {
        try {
          const h = await writeContract(config, { address: token.address!, abi: erc20Abi, functionName: "approve", args: [rails, amount], chainId, type: "legacy" });
          onSent(h);
          const rc = await waitForTransactionReceipt(config, { hash: h, chainId });
          if (rc.status !== "success") return { hash: h, outcome: decodeOutcome(rc, rails) };
        } catch (e) {
          throw new Error(explainRails(e));
        }
      }
      return write("deposit", [vaultId, amount], onSent);
    });
  }

  return (
    <section id="money" className="card form">
      <h2>💵 Money</h2>
      <p className="sub">
        Your wallet: {fmt(wallet.data)} tUSD8 · Allowance: {fmt(vault.balance)} tUSD8
      </p>
      <label className="lbl">
        Amount (tUSD8)
        <input className="field" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
      </label>
      <div className="actions">
        <button type="button" className="btn" disabled={!amount || busy || (wallet.data !== undefined && amount > wallet.data)} onClick={topUp}>
          Top up
        </button>
        <button type="button" className="btn secondary" disabled={!amount || busy || amount > vault.balance} onClick={() => amount && address && run((s) => write("withdraw", [vaultId, amount, address], s))}>
          Withdraw to my wallet
        </button>
      </div>
      {amount && wallet.data !== undefined && amount > wallet.data && <span className="field-error">Your wallet doesn&apos;t hold that much tUSD8.</span>}
      <StatusNotice status={status} />
    </section>
  );
}

function Rules({ vaultId, vault, places, history }: { vaultId: bigint; vault: Vault; places: Map<string, string>; history: ReturnType<typeof useHistory>["data"] }) {
  const write = useRailsWrite();
  const { status, run, busy } = useAction();
  const [perPayment, setPerPayment] = useState(fmt(vault.rules.perPaymentLimit, 6));
  const [weekly, setWeekly] = useState(fmt(vault.rules.weeklyLimit, 6));
  const [ttl, setTtl] = useState("30");
  const [newLabel, setNewLabel] = useState("");
  const [newAddr, setNewAddr] = useState("");
  const per = parseAmount(perPayment);
  const week = parseAmount(weekly);

  // Current approved places: the latest PayeeChanged per payee.
  const current = useMemo(() => {
    const latest = new Map<string, { allowed: boolean; label: string; address: string }>();
    for (const e of [...(history ?? [])].reverse())
      if (e.eventName === "PayeeChanged") latest.set(String(e.args.payee).toLowerCase(), { allowed: Boolean(e.args.allowed), label: String(e.args.label), address: String(e.args.payee) });
    return [...latest.values()].filter((p) => p.allowed);
  }, [history]);

  return (
    <section className="card form">
      <h2>📋 Rules, version {vault.version.toString()} <Explain term="rules" label="Rules" /></h2>
      <div className="form-row">
        <label className="lbl">
          Per payment
          <input className="field" inputMode="decimal" value={perPayment} onChange={(e) => setPerPayment(e.target.value)} />
        </label>
        <label className="lbl">
          Per week
          <input className="field" inputMode="decimal" value={weekly} onChange={(e) => setWeekly(e.target.value)} />
        </label>
        <label className="lbl">
          Ends in (days)
          <input className="field" inputMode="numeric" value={ttl} onChange={(e) => setTtl(e.target.value)} />
        </label>
      </div>
      <button
        type="button"
        className="btn secondary"
        disabled={!per || !week || week < per || busy}
        onClick={() => per && week && run((s) => write("setRules", [vaultId, { perPaymentLimit: per, weeklyLimit: week, expiresAt: nowSec() + days(ttl) }], s))}
      >
        Save as a new version
      </button>

      <span className="lbl">
        <span>Approved places <Explain term="approvedPlace" label="Approved place" /></span>
      </span>
      <div className="list">
        {current.map((p) => (
          <div key={p.address} className="item">
            <div className="item-main">
              <span className="item-title">{p.label || places.get(p.address.toLowerCase()) || short(p.address)}</span>
              <span className="item-sub mono">{p.address}</span>
            </div>
            <button type="button" className="btn small ghost" disabled={busy} onClick={() => run((s) => write("setPayee", [vaultId, p.address, false, p.label], s))}>
              Remove
            </button>
          </div>
        ))}
        {current.length === 0 && <p className="fine">No approved places.</p>}
      </div>
      <div className="form-row">
        <input className="field text" placeholder="Name" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
        <input className="field" placeholder="0x…" value={newAddr} spellCheck={false} onChange={(e) => setNewAddr(e.target.value.trim())} />
      </div>
      <button type="button" className="btn small secondary" disabled={!isAddress(newAddr) || !newLabel.trim() || busy} onClick={() => run((s) => write("setPayee", [vaultId, newAddr, true, newLabel.trim()], s))}>
        Approve this place
      </button>
      <StatusNotice status={status} />
    </section>
  );
}

function SchoolBilling({ vaultId, vault, label }: { vaultId: bigint; vault: Vault; label: (a: string) => string }) {
  const billings = useAllBillings();
  const write = useRailsWrite();
  const { status, run, busy } = useAction();
  const [name, setName] = useState("Meal plan");
  const [biller, setBiller] = useState<string>(demo.school ?? "");
  const [payTo, setPayTo] = useState<string>(demo.school ?? "");
  const [perCharge, setPerCharge] = useState("0.3");
  const [perPeriod, setPerPeriod] = useState("1.5");
  const [periodDays, setPeriodDays] = useState("7");
  const [ttl, setTtl] = useState("90");
  const [vetoMin, setVetoMin] = useState("5");
  const [firstApproval, setFirstApproval] = useState(true);
  const pc = parseAmount(perCharge);
  const pp = parseAmount(perPeriod);
  const veto = BigInt(Math.max(1, Math.floor(Number(vetoMin) || 0))) * 60n;
  const valid = isAddress(biller) && isAddress(payTo) && pc && pp && pp >= pc && name.trim();
  const mine = billings.items.filter((b) => b.data.vaultId === vaultId);

  return (
    <section id="billing" className="card form">
      <h2>🏫 School billing <Explain term="billing" label="School billing" /></h2>
      <p className="sub">Let the school request charges up to limits you choose. Each charge waits a few minutes so it can be stopped.</p>
      <div className="list">
        {mine.map(({ id, data: b }) => {
          const dead = b.revoked || b.epoch !== vault.billingEpoch;
          return (
            <div key={id.toString()} className="item">
              <div className="item-main">
                <span className="item-title">
                  #{id.toString()} · pays {label(b.payTo)}
                </span>
                <span className="item-sub">
                  max {fmt(b.maxPerCharge)} per charge, {fmt(b.maxPerPeriod)} per {Number(b.period) / 86400} days · used {fmt(b.periodUsed)} · veto window {Number(b.vetoWindow) / 60} min · until {dateOf(b.expiresAt)}
                </span>
              </div>
              {dead ? (
                <span className="badge bad">Revoked</span>
              ) : (
                <button type="button" className="btn small ghost" disabled={busy} onClick={() => run((s) => write("revokeBilling", [id], s))}>
                  Revoke
                </button>
              )}
            </div>
          );
        })}
        {mine.length === 0 && <p className="fine">No billing permissions yet.</p>}
      </div>
      <details>
        <summary className="btn small secondary">Grant a billing permission</summary>
        <div className="form" style={{ marginTop: 12 }}>
          <label className="lbl">
            Name
            <input className="field text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="lbl">
            School billing key <span className="hint">(the account that sends charges)</span>
            <input className="field" value={biller} spellCheck={false} onChange={(e) => setBiller(e.target.value.trim())} placeholder="0x…" />
          </label>
          <label className="lbl">
            Pays to <span className="hint">(the school&apos;s account)</span>
            <input className="field" value={payTo} spellCheck={false} onChange={(e) => setPayTo(e.target.value.trim())} placeholder="0x…" />
          </label>
          <div className="form-row">
            <label className="lbl">
              Max per charge
              <input className="field" inputMode="decimal" value={perCharge} onChange={(e) => setPerCharge(e.target.value)} />
            </label>
            <label className="lbl">
              Max per period
              <input className="field" inputMode="decimal" value={perPeriod} onChange={(e) => setPerPeriod(e.target.value)} />
            </label>
            <label className="lbl">
              Period (days)
              <input className="field" inputMode="numeric" value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} />
            </label>
          </div>
          <div className="form-row">
            <label className="lbl">
              Veto window (minutes)
              <input className="field" inputMode="numeric" value={vetoMin} onChange={(e) => setVetoMin(e.target.value)} />
            </label>
            <label className="lbl">
              Ends in (days)
              <input className="field" inputMode="numeric" value={ttl} onChange={(e) => setTtl(e.target.value)} />
            </label>
          </div>
          <label className="check-line">
            <input type="checkbox" checked={firstApproval} onChange={(e) => setFirstApproval(e.target.checked)} />
            The first charge waits for my approval
          </label>
          <button
            type="button"
            className="btn"
            disabled={!valid || busy}
            onClick={() =>
              valid &&
              pc &&
              pp &&
              run((s) =>
                write(
                  "grantBilling",
                  [
                    vaultId,
                    { biller, payTo, maxPerCharge: pc, maxPerPeriod: pp, period: days(periodDays), expiresAt: nowSec() + days(ttl), vetoWindow: veto, firstChargeNeedsApproval: firstApproval },
                    name.trim(),
                  ],
                  s,
                ),
              )
            }
          >
            Grant
          </button>
        </div>
      </details>
      <StatusNotice status={status} />
    </section>
  );
}

function Guardian({ vaultId, vault }: { vaultId: bigint; vault: Vault }) {
  const write = useRailsWrite();
  const { status, run, busy } = useAction();
  const [g, setG] = useState<string>(demo.guardian ?? "");
  const hasGuardian = vault.guardian !== zeroAddress;
  return (
    <section id="guardian" className="card form">
      <h2>🛡️ Guardian <Explain term="guardian" label="Guardian" /></h2>
      <p className="sub">A helper, or an AI agent, that checks school charges and stops the wrong ones. It can never approve, raise a limit or move money.</p>
      <p>{hasGuardian ? <>Current: <code>{vault.guardian}</code></> : "No guardian set."}</p>
      <input className="field" value={g} spellCheck={false} onChange={(e) => setG(e.target.value.trim())} placeholder="0x…" />
      <div className="actions">
        <button type="button" className="btn secondary" disabled={!isAddress(g) || busy} onClick={() => run((s) => write("setGuardian", [vaultId, g], s))}>
          Set guardian
        </button>
        {hasGuardian && (
          <button type="button" className="btn ghost" disabled={busy} onClick={() => run((s) => write("setGuardian", [vaultId, zeroAddress], s))}>
            Remove
          </button>
        )}
      </div>
      <StatusNotice status={status} />
    </section>
  );
}

function Danger({ vaultId, vault }: { vaultId: bigint; vault: Vault }) {
  const write = useRailsWrite();
  const { status, run, busy } = useAction();
  const [confirmAll, setConfirmAll] = useState(false);
  return (
    <section id="stop" className="card form">
      <h2>⛔ Pause and stop</h2>
      <p className="sub">Works within seconds. The money stays in the allowance for you to withdraw.</p>
      <div className="actions">
        {vault.childActive ? (
          <button type="button" className="btn warn" disabled={busy} onClick={() => run((s) => write("revokeChild", [vaultId], s))}>
            Pause child&apos;s spending
          </button>
        ) : (
          <button type="button" className="btn secondary" disabled={busy} onClick={() => run((s) => write("setChild", [vaultId, vault.child], s))}>
            Turn spending back on
          </button>
        )}
        {!confirmAll ? (
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirmAll(true)}>
            Revoke everything…
          </button>
        ) : (
          <button type="button" className="btn warn" disabled={busy} onClick={() => (setConfirmAll(false), run((s) => write("revokeAll", [vaultId], s)))}>
            Yes: stop the child, all school billing and all pending items
          </button>
        )}
      </div>
      <p className="fine">Turning spending back on starts a new key epoch: requests and signed payments from before the pause stay dead.</p>
      <StatusNotice status={status} />
    </section>
  );
}
