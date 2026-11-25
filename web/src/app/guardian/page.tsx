"use client";

import { useMemo, useState } from "react";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";
import { Chip, DashShell, DemoBanner, FailedToggle, Kpi, PanelHead, type NavItem } from "@/components/dash";
import { Explain, Guide } from "@/components/help";
import { NotDeployed, StatusNotice, TxLink } from "@/components/ui";
import { noteFor } from "@/lib/childActions";
import { showcaseVaultId } from "@/lib/env";
import { fmt, nowSec, sameAddr, short, timeLeft, useAllBillings, useAllCharges, useAllVaults, useHistory, useRails, useRailsWrite, useServerNotes } from "@/lib/rails";
import { useAction } from "@/lib/useAction";
import { ReadOnlyContext } from "@/lib/viewMode";
import { useHashView } from "@/lib/useHashView";

const REASONS = ["Duplicate of an earlier charge", "Charged on a weekend or holiday", "Higher than the usual price", "Doesn't match the school's usual pattern"];
type GuardianView = "overview" | "decisions" | "powers";

export default function GuardianPage() {
  const { address, isConnected, status: walletStatus } = useAccount();
  const { rails } = useRails();
  const vaults = useAllVaults();
  const billings = useAllBillings();
  const charges = useAllCharges();
  const [demoPick, setDemoPick] = useState(false);
  const [view, setView] = useHashView<GuardianView>(["overview", "decisions", "powers"], "overview");
  const [picked, setPicked] = useState<bigint | null>(null);
  const isDemo = !isConnected || demoPick;

  const guarded = vaults.items.filter((v) => (isDemo ? v.id === showcaseVaultId : v.data.guardian !== zeroAddress && sameAddr(v.data.guardian, address)));
  const current = guarded.find((v) => v.id === picked) ?? guarded[0];
  const history = useHistory(current?.id);
  const billingIds = new Set(billings.items.filter((b) => b.data.vaultId === current?.id).map((b) => b.id));
  const list = charges.items.filter((c) => billingIds.has(c.data.billingId));
  const open = list.filter((c) => (c.data.status === 1 && nowSec() < c.data.settleAfter) || c.data.status === 2);
  const serverNote = useServerNotes(list.slice(0, 50).map((c) => c.data.memoHash));

  // Who stopped each charge and why, from the ChargeVetoed events.
  const vetoes = useMemo(() => {
    const m = new Map<string, { by: string; reason: string; hash: string }>();
    for (const e of history.data ?? []) if (e.eventName === "ChargeVetoed" && !m.has(String(e.args.chargeId))) m.set(String(e.args.chargeId), { by: String(e.args.by), reason: String(e.args.reason ?? ""), hash: e.txHash });
    return m;
  }, [history.data]);

  if (!rails) return <main className="shell"><NotDeployed /></main>;
  if (walletStatus === "connecting" || walletStatus === "reconnecting") return <main className="shell"><p className="empty">Connecting your wallet…</p></main>;

  const guardianAddr = current?.data.guardian;
  const stoppedByGuardian = list.filter((c) => c.data.status === 3 && sameAddr(vetoes.get(c.id.toString())?.by, guardianAddr)).length;
  const letThrough = list.filter((c) => c.data.status === 4).length;
  const nav: NavItem<GuardianView>[] = [
    { key: "overview", emoji: "🏠", label: "Overview", count: open.length },
    { key: "decisions", emoji: "🧾", label: "Decisions" },
    { key: "powers", emoji: "🔐", label: "What I can do" },
  ];
  const titles: Record<GuardianView, [string, string]> = {
    overview: ["🚦 Overview", "School charges waiting for a check, and what the guardian has decided so far."],
    decisions: ["🧾 Decisions", "Every school charge on this allowance: stopped, waiting or paid, with the reason."],
    powers: ["🔐 What a guardian can do", "Stop a charge while it's waiting. Nothing else, and the contract enforces that."],
  };
  const note = (h: string) => serverNote(h) ?? noteFor(h);

  return (
    <ReadOnlyContext.Provider value={isDemo}>
      <main className="shell wide">
        {isDemo && (
          <DemoBanner
            role="guardian"
            what={<>You&apos;re watching the showcase family&apos;s guardian: an AI agent in a smart account whose key can only call “veto”. It checks every school charge.</>}
          />
        )}
        <DashShell
          title="Guardian"
          emoji="🚦"
          nav={nav}
          view={view}
          onView={setView}
          top={
            guarded.length > 1 ? (
              <label className="dash-picker">
                <span className="fine">Allowance</span>
                <select value={current?.id.toString()} onChange={(e) => setPicked(BigInt(e.target.value))}>
                  {guarded.map((v) => (
                    <option key={v.id.toString()} value={v.id.toString()}>
                      💰 #{v.id.toString()}
                    </option>
                  ))}
                </select>
              </label>
            ) : isDemo && isConnected ? (
              <button type="button" className="btn small secondary" onClick={() => setDemoPick(false)}>
                ← Back to my account
              </button>
            ) : null
          }
          who={{ label: isDemo ? "Showcase guardian" : "You", address: isDemo ? guardianAddr : address, demo: isDemo }}
        >
          <div className="dash-title">
            <div>
              <p className="eyebrow">{current ? `Guarding allowance #${current.id.toString()}` : "Guardian"}</p>
              <h1>{titles[view][0]}</h1>
              <p>{titles[view][1]}</p>
            </div>
            {current && <Chip tone="info">🙅 Can say no, never yes</Chip>}
          </div>

          {vaults.isLoading && <p className="empty">Loading…</p>}
          {!vaults.isLoading && !current && (
            <section className="card">
              <h2>Not a guardian yet</h2>
              <p className="sub">
                A parent needs to choose this account as their guardian <Explain term="guardian" label="Guardian" />. They&apos;ll need this address:
              </p>
              <code className="mono" style={{ overflowWrap: "anywhere" }}>
                {address}
              </code>
              <div className="actions" style={{ marginTop: 12 }}>
                <button type="button" className="btn small secondary" onClick={() => setDemoPick(true)}>
                  Watch the showcase guardian instead
                </button>
              </div>
            </section>
          )}

          {current && view === "overview" && (
            <>
              {!isDemo && (
                <Guide emoji="🤖" title="Tip: let the guardian agent do this automatically">
                  The guardian agent checks every charge for doubles, weekend charges and unusual prices, and asks an AI to read the note. It can only ever stop charges.
                </Guide>
              )}
              <section className="kpis" aria-label="Guardian summary">
                <Kpi emoji="🔎" label="Charges checked" value={list.length} tone="sky" note="school charges on this allowance" />
                <Kpi emoji="✋" label="Stopped by the guardian" value={stoppedByGuardian} tone="coral" note="no money moved" />
                <Kpi emoji="✅" label="Let through" value={letThrough} tone="mint" note="paid after the waiting time" />
                <Kpi emoji="⏳" label="Waiting now" value={open.length} tone="sun" note="can still be stopped" />
              </section>
              <Queue rows={open} note={note} />
              <section className="card">
                <PanelHead
                  title="🧾 Latest decisions"
                  action={
                    <button type="button" className="btn small ghost" onClick={() => setView("decisions")}>
                      See all
                    </button>
                  }
                />
                <Decisions rows={list} limit={6} note={note} vetoes={vetoes} guardian={guardianAddr} parent={current.data.parent} />
              </section>
            </>
          )}
          {current && view === "decisions" && (
            <section className="card">
              <Decisions rows={list} note={note} vetoes={vetoes} guardian={guardianAddr} parent={current.data.parent} />
            </section>
          )}
          {current && view === "powers" && <Powers guardian={guardianAddr} />}
        </DashShell>
      </main>
    </ReadOnlyContext.Provider>
  );
}

