"use client";

import { useState } from "react";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";
import { Explain, Guide } from "@/components/help";
import { NeedWallet, NotDeployed, StatusNotice } from "@/components/ui";
import { noteFor } from "@/lib/childActions";
import { fmt, nowSec, sameAddr, short, timeLeft, useAllBillings, useAllCharges, useAllVaults, useRails, useRailsWrite, useServerNotes } from "@/lib/rails";
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
  const serverNote = useServerNotes(charges.items.map((c) => c.data.memoHash));

  if (!rails) return <main className="shell"><NotDeployed /></main>;
  if (!isConnected) return <main className="shell"><NeedWallet role="guardian" emoji="🛡️">A guardian can only stop school charges. It can&apos;t approve anything or move money.</NeedWallet></main>;

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
          <h1>🛡️ Check school charges.</h1>
          <p className="lede">Stop a charge that looks wrong while it&apos;s still waiting. That&apos;s all a guardian can do: no approving, no raising limits, no moving money. If you stop one by mistake, the parent can undo it.</p>
        </div>
      </section>
      {guarded.size === 0 && !vaults.isLoading && (
        <div className="card">
          <h2>Not a guardian yet</h2>
          <p className="sub">A parent needs to choose this account as their guardian <Explain term="guardian" label="Guardian" />. They&apos;ll need this address:</p>
          <code className="mono">{address}</code>
        </div>
      )}
      {guarded.size > 0 && (
        <Guide emoji="🤖" title="Tip: let the guardian agent do this automatically">
          The guardian agent checks every charge for doubles, weekend charges and unusual prices, and can ask an AI to read the note. It can only ever stop charges.
        </Guide>
      )}
      {guarded.size > 0 && (
        <section className="card form">
          <h2>⏳ Charges you can stop</h2>
          <label className="lbl">
            Reason the parent will see
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
                    💰 Allowance #{billingVault.get(c.billingId)?.toString()} · {fmt(c.amount)} tUSD8
                  </span>
                  <span className="item-sub">
                    Charge #{id.toString()} · “{serverNote(c.memoHash) ?? noteFor(c.memoHash) ?? `no note (${short(c.memoHash)})`}” ·{" "}
                    {c.status === 2 ? "waiting for the parent" : `settles in ${timeLeft(c.settleAfter)}`}
                  </span>
                </div>
                <button type="button" className="btn small warn" disabled={busy} onClick={() => run((s) => write("vetoCharge", [id, reason], s))}>
                  Stop it
                </button>
              </div>
            ))}
            {open.length === 0 && <p className="fine">Nothing to check right now. 🎉</p>}
          </div>
          <StatusNotice status={status} />
        </section>
      )}
    </main>
  );
}
