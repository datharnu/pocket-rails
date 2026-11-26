"use client";

import { explainReason, memoHash } from "@pocket-rails/sdk";
import { useState } from "react";
import { useAccount } from "wagmi";
import { Chip, DashShell, DemoBanner, FailedToggle, Kpi, PanelHead, type NavItem } from "@/components/dash";
import { Explain, Guide } from "@/components/help";
import { NotDeployed, StatusNotice } from "@/components/ui";
import { rememberNote, noteFor } from "@/lib/childActions";
import { showcaseVaultId } from "@/lib/env";
import {
  dateOf,
  fmt,
  nowSec,
  parseAmount,
  sameAddr,
  short,
  timeLeft,
  useAllBillings,
  useAllCharges,
  useAllVaults,
  useHeldCheck,
  useRails,
  useRailsWrite,
  useServerNotes,
  type Billing,
  type Charge,
} from "@/lib/rails";
import { useAction } from "@/lib/useAction";
import { ReadOnlyContext } from "@/lib/viewMode";
import { useHashView } from "@/lib/useHashView";

type SchoolView = "overview" | "send" | "charges" | "permissions";
type Row = { id: bigint; data: Charge };

export default function SchoolPage() {
  const { address, isConnected, status: walletStatus } = useAccount();
  const { rails } = useRails();
  const billings = useAllBillings();
  const vaults = useAllVaults();
  const charges = useAllCharges();
  const [demoPick, setDemoPick] = useState(false);
  const [view, setView] = useHashView<SchoolView>(["overview", "send", "charges", "permissions"], "overview");
  const isDemo = !isConnected || demoPick;
  const mine = billings.items.filter((b) => (isDemo ? b.data.vaultId === showcaseVaultId : sameAddr(b.data.biller, address)));
  const epochOf = new Map(vaults.items.map((v) => [v.id, v.data.billingEpoch]));
  const isLive = (b: Billing) => !b.revoked && epochOf.get(b.vaultId) === b.epoch && nowSec() < b.expiresAt;
  const ids = new Set(mine.map((b) => b.id));
  const list = charges.items.filter((c) => ids.has(c.data.billingId));
  // Charges the parent chose to hold until their guardian comes online and checks them.
  const heldCheck = useHeldCheck(vaults.items);
  const billingById = new Map(billings.items.map((b) => [b.id, b.data]));
  const held = new Set(list.filter((c) => billingById.has(c.data.billingId) && heldCheck(c.data, billingById.get(c.data.billingId)!)).map((c) => c.id));
  const ready = list.filter((c) => c.data.status === 1 && nowSec() >= c.data.settleAfter && !held.has(c.id));
  const waiting = list.filter((c) => c.data.status === 1 || c.data.status === 2);

  if (!rails) return <main className="shell"><NotDeployed /></main>;
  if (walletStatus === "connecting" || walletStatus === "reconnecting") return <main className="shell"><p className="empty">Connecting your wallet…</p></main>;

  const nav: NavItem<SchoolView>[] = [
    { key: "overview", emoji: "🏠", label: "Overview", count: ready.length },
    { key: "send", emoji: "🍽️", label: "Send a charge" },
    { key: "charges", emoji: "🧾", label: "Charges", count: waiting.length },
    { key: "permissions", emoji: "📜", label: "Permissions" },
  ];
  const titles: Record<SchoolView, [string, string]> = {
    overview: ["🏠 Overview", "What you've billed, what's waiting, and what's ready to collect."],
    send: ["🍽️ Send a charge", "Each charge waits a few minutes so the family can check it, then you collect it."],
    charges: ["🧾 Charges", "Every charge you've sent, and what happened to it."],
    permissions: ["📜 Permissions", "What each family allows you to charge, and until when."],
  };
  const paid = list.filter((c) => c.data.status === 4);
  const settled = paid.reduce((s, c) => s + c.data.amount, 0n);
  const stopped = list.filter((c) => c.data.status === 3).length;

  return (
    <ReadOnlyContext.Provider value={isDemo}>
      <main className="shell wide">
        {isDemo && (
          <DemoBanner
            role="school"
            what={<>You&apos;re seeing what the school sees for the showcase family (allowance #{showcaseVaultId.toString()}). Its billing agent sends one lunch charge per school day.</>}
          />
        )}
        <DashShell
          title="School"
          emoji="🏫"
          nav={nav}
          view={view}
          onView={setView}
          top={
            isDemo && isConnected ? (
              <button type="button" className="btn small secondary" onClick={() => setDemoPick(false)}>
                ← Back to my account
              </button>
            ) : null
          }
          who={{ label: isDemo ? "Showcase school" : "You", address: isDemo ? mine[0]?.data.biller : address, demo: isDemo }}
        >
          <div className="dash-title">
            <div>
              <p className="eyebrow">School billing</p>
              <h1>{titles[view][0]}</h1>
              <p>{titles[view][1]}</p>
            </div>
          </div>

          {billings.isLoading && <p className="empty">Loading billing permissions…</p>}
          {!billings.isLoading && mine.length === 0 && (
            <section className="card">
              <h2>No billing permission yet</h2>
              <p className="sub">
                A parent needs to give this account permission first <Explain term="billing" label="School billing" />. They&apos;ll need this address:
              </p>
              <code className="mono" style={{ overflowWrap: "anywhere" }}>
                {address}
              </code>
              <div className="actions" style={{ marginTop: 12 }}>
                <button type="button" className="btn small secondary" onClick={() => setDemoPick(true)}>
                  Look at the showcase school instead
                </button>
              </div>
            </section>
          )}

          {mine.length > 0 && view === "overview" && (
            <>
              {!isDemo && (
                <Guide emoji="🍽️" title="Send a charge, then collect it when the wait is over">
                  Each charge waits for the family&apos;s check <Explain term="vetoWindow" label="Waiting time" />. The billing agent can do both for you automatically.
                </Guide>
              )}
              <section className="kpis" aria-label="Billing summary">
                <Kpi emoji="📜" label="Active permissions" value={mine.filter((b) => isLive(b.data)).length} tone="coral" note={`${mine.length} in total`} />
                <Kpi emoji="✅" label="Collected" value={fmt(settled)} unit="tUSD8" tone="mint" note={`${paid.length} charges paid`} />
                <Kpi emoji="⏳" label="Waiting" value={waiting.length} tone="sun" note={`${ready.length} ready to collect`} />
                <Kpi emoji="✋" label="Stopped" value={stopped} tone="sky" note="vetoed by the parent or guardian" />
              </section>
              {ready.length > 0 && <ReadyToCollect rows={ready} />}
              <section className="card">
                <PanelHead
                  title="🧾 Latest charges"
                  action={
                    <button type="button" className="btn small ghost" onClick={() => setView("charges")}>
                      See all
                    </button>
                  }
                />
                <ChargeTable held={held} rows={list} billings={mine} limit={6} />
              </section>
            </>
          )}
          {mine.length > 0 && view === "send" && <SendCharge permissions={mine.filter((b) => isLive(b.data))} />}
          {mine.length > 0 && view === "charges" && (
            <section className="card">
              <ChargeTable held={held} rows={list} billings={mine} />
              <p className="fine" style={{ marginTop: 12 }}>
                Over-cap charges aren&apos;t errors: they&apos;re recorded as refusals ({explainReason(9).message.toLowerCase()}) with a transaction you can show.
              </p>
            </section>
          )}
          {mine.length > 0 && view === "permissions" && mine.map((b) => <PermissionCard key={b.id.toString()} id={b.id} b={b.data} live={isLive(b.data)} />)}
        </DashShell>
      </main>
    </ReadOnlyContext.Provider>
  );
}

function statusChip(c: Charge, held = false) {
  if (c.status === 4) return <Chip tone="good">✓ Paid</Chip>;
  if (c.status === 3) return <Chip tone="bad">✋ Stopped</Chip>;
  if (c.status === 5) return <Chip tone="plain">Couldn&apos;t be paid</Chip>;
  if (c.status === 2) return <Chip tone="warn">Waiting for parent</Chip>;
  if (held) return <Chip tone="warn">⏸️ On hold: family&apos;s guardian is offline</Chip>;
  if (nowSec() >= c.settleAfter) return <Chip tone="info">Ready to collect</Chip>;
  return <Chip tone="warn">⏳ {timeLeft(c.settleAfter)} left</Chip>;
}

function ChargeTable({ rows, billings, held, limit = 50 }: { rows: Row[]; billings: { id: bigint; data: Billing }[]; held?: Set<bigint>; limit?: number }) {
  const write = useRailsWrite();
  const { status, run, busy } = useAction();
  const serverNote = useServerNotes(rows.map((c) => c.data.memoHash));
  const vaultOf = new Map(billings.map((b) => [b.id, b.data.vaultId]));
  const [showFailed, setShowFailed] = useState(false);
  const failedCount = rows.filter((r) => r.data.status === 5).length;
  const shown = (showFailed ? rows : rows.filter((r) => r.data.status !== 5)).slice(0, limit);
  if (rows.length === 0) return <p className="empty">No charges yet.</p>;
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Charge</th>
              <th>Allowance</th>
              <th>Amount</th>
              <th>Note</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ id, data: c }) => {
              const isHeld = held?.has(id) ?? false;
              const ready = c.status === 1 && nowSec() >= c.settleAfter && !isHeld;
              return (
                <tr key={id.toString()}>
                  <td className="mono">#{id.toString()}</td>
                  <td>💰 #{vaultOf.get(c.billingId)?.toString()}</td>
                  <td className="num">{fmt(c.amount)} tUSD8</td>
                  <td className="note">{serverNote(c.memoHash) ?? noteFor(c.memoHash) ?? <span className="fine">no note</span>}</td>
                  <td>
                    {ready ? (
                      <button type="button" className="btn small" disabled={busy} onClick={() => run((s) => write("settle", [id], s))}>
                        Collect
                      </button>
                    ) : (
                      statusChip(c, isHeld)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <FailedToggle count={failedCount} shown={showFailed} onToggle={() => setShowFailed((x) => !x)} />
      <StatusNotice status={status} />
    </>
  );
}

function ReadyToCollect({ rows }: { rows: Row[] }) {
  const write = useRailsWrite();
  const { status, run, busy } = useAction();
  const first = rows[0]!;
  return (
    <section className="card info">
      <PanelHead
        title={`💸 ${rows.length} charge${rows.length > 1 ? "s" : ""} ready to collect`}
        sub="Nobody stopped them during the waiting time, so you can collect the payment now."
        action={
          <button type="button" className="btn small" disabled={busy} onClick={() => run((s) => write("settle", [first.id], s))}>
            Collect #{first.id.toString()}
          </button>
        }
      />
      <StatusNotice status={status} />
    </section>
  );
}

function SendCharge({ permissions }: { permissions: { id: bigint; data: Billing }[] }) {
  const write = useRailsWrite();
  const { status, run, busy } = useAction();
  const [pick, setPick] = useState<string>(permissions[0]?.id.toString() ?? "");
  const [amountText, setAmountText] = useState("0.1");
  const [note, setNote] = useState("Lunch");
  const amount = parseAmount(amountText);
  const chosen = permissions.find((p) => p.id.toString() === pick) ?? permissions[0];
  if (!chosen) return <p className="empty">No active permission to charge.</p>;
  const b = chosen.data;
  const over = amount !== undefined && amount > b.maxPerCharge;

  return (
    <div className="cols">
      <section className="card form">
        <PanelHead title="🍽️ New charge" />
        {permissions.length > 1 && (
          <label className="lbl">
            Family
            <select className="field" value={pick} onChange={(e) => setPick(e.target.value)}>
              {permissions.map((p) => (
                <option key={p.id.toString()} value={p.id.toString()}>
                  Allowance #{p.data.vaultId.toString()} · permission #{p.id.toString()}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="form-row">
          <label className="lbl">
            Amount (tUSD8)
            <input className="field" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
          </label>
          <label className="lbl">
            <span>
              What&apos;s it for? <span className="hint">(e.g. “Lunch 26 Nov”)</span>
            </span>
            <input className="field text" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        {over && <p className="preview bad">✗ Above the {fmt(b.maxPerCharge)} per-charge limit. It would be refused and recorded.</p>}
        <button
          type="button"
          className="btn big"
          disabled={!amount || busy}
          onClick={() =>
            amount &&
            (rememberNote(note),
            // Publish the note text so the family's screens and the guardian can read it (only its hash goes on-chain).
            fetch("/api/rails/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: note }) }).catch(() => undefined),
            run((s) => write("requestCharge", [chosen.id, amount, memoHash(note)], s)))
          }
        >
          Send charge
        </button>
        {b.firstChargeNeedsApproval && !b.hasSettled && <p className="fine">The parent asked to approve the first charge themselves, so it won&apos;t settle on its own.</p>}
        <StatusNotice status={status} />
      </section>
      <section className="card">
        <PanelHead title="📏 This family's limits" />
        <dl className="facts">
          <dt>Per charge</dt>
          <dd>{fmt(b.maxPerCharge)} tUSD8</dd>
          <dt>This period</dt>
          <dd>
            {fmt(b.periodUsed)} of {fmt(b.maxPerPeriod)} used
          </dd>
          <dt>Waiting time</dt>
          <dd>{Number(b.vetoWindow) / 60} min</dd>
          <dt>Ends</dt>
          <dd>{dateOf(b.expiresAt)}</dd>
        </dl>
        <span className="meter" style={{ marginTop: 14 }} aria-hidden="true">
          <span style={{ width: `${b.maxPerPeriod > 0n ? Number((b.periodUsed * 100n) / b.maxPerPeriod) : 0}%` }} />
        </span>
      </section>
    </div>
  );
}

function PermissionCard({ id, b, live }: { id: bigint; b: Billing; live: boolean }) {
  return (
    <section className="card" aria-label={`Billing permission ${id}`}>
      <PanelHead
        title={`📜 Allowance #${b.vaultId.toString()} · permission #${id.toString()}`}
        sub={
          <>
            Pays to <code>{short(b.payTo)}</code> · charges sent by <code>{short(b.biller)}</code>
          </>
        }
        action={live ? <Chip tone="good">● Active</Chip> : <Chip tone="bad">{b.revoked ? "Revoked" : "Ended"}</Chip>}
      />
      <div className="kpis">
        <Kpi emoji="💳" label="Max per charge" value={fmt(b.maxPerCharge)} unit="tUSD8" tone="coral" />
        <Kpi
          emoji="🗓️"
          label="Used this period"
          value={fmt(b.periodUsed)}
          unit={`/ ${fmt(b.maxPerPeriod)}`}
          tone="sun"
          meter={b.maxPerPeriod > 0n ? Number((b.periodUsed * 100n) / b.maxPerPeriod) : 0}
          note={`period: ${Number(b.period) / 86400} days`}
        />
        <Kpi emoji="⏳" label="Waiting time" value={Number(b.vetoWindow) / 60} unit="min" tone="sky" note={`until ${dateOf(b.expiresAt)}`} />
      </div>
    </section>
  );
}