type Row = { id: bigint; data: { amount: bigint; memoHash: `0x${string}`; settleAfter: bigint; status: number } };

function Queue({ rows, note }: { rows: Row[]; note: (h: string) => string | undefined }) {
  const write = useRailsWrite();
  const { status, run, busy } = useAction();
  const [reason, setReason] = useState(REASONS[0]!);
  return (
    <section className="card">
      <PanelHead
        title="⏳ Waiting for a check"
        sub="Stop a charge that looks wrong before its waiting time ends. The parent sees your reason, and can still pay it if you got it wrong."
      />
      {rows.length > 0 && (
        <label className="lbl" style={{ maxWidth: 420, marginBottom: 8 }}>
          Reason the parent will see
          <select className="field" value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      )}
      <div className="list">
        {rows.map(({ id, data: c }) => (
          <div key={id.toString()} className="item">
            <div className="item-main">
              <span className="item-title">
                {fmt(c.amount)} tUSD8 · “{note(c.memoHash) ?? "no note"}”
              </span>
              <span className="item-sub">
                Charge #{id.toString()} · {c.status === 2 ? "waiting for the parent" : `pays in ${timeLeft(c.settleAfter)} unless stopped`}
              </span>
            </div>
            <button type="button" className="btn small warn" disabled={busy} onClick={() => run((s) => write("vetoCharge", [id, reason], s))}>
              Stop it
            </button>
          </div>
        ))}
        {rows.length === 0 && <p className="empty">Nothing waiting right now. 🎉 New school charges show up here within seconds.</p>}
      </div>
      <StatusNotice status={status} />
    </section>
  );
}

