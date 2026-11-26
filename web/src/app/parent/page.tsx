"use client";

import { erc20Abi } from "@aevum-kit/aevum";
import { decodeOutcome } from "@pocket-rails/sdk";
import { useMemo, useState } from "react";
import { isAddress, zeroAddress, type Address } from "viem";
import { useAccount, useConfig } from "wagmi";
import { readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { Explain, Guide } from "@/components/help";
import { Chip, DashShell, DemoBanner, Kpi, PanelHead, type NavItem } from "@/components/dash";
import { NotDeployed, StatusNotice, Timeline } from "@/components/ui";
import { useToken, useTokenBalance } from "@/components/useToken";
import { demo, showcaseVaultId } from "@/lib/env";
import { ReadOnlyContext } from "@/lib/viewMode";
import { useHashView } from "@/lib/useHashView";
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

type ParentView = "overview" | "money" | "rules" | "school" | "guardian" | "history" | "stop";

/** Waiting requests and school charges for one allowance (for the sidebar counts and the guide). */
function useWaiting(vaultId?: bigint, vault?: Vault) {
  const exceptions = useAllExceptions();
  const billings = useAllBillings();
  const charges = useAllCharges();
  if (!vaultId || !vault) return { requests: 0, charges: 0, billings: 0 };
  const requests = exceptions.items.filter((x) => x.data.vaultId === vaultId && x.data.status === 1 && x.data.epoch === vault.childEpoch).length;
  const live = new Set(billings.items.filter((b) => b.data.vaultId === vaultId && !b.data.revoked && b.data.epoch === vault.billingEpoch).map((b) => b.id));
  const waiting = charges.items.filter((c) => live.has(c.data.billingId) && (c.data.status === 1 || c.data.status === 2)).length;
  return { requests, charges: waiting, billings: live.size };
}

export default function ParentPage() {
  const { address, isConnected, status: walletStatus } = useAccount();
  const { rails } = useRails();
  const vaults = useAllVaults();
  const [demoPick, setDemoPick] = useState(false);
  const isDemo = !isConnected || demoPick;
  const mine = vaults.items.filter((v) => (isDemo ? v.id === showcaseVaultId : sameAddr(v.data.parent, address)));
  const [selected, setSelected] = useState<bigint | "new" | null>(null);
  const [view, setView] = useHashView<ParentView>(["overview", "money", "rules", "school", "guardian", "history", "stop"], "overview");
  const showNew = !isDemo && (selected === "new" || (!vaults.isLoading && mine.length === 0));
  // Open on the chosen allowance, else the showcase one if it's yours, else the newest.
  const current = showNew ? undefined : (mine.find((v) => v.id === selected) ?? mine.find((v) => v.id === showcaseVaultId) ?? mine[0]);
  const waiting = useWaiting(current?.id, current?.data);

  if (!rails) return <main className="shell"><NotDeployed /></main>;
  if (walletStatus === "connecting" || walletStatus === "reconnecting") return <main className="shell"><p className="empty">Connecting your wallet…</p></main>;

  const nav: NavItem<ParentView>[] = current
    ? [
        { key: "overview", emoji: "🏠", label: "Overview", count: waiting.requests + waiting.charges },
        { key: "money", emoji: "💵", label: "Money" },
        { key: "rules", emoji: "📋", label: "Rules & places" },
        { key: "school", emoji: "🏫", label: "School billing", count: waiting.charges },
        { key: "guardian", emoji: "🚦", label: "Guardian" },
        { key: "history", emoji: "🧾", label: "History" },
        { key: "stop", emoji: "⛔", label: "Pause & stop" },
      ]
    : [];

  const picker = !isDemo ? (
    <label className="dash-picker">
      <span className="fine">Allowance</span>
      <select
        value={showNew ? "new" : (current?.id.toString() ?? "")}
        onChange={(e) => (setSelected(e.target.value === "new" ? "new" : BigInt(e.target.value)), setView("overview"))}
      >
        {mine.map((v) => (
          <option key={v.id.toString()} value={v.id.toString()}>
            💰 #{v.id.toString()} · child {short(v.data.child)}
          </option>
        ))}
        <option value="new">+ New allowance</option>
      </select>
    </label>
  ) : isConnected ? (
    <button type="button" className="btn small secondary" onClick={() => setDemoPick(false)}>
      ← Back to my allowances
    </button>
  ) : null;

  return (
    <ReadOnlyContext.Provider value={isDemo}>
      <main className="shell wide">
        {isDemo && (
          <DemoBanner
            role="parent"
            what={<>You&apos;re seeing what a parent sees, using the showcase family (allowance #{showcaseVaultId.toString()}). The school agent bills it and an AI guardian checks every charge.</>}
          />
        )}
        <DashShell
          title="Parent"
          emoji="🧑‍🍼"
          nav={nav}
          view={view}
          onView={(k) => (setSelected(current?.id ?? null), setView(k))}
          top={picker}
          who={{ label: isDemo ? "Showcase parent" : "You", address: isDemo ? current?.data.parent : address, demo: isDemo }}
        >
          {vaults.isLoading && !current && <p className="empty">Loading allowances…</p>}
          {showNew && !vaults.isLoading && (
            <>
              <Guide emoji="👇" title="Step 1: open your child's allowance">
                Paste your child&apos;s wallet address, choose the limits and the places they can pay. In demo mode it&apos;s already filled in.
              </Guide>
              <CreateVault onCreated={(id) => (vaults.refetch(), setSelected(id), setView("overview"))} />
              {mine.length === 0 && (
                <p className="fine">
                  Not ready yet?{" "}
                  <button type="button" className="btn small ghost" onClick={() => setDemoPick(true)}>
                    Look around the showcase allowance first
                  </button>
                </p>
              )}
            </>
          )}
          {!vaults.isLoading && isDemo && !current && <p className="empty">The showcase allowance isn&apos;t on this network.</p>}
          {current && <VaultDashboard vaultId={current.id} vault={current.data} view={view} setView={setView} isDemo={isDemo} waiting={waiting} />}
        </DashShell>
      </main>
    </ReadOnlyContext.Provider>
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
    <section className="card form narrow" aria-label="Open an allowance">
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
            <label htmlFor="new-per-payment">Per payment (tUSD8)</label> <Explain term="tUSD8" />
          </span>
          <input id="new-per-payment" className="field" inputMode="decimal" value={perPayment} onChange={(e) => setPerPayment(e.target.value)} />
        </div>
        <label className="lbl">
          Per week (tUSD8)
          <input className="field" inputMode="decimal" value={weekly} onChange={(e) => setWeekly(e.target.value)} />
          <span className="hint">resets Monday 00:00 UTC</span>
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

function VaultDashboard({
  vaultId,
  vault,
  view,
  setView,
  isDemo,
  waiting,
}: {
  vaultId: bigint;
  vault: Vault;
  view: ParentView;
  setView: (v: ParentView) => void;
  isDemo: boolean;
  waiting: ReturnType<typeof useWaiting>;
}) {
  const spent = useSpentThisWeek(vaultId);
  const history = useHistory(vaultId);
  const labels = useMemo(() => payeeLabels(history.data), [history.data]);
  const who = isDemo ? "the parent" : "you";
  const label = (a: string) => (sameAddr(a, vault.child) ? "the child" : sameAddr(a, vault.parent) ? who : sameAddr(a, vault.guardian) ? "the guardian" : labels.get(a.toLowerCase()) ?? short(a));
  const expired = nowSec() >= vault.rules.expiresAt;
  const money = (v: unknown) => `${fmt(BigInt(String(v)))} tUSD8`;
  const weekly = vault.rules.weeklyLimit;
  const used = spent.data ?? 0n;
  const places = [...new Set(history.data?.filter((e) => e.eventName === "PayeeChanged").map((e) => String(e.args.payee).toLowerCase()))].filter((p) => {
    const last = history.data?.find((e) => e.eventName === "PayeeChanged" && String(e.args.payee).toLowerCase() === p);
    return last && Boolean(last.args.allowed);
  });
  const status = !vault.childActive ? <Chip tone="bad">⏸ Child paused</Chip> : expired ? <Chip tone="bad">Ended</Chip> : <Chip tone="good">● Active</Chip>;

  const title = {
    overview: ["🏠 Overview", "Everything about this allowance at a glance."],
    money: ["💵 Money", "Top up, withdraw, and set money aside for school."],
    rules: ["📋 Rules & places", "Where the child can pay and how much. Every change is a new version."],
    school: ["🏫 School billing", "What the school may charge, and the charges waiting for a check."],
    guardian: ["🚦 Guardian", "Who checks school charges for you. It can only say no."],
    history: ["🧾 History", "Every change, payment, refusal and decision, with a public record for each."],
    stop: ["⛔ Pause & stop", "Stop spending or billing within seconds. The money stays safe."],
  }[view];

  return (
    <>
      <div className="dash-title">
        <div>
          <p className="eyebrow">
            Allowance #{vaultId.toString()} · rules v{vault.version.toString()}
          </p>
          <h1>{title[0]}</h1>
          <p>{title[1]}</p>
        </div>
        {status}
      </div>

      {view === "overview" && (
        <>
          {isDemo ? (
            <Guide emoji="🧭" title="Take a look around">
              This is a real allowance on Aevum testnet. Use the menu to see the rules, the school&apos;s billing permission and the full history. The red
              buttons work once you connect a parent wallet.
            </Guide>
          ) : (
            <ParentGuide vault={vault} spent={spent.data} waiting={waiting} go={setView} />
          )}
          <section className="kpis" aria-label="Allowance summary">
            <Kpi emoji="💰" label="Balance" value={fmt(vault.balance)} unit="tUSD8" tone="coral" note={vault.schoolReserve > 0n ? `${fmt(vault.balance - vault.schoolReserve)} the child can spend` : "all of it spendable"} />
            <Kpi emoji="🗓️" label="Spent this week" value={fmt(spent.data)} unit={`/ ${fmt(weekly)}`} tone="sun" meter={weekly > 0n ? Number((used * 100n) / weekly) : 0} note={`max ${fmt(vault.rules.perPaymentLimit)} per payment`} />
            <Kpi emoji="🚌" label="Set aside for school" value={fmt(vault.schoolReserve)} unit="tUSD8" tone="sky" note="only school charges can use it" />
            <Kpi emoji="⏳" label="Waiting for a decision" value={waiting.requests + waiting.charges} tone="mint" note={`${waiting.requests} from the child · ${waiting.charges} from school`} />
          </section>
          <Requests vaultId={vaultId} vault={vault} label={label} />
          <SchoolCharges vaultId={vaultId} vault={vault} label={label} />
          <StoppedCharges vaultId={vaultId} vault={vault} label={label} history={history.data} />
          <div className="cols">
            <section className="card">
              <PanelHead
                title="⚡ Recent activity"
                sub="Straight from the blockchain."
                action={
                  <button type="button" className="btn small ghost" onClick={() => setView("history")}>
                    See all
                  </button>
                }
              />
              <Timeline events={history.data?.slice(0, 7)} label={label} money={money} loading={history.isLoading} error={history.error?.message} />
            </section>
            <section className="card">
              <PanelHead
                title="📋 Rules at a glance"
                action={
                  <button type="button" className="btn small ghost" onClick={() => setView("rules")}>
                    Edit
                  </button>
                }
              />
              <dl className="facts">
                <dt>Per payment</dt>
                <dd>{fmt(vault.rules.perPaymentLimit)} tUSD8</dd>
                <dt>Per week</dt>
                <dd>{fmt(weekly)} tUSD8</dd>
                <dt>Access ends</dt>
                <dd>{dateOf(vault.rules.expiresAt)}</dd>
                <dt>Approved places</dt>
                <dd>{places.length ? places.map((p) => labels.get(p) ?? short(p)).join(", ") : "none yet"}</dd>
                <dt>School billing</dt>
                <dd>{waiting.billings ? `${waiting.billings} active permission${waiting.billings > 1 ? "s" : ""}` : "off"}</dd>
                <dt>Guardian</dt>
                <dd>{vault.guardian === zeroAddress ? "none" : <code>{short(vault.guardian)}</code>}</dd>
                <dt>Child</dt>
                <dd>
                  <code>{short(vault.child)}</code>
                </dd>
              </dl>
            </section>
          </div>
        </>
      )}

      {view === "money" && <Money vaultId={vaultId} vault={vault} />}
      {view === "rules" && <Rules vaultId={vaultId} vault={vault} places={labels} history={history.data} />}
      {view === "school" && (
        <>
          <SchoolCharges vaultId={vaultId} vault={vault} label={label} />
          <StoppedCharges vaultId={vaultId} vault={vault} label={label} history={history.data} />
          <SchoolBilling vaultId={vaultId} vault={vault} label={label} />
        </>
      )}
      {view === "guardian" && <Guardian vaultId={vaultId} vault={vault} />}
      {view === "stop" && <Danger vaultId={vaultId} vault={vault} />}
      {view === "history" && (
        <section className="card">
          <PanelHead title={<>🧾 Everything that happened <Explain term="onChain" label="On Aevum" /></>} />
          <Timeline events={history.data} label={label} money={money} loading={history.isLoading} error={history.error?.message} />
        </section>
      )}
    </>
  );
}

/** The single most useful next step for this allowance, based on what's happening right now. */
function ParentGuide({ vault, spent, waiting, go }: { vault: Vault; spent?: bigint; waiting: ReturnType<typeof useWaiting>; go: (v: ParentView) => void }) {
  if (waiting.requests > 0)
    return <Guide emoji="🙋" title={`Your child is asking for ${waiting.requests === 1 ? "something" : `${waiting.requests} things`}`}>Allow it once, or decline, just below. Nothing is paid until you decide.</Guide>;
  if (waiting.charges > 0)
    return <Guide emoji="🏫" title="A school charge is waiting">It&apos;s just below. It will be paid when its waiting time ends, unless you or the guardian stop it.</Guide>;
  if (!vault.childActive)
    return <Guide emoji="⏸️" title="Your child's spending is paused" action={{ label: "Turn it back on", onClick: () => go("stop") }}>Payments are refused (and recorded) until you turn spending back on.</Guide>;
  if (vault.balance === 0n)
    return <Guide emoji="💵" title="Step 2: top up the allowance" action={{ label: "Add money", onClick: () => go("money") }}>Your child can&apos;t pay anything until there&apos;s money in it.</Guide>;
  if (waiting.billings === 0)
    return <Guide emoji="🏫" title="Optional: let the school bill meals" action={{ label: "Set up school billing", onClick: () => go("school") }}>Choose a limit per charge and per week. Every charge waits a few minutes so it can be stopped.</Guide>;
  if (vault.guardian === zeroAddress)
    return <Guide emoji="🚦" title="Optional: add a guardian" action={{ label: "Add a guardian", onClick: () => go("guardian") }}>A guardian, even an AI one, checks school charges for you. It can only say no.</Guide>;
  return (
    <Guide emoji="🌟" title="All set">
      Your child can pay approved places on their own{spent !== undefined ? ` (${fmt(spent)} of ${fmt(vault.rules.weeklyLimit)} spent this week)` : ""}. Requests and school charges will show up here.
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
  // Wait for the history, so each charge shows who stopped it and the place's name (not a raw address).
  if (history === undefined) return <p className="empty">Loading stopped charges…</p>;

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
  const move = useAction();
  const aside = useAction();
  const [amountText, setAmountText] = useState("1");
  const amount = parseAmount(amountText);
  const [reserveText, setReserveText] = useState(fmt(vault.schoolReserve, 6));
  const reserve = reserveText.trim() === "0" ? 0n : parseAmount(reserveText);
  const tooMuch = amount !== undefined && wallet.data !== undefined && amount > wallet.data;

  async function topUp() {
    if (!amount || !token.address || !rails || !address) return;
    await move.run(async (onSent) => {
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
    <div className="cols even">
      <section id="money" className="card form">
        <PanelHead title="💵 Top up or withdraw" sub="Anyone can add money. Only you can take it out." />
        <dl className="facts">
          <dt>Your wallet</dt>
          <dd>{fmt(wallet.data)} tUSD8</dd>
          <dt>In the allowance</dt>
          <dd>{fmt(vault.balance)} tUSD8</dd>
        </dl>
        <label className="lbl">
          Amount (tUSD8)
          <input className="field" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
          {tooMuch && <span className="field-error">Your wallet doesn&apos;t hold that much tUSD8.</span>}
        </label>
        <div className="actions">
          <button type="button" className="btn" disabled={!amount || move.busy || tooMuch} onClick={topUp}>
            Top up
          </button>
          <button type="button" className="btn secondary" disabled={!amount || move.busy || amount > vault.balance} onClick={() => amount && address && move.run((s) => write("withdraw", [vaultId, amount, address], s))}>
            Withdraw to my wallet
          </button>
        </div>
        <StatusNotice status={move.status} />
      </section>

      <section className="card form">
        <PanelHead
          title={<>🚌 Set aside for school <Explain term="schoolReserve" label="Set aside for school" /></>}
          sub={`Now ${fmt(vault.schoolReserve)} is set aside, so your child can spend ${fmt(vault.balance - vault.schoolReserve)}. School charges can still use it.`}
        />
        <label className="lbl">
          Amount to set aside (tUSD8)
          <input className="field" inputMode="decimal" value={reserveText} onChange={(e) => setReserveText(e.target.value)} />
          {reserve !== undefined && reserve > vault.balance && <span className="field-error">You can&apos;t set aside more than the allowance holds ({fmt(vault.balance)}).</span>}
        </label>
        <div className="actions">
          <button
            type="button"
            className="btn secondary"
            disabled={reserve === undefined || aside.busy || reserve > vault.balance || reserve === vault.schoolReserve}
            onClick={() => reserve !== undefined && aside.run((s) => write("setSchoolReserve", [vaultId, reserve], s))}
          >
            Save amount set aside
          </button>
        </div>
        <StatusNotice status={aside.status} />
      </section>
    </div>
  );
}

function Rules({ vaultId, vault, places, history }: { vaultId: bigint; vault: Vault; places: Map<string, string>; history: ReturnType<typeof useHistory>["data"] }) {
  const write = useRailsWrite();
  const limits = useAction();
  const placeAction = useAction();
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
    <div className="cols even">
      <section className="card form">
        <PanelHead title={<>📏 Limits, version {vault.version.toString()} <Explain term="rules" label="Rules" /></>} sub={`Access ends ${dateOf(vault.rules.expiresAt)}. Saving makes a new version.`} />
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
        {per && week && week < per && <span className="field-error">The weekly limit must be at least the per-payment limit.</span>}
        <div className="actions">
          <button
            type="button"
            className="btn secondary"
            disabled={!per || !week || week < per || limits.busy}
            onClick={() => per && week && limits.run((s) => write("setRules", [vaultId, { perPaymentLimit: per, weeklyLimit: week, expiresAt: nowSec() + days(ttl) }], s))}
          >
            Save as a new version
          </button>
        </div>
        <StatusNotice status={limits.status} />
      </section>

      <section className="card form">
        <PanelHead title={<>📍 Approved places <Explain term="approvedPlace" label="Approved place" /></>} sub="Your child can pay these on their own, inside the limits." />
        <div className="list">
          {current.map((p) => (
            <div key={p.address} className="item">
              <div className="item-main">
                <span className="item-title">{p.label || places.get(p.address.toLowerCase()) || short(p.address)}</span>
                <span className="item-sub mono">{short(p.address)}</span>
              </div>
              <button type="button" className="btn small ghost" disabled={placeAction.busy} onClick={() => placeAction.run((s) => write("setPayee", [vaultId, p.address, false, p.label], s))}>
                Remove
              </button>
            </div>
          ))}
          {current.length === 0 && <p className="fine">No approved places.</p>}
        </div>
        <div className="form-row">
          <label className="lbl">
            Name
            <input className="field text" placeholder="e.g. Book shop" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          </label>
          <label className="lbl">
            Address
            <input className="field" placeholder="0x…" value={newAddr} spellCheck={false} onChange={(e) => setNewAddr(e.target.value.trim())} />
          </label>
        </div>
        <div className="actions">
          <button type="button" className="btn small secondary" disabled={!isAddress(newAddr) || !newLabel.trim() || placeAction.busy} onClick={() => placeAction.run((s) => write("setPayee", [vaultId, newAddr, true, newLabel.trim()], s))}>
            + Approve this place
          </button>
        </div>
        <StatusNotice status={placeAction.status} />
      </section>
    </div>
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
      <PanelHead title={<>📜 Billing permissions <Explain term="billing" label="School billing" /></>} sub="Let the school request charges up to limits you choose. Each charge waits a few minutes so it can be stopped." />
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
        <div className="form grant-form">
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
    <div className="cols">
      <section id="guardian" className="card form">
        <PanelHead title={<>🚦 Your guardian <Explain term="guardian" label="Guardian" /></>} sub="A helper, or an AI agent, that checks school charges and stops the wrong ones." />
        <dl className="facts">
          <dt>Current</dt>
          <dd>{hasGuardian ? <code>{vault.guardian}</code> : "No guardian set"}</dd>
        </dl>
        <label className="lbl">
          {hasGuardian ? "Change to" : "Guardian address"}
          <input className="field" value={g} spellCheck={false} onChange={(e) => setG(e.target.value.trim())} placeholder="0x…" />
        </label>
        <div className="actions">
          <button type="button" className="btn secondary" disabled={!isAddress(g) || busy || sameAddr(g, vault.guardian)} onClick={() => run((s) => write("setGuardian", [vaultId, g], s))}>
            {hasGuardian ? "Change guardian" : "Set guardian"}
          </button>
          {hasGuardian && (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => run((s) => write("setGuardian", [vaultId, zeroAddress], s))}>
              Remove guardian
            </button>
          )}
        </div>
        <StatusNotice status={status} />
      </section>
      <section className="card">
        <PanelHead title="🔐 What a guardian can do" />
        <div className="powers" style={{ gridTemplateColumns: "1fr" }}>
          <div className="power yes">✋ Stop a school charge while it&apos;s waiting</div>
          <div className="power no">✗ Approve anything or pay early</div>
          <div className="power no">✗ Change limits or move money</div>
        </div>
        <p className="fine" style={{ marginTop: 12 }}>If it stops a charge by mistake, you can still pay it from School billing.</p>
      </section>
    </div>
  );
}

function Danger({ vaultId, vault }: { vaultId: bigint; vault: Vault }) {
  const write = useRailsWrite();
  const pause = useAction();
  const all = useAction();
  const [confirmAll, setConfirmAll] = useState(false);
  return (
    <div className="cols even">
      <section id="stop" className="card form">
        <PanelHead
          title={vault.childActive ? "⏸️ Pause your child's spending" : "▶️ Turn spending back on"}
          sub={vault.childActive ? "Their payments are refused (and recorded) until you turn it back on. School billing keeps working." : "Requests and signed payments from before the pause stay cancelled."}
        />
        <div className="actions">
          {vault.childActive ? (
            <button type="button" className="btn warn" disabled={pause.busy} onClick={() => pause.run((s) => write("revokeChild", [vaultId], s))}>
              Pause spending
            </button>
          ) : (
            <button type="button" className="btn secondary" disabled={pause.busy} onClick={() => pause.run((s) => write("setChild", [vaultId, vault.child], s))}>
              Turn spending back on
            </button>
          )}
        </div>
        <StatusNotice status={pause.status} />
      </section>
      <section className="card form">
        <PanelHead title="⛔ Revoke everything" sub="Stops the child, cancels all school billing and every pending request or charge. The money stays in the allowance for you to withdraw." />
        <div className="actions">
          {!confirmAll ? (
            <button type="button" className="btn secondary" disabled={all.busy} onClick={() => setConfirmAll(true)}>
              Revoke everything…
            </button>
          ) : (
            <>
              <button type="button" className="btn warn" disabled={all.busy} onClick={() => (setConfirmAll(false), all.run((s) => write("revokeAll", [vaultId], s)))}>
                Yes, revoke everything
              </button>
              <button type="button" className="btn ghost" onClick={() => setConfirmAll(false)}>
                Cancel
              </button>
            </>
          )}
        </div>
        <StatusNotice status={all.status} />
      </section>
    </div>
  );
}
