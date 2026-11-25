"use client";

import { explainReason, memoHash } from "@pocket-rails/sdk";
import { useState } from "react";
import { useAccount } from "wagmi";
import { NeedWallet, NotDeployed, StatusNotice } from "@/components/ui";
import { rememberNote, noteFor } from "@/lib/childActions";
import {
  ChargeStatus,
  dateOf,
  fmt,
  nowSec,
  parseAmount,
  sameAddr,
  timeLeft,
  useAllBillings,
  useAllCharges,
  useAllVaults,
  useRails,
  useRailsWrite,
  type Billing,
} from "@/lib/rails";
import { useAction } from "@/lib/useAction";

export default function SchoolPage() {
  const { address, isConnected } = useAccount();
  const { rails } = useRails();
  const billings = useAllBillings();
  const vaults = useAllVaults();
  const mine = billings.items.filter((b) => sameAddr(b.data.biller, address));
  const epochOf = new Map(vaults.items.map((v) => [v.id, v.data.billingEpoch]));

  if (!rails) return <main className="shell"><NotDeployed /></main>;
  if (!isConnected) return <main className="shell"><NeedWallet role="school billing">Use the account the parent granted billing to.</NeedWallet></main>;

  return (
    <main className="shell">
      <section className="page-head">
        <div>
          <p className="eyebrow">School</p>
          <h1>Bill inside the parent&apos;s caps.</h1>
          <p className="lede">Each charge waits out the parent&apos;s veto window, then anyone can settle it. Charges over the caps are refused and recorded.</p>
        </div>
      </section>
      {billings.isLoading && <p className="empty">Reading billing permissions…</p>}
      {!billings.isLoading && mine.length === 0 && (
        <div className="card">
          <h2>No billing permissions for this account</h2>
          <p className="sub">A parent grants one from the Parent view, using this address as the school billing key:</p>
          <code className="mono" style={{ overflowWrap: "anywhere" }}>{address}</code>
        </div>
      )}
      {mine.map((b) => (
        <BillingCard key={b.id.toString()} billingId={b.id} b={b.data} live={!b.data.revoked && epochOf.get(b.data.vaultId) === b.data.epoch} />
      ))}
    </main>
  );
}

function BillingCard({ billingId, b, live }: { billingId: bigint; b: Billing; live: boolean }) {
  const charges = useAllCharges();
  const write = useRailsWrite();
  const { status, run, busy } = useAction();
  const [amountText, setAmountText] = useState("0.3");
  const [note, setNote] = useState("Lunch");
  const amount = parseAmount(amountText);
  const expired = nowSec() >= b.expiresAt;
  const list = charges.items.filter((c) => c.data.billingId === billingId).slice(0, 12);

  return (
    <section className="card form" aria-label={`Billing permission ${billingId}`}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <h2>
          Vault #{b.vaultId.toString()} · permission #{billingId.toString()}
        </h2>
        <span className={`badge ${!live ? "bad" : expired ? "bad" : "good"}`}>{!live ? "Revoked" : expired ? "Expired" : "Active"}</span>
      </div>
      <div className="stats">
        <div className="stat">
          <span className="stat-label">Per charge</span>
          <span className="stat-value">{fmt(b.maxPerCharge)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">This period</span>
          <span className="stat-value">
            {fmt(b.periodUsed)} <small>/ {fmt(b.maxPerPeriod)}</small>
          </span>
          <span className="stat-note">period: {Number(b.period) / 86400} days</span>
        </div>
        <div className="stat">
          <span className="stat-label">Veto window</span>
          <span className="stat-value">{Number(b.vetoWindow) / 60} min</span>
          <span className="stat-note">until {dateOf(b.expiresAt)}</span>
        </div>
      </div>

      <div className="form-row">
        <label className="lbl">
          Amount (tUSD8)
          <input className="field" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
        </label>
        <label className="lbl">
          Note <span className="hint">(only a fingerprint goes on-chain)</span>
          <input className="field text" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <button
        type="button"
        className="btn"
        disabled={!amount || busy}
        onClick={() => amount && (rememberNote(note), run((s) => write("requestCharge", [billingId, amount, memoHash(note)], s)))}
      >
        Send charge
      </button>
      {b.firstChargeNeedsApproval && !b.hasSettled && <p className="fine">The parent asked to approve the first charge themselves, so it won&apos;t settle on its own.</p>}
      <StatusNotice status={status} />

      <span className="lbl">Charges</span>
      <div className="list">
        {list.map(({ id, data: c }) => {
          const ready = c.status === 1 && nowSec() >= c.settleAfter;
          const tone = c.status === 4 ? "good" : c.status === 3 || c.status === 5 ? "bad" : "warn";
          return (
            <div key={id.toString()} className="item">
              <div className="item-main">
                <span className="item-title">
                  #{id.toString()} · {fmt(c.amount)} tUSD8 · {noteFor(c.memoHash) ?? "note not on this device"}
                </span>
                <span className="item-sub">
                  {c.status === 1 && !ready && `Settles in ${timeLeft(c.settleAfter)} unless vetoed`}
                  {c.status === 1 && ready && "Veto window over"}
                  {c.status === 2 && "Waiting for the parent's approval"}
                </span>
              </div>
              {ready ? (
                <button type="button" className="btn small" disabled={busy} onClick={() => run((s) => write("settle", [id], s))}>
                  Settle
                </button>
              ) : (
                <span className={`badge ${tone}`}>{ChargeStatus[c.status]}</span>
              )}
            </div>
          );
        })}
        {list.length === 0 && <p className="fine">No charges yet.</p>}
      </div>
      <p className="fine">
        Over-cap charges aren&apos;t errors: they&apos;re recorded as refusals ({explainReason(9).message.toLowerCase()}) with a transaction you can show.
      </p>
    </section>
  );
}