function Decisions({
  rows,
  limit = 50,
  note,
  vetoes,
  guardian,
  parent,
}: {
  rows: Row[];
  limit?: number;
  note: (h: string) => string | undefined;
  vetoes: Map<string, { by: string; reason: string; hash: string }>;
  guardian?: string;
  parent: string;
}) {
  const [showFailed, setShowFailed] = useState(false);
  const failedCount = rows.filter((r) => r.data.status === 5).length;
  const shown = (showFailed ? rows : rows.filter((r) => r.data.status !== 5)).slice(0, limit);
  if (rows.length === 0) return <p className="empty">No school charges yet.</p>;
  return (
    <>
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Charge</th>
            <th>Amount</th>
            <th>School&apos;s note</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(({ id, data: c }) => {
            const v = vetoes.get(id.toString());
            const by = v ? (sameAddr(v.by, guardian) ? "guardian" : sameAddr(v.by, parent) ? "parent" : short(v.by)) : "guardian";
            return (
              <tr key={id.toString()}>
                <td className="mono">#{id.toString()}</td>
                <td className="num">{fmt(c.amount)} tUSD8</td>
                <td className="note">{note(c.memoHash) ?? <span className="fine">no note</span>}</td>
                <td>
                  {c.status === 3 ? (
                    <>
                      <Chip tone="bad">✋ Stopped by the {by}</Chip>
                      {v?.reason && <span className="why">“{v.reason}”</span>}
                      {v && (
                        <span className="why">
                          <TxLink hash={v.hash} label="See the veto" />
                        </span>
                      )}
                    </>
                  ) : c.status === 4 ? (
                    <Chip tone="good">✓ Let through, paid</Chip>
                  ) : c.status === 2 ? (
                    <Chip tone="warn">Waiting for parent</Chip>
                  ) : c.status === 1 && nowSec() < c.settleAfter ? (
                    <Chip tone="warn">⏳ Checking · {timeLeft(c.settleAfter)}</Chip>
                  ) : c.status === 1 ? (
                    <Chip tone="info">Let through, not collected yet</Chip>
                  ) : (
                    <Chip tone="plain">Couldn&apos;t be paid</Chip>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <FailedToggle count={failedCount} shown={showFailed} onToggle={() => setShowFailed((x) => !x)} />
    </>
  );
}


function Powers({ guardian }: { guardian?: string }) {
  return (
    <>
      <section className="card">
        <PanelHead title="✅ Allowed" />
        <div className="powers">
          <div className="power yes">✋ Stop a school charge while it&apos;s waiting, with a reason the parent sees</div>
        </div>
      </section>
      <section className="card">
        <PanelHead title="🚫 Not allowed, ever" sub="The contract refuses these from a guardian, whatever its software says." />
        <div className="powers">
          <div className="power no">✗ Approve a charge or pay it early</div>
          <div className="power no">✗ Raise a limit or change the rules</div>
          <div className="power no">✗ Move or withdraw money</div>
          <div className="power no">✗ Undo a parent&apos;s decision</div>
        </div>
      </section>
      <section className="card info">
        <PanelHead title="🤖 How the showcase guardian works" />
        <p>
          It&apos;s an AI agent that runs in a smart account{guardian ? <> (<code>{short(guardian)}</code>)</> : null}. Its key is a session key that can only call
          “veto” on Pocket Rails, so even a tricked or broken AI can only say no. First it checks simple rules (doubles, weekends, unusual prices), then an AI
          reads the school&apos;s note. In our test of 50 cases, it stopped every bad charge and never stopped a good one.
        </p>
      </section>
    </>
  );
}
