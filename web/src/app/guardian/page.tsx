"use client";

import { useState } from "react";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";
import { NeedWallet, NotDeployed, StatusNotice } from "@/components/ui";
import { noteFor } from "@/lib/childActions";
import { fmt, nowSec, sameAddr, short, timeLeft, useAllBillings, useAllCharges, useAllVaults, useRails, useRailsWrite } from "@/lib/rails";
import { useAction } from "@/lib/useAction";

const REASONS = ["Duplicate of an earlier charge", "Charged on a weekend or holiday", "Higher than the usual price", "Doesn't match the school's usual pattern"];

export default function GuardianPage() {
  const { address, isConnected } = useAccount();
  const { rails } = useRails();
  const vaults = useAllVaults();
  const billings = useAllBillings();
  const charges = useAllCharges();
  const write = useRailsWrite();
  const { status, run, busy } = useAction();
  const [reason, setReason] = useState(REASONS[0]!);

  if (!rails) return <main className="shell"><NotDeployed /></main>;
  if (!isConnected) return <main className="shell"><NeedWallet role="guardian">The guardian key can only veto school charges. It can&apos;t approve anything or move money.</NeedWallet></main>;

  const guarded = new Map(vaults.items.filter((v) => v.data.guardian !== zeroAddress && sameAddr(v.data.guardian, address)).map((v) => [v.id, v.data]));
  const billingVault = new Map(billings.items.map((b) => [b.id, b.data.vaultId]));
  const open = charges.items.filter((c) => {
    const vid = billingVault.get(c.data.billingId);
    return vid !== undefined && guarded.has(vid) && ((c.data.status === 1 && nowSec() < c.data.settleAfter) || c.data.status === 2);
  });

  return (
    <main className="shell">
      <section className="page-head">
        <div>
          <p className="eyebrow">Guardian</p>
          <h1>Review school charges.</h1>
          <p className="lede">You can veto a charge while its window is open. That&apos;s all this key can do: it can&apos;t approve, raise a limit or move money. A wrong veto is undone by the parent in one click.</p>
        </div>
      </section>
      {guarded.size === 0 && !vaults.isLoading && (
        <div className="card">
          <h2>No vaults use this account as guardian</h2>
          <p className="sub">A parent sets the guardian in the Parent view using this address:</p>
          <code className="mono">{address}</code>
        </div>
      )}
      {guarded.size > 0 && (
        <section className="card form">
          <h2>Charges you can veto</h2>
          <label className="lbl">
            Reason shown to the parent
            <select className="field" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <div className="list">
            {open.map(({ id, data: c }) => (
              <div key={id.toString()} className="item">
                <div className="item-main">
                  <span className="item-title">
                    Vault #{billingVault.get(c.billingId)?.toString()} · {fmt(c.amount)} tUSD8
                  </span>
                  <span className="item-sub">
                    Charge #{id.toString()} · {noteFor(c.memoHash) ?? `memo ${short(c.memoHash)}`} ·{" "}
                    {c.status === 2 ? "waiting for the parent" : `settles in ${timeLeft(c.settleAfter)}`}
                  </span>
                </div>
                <button type="button" className="btn small warn" disabled={busy} onClick={() => run((s) => write("vetoCharge", [id, reason], s))}>
                  Veto
                </button>
              </div>
            ))}
            {open.length === 0 && <p className="fine">Nothing to review right now.</p>}
          </div>
          <StatusNotice status={status} />
        </section>
      )}
    </main>
  );
}
