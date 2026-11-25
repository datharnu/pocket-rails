"use client";

import { explainReason, memoHash } from "@pocket-rails/sdk";
import { useState } from "react";
import { useAccount } from "wagmi";
import { Explain, Guide } from "@/components/help";
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
  useServerNotes,
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
  if (!isConnected) return <main className="shell"><NeedWallet role="school" emoji="🏫">Use the account the parent gave billing permission to.</NeedWallet></main>;

  return (
    <main className="shell">
      <section className="page-head">
        <div>
          <p className="eyebrow">School</p>
          <h1>🏫 Bill within the parent&apos;s limits.</h1>
          <p className="lede">Each charge waits a few minutes so the family can check it, then it&apos;s paid. Charges over the limits are refused and recorded.</p>
        </div>
      </section>
      {billings.isLoading && <p className="empty">Loading your billing permissions…</p>}
      {!billings.isLoading && mine.length > 0 && (
        <Guide emoji="🍽️" title="Send a charge, then settle it when the wait is over">
          Each charge waits for the family&apos;s check <Explain term="vetoWindow" label="Waiting time" />. When it shows “Settle”, tap it to collect the payment. The billing agent can do both for you automatically.
        </Guide>
      )}
      {!billings.isLoading && mine.length === 0 && (
        <div className="card">
          <h2>No billing permission yet</h2>
          <p className="sub">A parent needs to give this account permission first <Explain term="billing" label="School billing" />. They&apos;ll need this address:</p>
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
  const serverNote = useServerNotes(list.map((c) => c.data.memoHash));

  return (
    <section className="card form" aria-label={`Billing permission ${billingId}`}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <h2>
          💰 Allowance #{b.vaultId.toString()} · permission #{billingId.toString()}
        </h2>
        <span className={`badge ${!live ? "bad" : expired ? "bad" : "good"}`}>{!live ? "Revoked" : expired ? "Expired" : "Active"}</span>
      </div>
      <div className="stats">
        <div className="stat">
          <span className="stat-label">💳 Max per charge</span>
          <span className="stat-value">{fmt(b.maxPerCharge)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">🗓️ Used this period</span>
          <span className="stat-value">
            {fmt(b.periodUsed)} <small>/ {fmt(b.maxPerPeriod)}</small>
          </span>
          <span className="stat-note">period: {Number(b.period) / 86400} days</span>
        </div>
        <div className="stat">
          <span className="stat-label">⏳ Waiting time</span>
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
          <span>
            What&apos;s it for? <span className="hint">(e.g. “Lunch 26 Nov”)</span>
          </span>
          <input className="field text" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <button
        type="button"
        className="btn"
        disabled={!amount || busy}
        onClick={() =>
          amount &&
          (rememberNote(note),
          // Publish the note text so the family's screens and the guardian can read it (only its hash goes on-chain).
          fetch("/api/rails/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: note }) }).catch(() => undefined),
          run((s) => write("requestCharge", [billingId, amount, memoHash(note)], s)))
        }
      >
        Send charge
      </button>
      {b.firstChargeNeedsApproval && !b.hasSettled && <p className="fine">The parent asked to approve the first charge themselves, so it won&apos;t settle on its own.</p>}
      <StatusNotice status={status} />

      <span className="lbl">Your charges</span>
      <div className="list">
        {list.map(({ id, data: c }) => {
          const ready = c.status === 1 && nowSec() >= c.settleAfter;
          const tone = c.status === 4 ? "good" : c.status === 3 || c.status === 5 ? "bad" : "warn";
          return (
            <div key={id.toString()} className="item">
              <div className="item-main">
                <span className="item-title">
                  #{id.toString()} · {fmt(c.amount)} tUSD8 · {serverNote(c.memoHash) ?? noteFor(c.memoHash) ?? "no note"}
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

