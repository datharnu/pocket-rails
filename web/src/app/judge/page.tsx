"use client";

import { addressUrl } from "@aevum-kit/aevum";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { Hash } from "viem";
import { Explain } from "@/components/help";
import { NotDeployed, TxLink } from "@/components/ui";
import { repoUrl } from "@/lib/env";
import { ChargeStatus, fmt, nowSec, short, timeLeft, useAllBillings, useAllCharges, useAllVaults, useHistory, useRails, useServerNotes } from "@/lib/rails";

type DemoInfo = {
  enabled: boolean;
  billingId?: string;
  vaultId?: string;
  guardian?: string;
  price?: string;
  simulated?: { chargeId: string; kind: string; hash: string; at: string }[];
};

const SCENARIOS = [
  {
    kind: "duplicate",
    emoji: "👯",
    title: "Send a duplicate charge",
    what: "The school bills the latest lunch again.",
    expect: "The guardian agent vetoes it (rule: same note already charged). No money moves.",
  },
  {
    kind: "trick",
    emoji: "🪤",
    title: "Send a trick note",
    what: "The charge note tells the guardian's AI to approve it.",
    expect: "The guardian's AI review spots the instruction and vetoes. It can say no, never yes.",
  },
  {
    kind: "overcap",
    emoji: "📈",
    title: "Send an over-cap charge",
    what: "The school asks for more than the parent allows per charge.",
    expect: "The contract refuses it straight away and records why. Nothing is pending.",
  },
] as const;

type Run =
  | { state: "idle" }
  | { state: "sending"; kind: string }
  | { state: "sent"; kind: string; hash: Hash; chargeId: bigint; refused: boolean; message: string; startedAt: number }
  | { state: "error"; kind: string; text: string };

export default function JudgePage() {
  const { rails, net } = useRails();
  const info = useQuery({
    queryKey: ["demo-info"],
    refetchInterval: 10_000,
    queryFn: async () => (await (await fetch("/api/demo/scenario")).json()) as DemoInfo,
  });
  const vaultId = info.data?.vaultId ? BigInt(info.data.vaultId) : undefined;
  const billingId = info.data?.billingId ? BigInt(info.data.billingId) : undefined;
  const vaults = useAllVaults();
  const billings = useAllBillings();
  const charges = useAllCharges();
  const history = useHistory(vaultId);
  const vault = vaults.items.find((v) => v.id === vaultId)?.data;
  const billing = billings.items.find((b) => b.id === billingId)?.data;
  // Charges that failed (e.g. sent while the allowance was empty) are left out; they stay in the parent's History.
  const list = charges.items.filter((c) => c.data.billingId === billingId && c.data.status !== 5).slice(0, 12);
  const serverNote = useServerNotes(list.map((c) => c.data.memoHash));
  const simulated = new Map((info.data?.simulated ?? []).map((s) => [s.chargeId, s.kind]));

  const events = useMemo(() => {
    const byCharge = new Map<string, { requested?: Hash; vetoed?: { hash: Hash; reason: string; by: string }; settled?: Hash }>();
    for (const e of history.data ?? []) {
      const id = e.args.chargeId !== undefined ? String(e.args.chargeId) : undefined;
      if (!id) continue;
      const x = byCharge.get(id) ?? {};
      if (e.eventName === "ChargeRequested") x.requested = e.txHash;
      if (e.eventName === "ChargeVetoed") x.vetoed = { hash: e.txHash, reason: String(e.args.reason ?? ""), by: String(e.args.by) };
      if (e.eventName === "ChargeSettled") x.settled = e.txHash;
      byCharge.set(id, x);
    }
    return byCharge;
  }, [history.data]);

  const [run, setRun] = useState<Run>({ state: "idle" });
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);

  async function send(kind: string) {
    setRun({ state: "sending", kind });
    try {
      const res = await fetch("/api/demo/scenario", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) });
      const body = (await res.json()) as { hash?: Hash; chargeId?: string; outcome?: { kind: string; message: string }; error?: string };
      if (!res.ok || !body.hash) throw new Error(body.error ?? "Something went wrong.");
      setRun({
        state: "sent",
        kind,
        hash: body.hash,
        chargeId: BigInt(body.chargeId ?? "0"),
        refused: body.outcome?.kind === "refuse",
        message: body.outcome?.message ?? "",
        startedAt: Date.now(),
      });
      info.refetch();
    } catch (e) {
      setRun({ state: "error", kind, text: e instanceof Error ? e.message : "Something went wrong." });
    }
  }

  const live = run.state === "sent" && !run.refused ? charges.items.find((c) => c.id === run.chargeId)?.data : undefined;
  const liveVeto = run.state === "sent" ? events.get(run.chargeId.toString())?.vetoed : undefined;

  if (!rails) return <main className="shell"><NotDeployed /></main>;

  return (
    <main className="shell">
      <section className="page-head">
        <div>
          <p className="eyebrow">For judges</p>
          <h1>🧑‍⚖️ See Pocket Rails working. No wallet needed.</h1>
          <p className="lede">
            This allowance is live on Aevum testnet. A school billing agent charges it once per school day, and a guardian agent (a smart account
            with an AI review) checks every charge. Press a button below to send a simulated problem and watch what happens.
          </p>
        </div>
      </section>

      {!info.data?.enabled && !info.isLoading && (
        <div className="notice warn">
          <strong>The live demo isn&apos;t switched on for this server.</strong>
          <span>The recorded runs below still show every step with transaction links.</span>
        </div>
      )}

      {vault && billing && (
        <section className="stats" aria-label="Showcase allowance">
          <div className="stat">
            <span className="stat-label">💰 Allowance #{vaultId?.toString()}</span>
            <span className="stat-value">
              {fmt(vault.balance)} <small>tUSD8</small>
            </span>
            <span className="stat-note">{fmt(vault.schoolReserve)} set aside for school</span>
          </div>
          <div className="stat">
            <span className="stat-label">🏫 School billing</span>
            <span className="stat-value" style={{ fontSize: 20 }}>
              max {fmt(billing.maxPerCharge)} per charge
            </span>
            <span className="stat-note">
              {fmt(billing.maxPerPeriod)} a week · waits {Number(billing.vetoWindow) / 60} min <Explain term="vetoWindow" label="Waiting time" />
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">🚦 Guardian</span>
            <span className="stat-note">
              Smart account{" "}
              {net.hasExplorer && info.data?.guardian ? (
                <a href={addressUrl(info.data.guardian)} target="_blank" rel="noreferrer" className="mono">
                  {short(info.data.guardian)} ↗
                </a>
              ) : (
                <code>{short(info.data?.guardian)}</code>
              )}
            </span>
            <span className="stat-note">Its agent&apos;s key can only veto <Explain term="guardian" label="Guardian" /></span>
          </div>
        </section>
      )}

      <section className="stack" aria-labelledby="live">
        <h2 id="live" className="section-title">
          See it live
        </h2>
        <div className="roles">
          {SCENARIOS.map((s) => (
            <div key={s.kind} className="card role" style={{ cursor: "default" }}>
              <span className="role-emoji" aria-hidden="true">
                {s.emoji}
              </span>
              <h3>{s.title}</h3>
              <p>{s.what}</p>
              <p>
                <strong>Expected:</strong> {s.expect}
              </p>
              <button
                type="button"
                className="btn small"
                style={{ alignSelf: "flex-start", marginTop: "auto" }}
                disabled={!info.data?.enabled || run.state === "sending"}
                onClick={() => send(s.kind)}
              >
                {run.state === "sending" && run.kind === s.kind ? "Sending…" : "Try it"}
              </button>
            </div>
          ))}
        </div>
        <p className="fine">
          🧪 These are simulated problems sent by the school&apos;s billing key, so you can see the safety checks react. They&apos;re labelled below and in the
          history. Limited to a few per visitor per hour.
        </p>

        {run.state === "error" && (
          <div className="notice bad" role="alert">
            <strong>{run.text}</strong>
          </div>
        )}
        {run.state === "sent" && run.refused && (
          <div className="notice good" role="status">
            <strong>✓ Refused by the contract: {run.message}</strong>
            <span>Nothing is pending and no money moved. The refusal is recorded on Aevum. <TxLink hash={run.hash} label="See the record" /></span>
          </div>
        )}
        {run.state === "sent" && !run.refused && (
          <div className={`notice ${liveVeto ? "good" : "info"}`} role="status">
            <strong>
              {liveVeto ? (
                <>✓ Vetoed by the guardian smart account: “{liveVeto.reason}”</>
              ) : (
                <>
                  <span className="spinner" aria-hidden="true" /> Charge #{run.chargeId.toString()} sent. Waiting for the guardian (usually 10-30 seconds)…
                </>
              )}
            </strong>
            <span>
              1. School sends the charge: <TxLink hash={run.hash} label="see it" />
              {liveVeto && (
                <>
                  {" "}
                  · 2. Guardian vetoes it through QDay&apos;s bundler: <TxLink hash={liveVeto.hash} label="see the veto" />. No money moved.
                </>
              )}
            </span>
            {!liveVeto && live && Date.now() - run.startedAt > 90_000 && (
              <span className="fine">
                No veto yet. The guardian agent may be busy or offline; the charge stays in its {timeLeft(live.settleAfter)} waiting window, where the
                parent can still stop it.
              </span>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Latest charges on this allowance</h2>
        <p className="sub">Updates every few seconds, straight from the contract.</p>
        <div className="list">
          {list.map(({ id, data: c }) => {
            const ev = events.get(id.toString());
            const sim = simulated.get(id.toString());
            const tone = c.status === 4 ? "good" : c.status === 3 || c.status === 5 ? "bad" : "warn";
            return (
              <div key={id.toString()} className="item">
                <div className="item-main">
                  <span className="item-title">
                    #{id.toString()} · {fmt(c.amount)} tUSD8 · “{serverNote(c.memoHash) ?? "note not published"}”{" "}
                    {sim && <span className="badge info">🧪 simulated {sim}</span>}
                  </span>
                  <span className="item-sub">
                    {ev?.requested && <TxLink hash={ev.requested} label="request" />}
                    {ev?.vetoed && (
                      <>
                        {" "}
                        · vetoed: “{ev.vetoed.reason}” <TxLink hash={ev.vetoed.hash} label="veto" />
                      </>
                    )}
                    {ev?.settled && (
                      <>
                        {" "}
                        · <TxLink hash={ev.settled} label="paid to the school" />
                      </>
                    )}
                    {c.status === 1 && nowSec() < c.settleAfter && ` · waiting ${timeLeft(c.settleAfter)}`}
                  </span>
                </div>
                <span className={`badge ${tone}`}>{ChargeStatus[c.status]}</span>
              </div>
            );
          })}
          {list.length === 0 && <p className="fine">{charges.isLoading ? "Loading…" : "No charges yet."}</p>}
        </div>
      </section>

      <section className="stack" aria-labelledby="proof">
        <h2 id="proof" className="section-title">
          Recorded proof
        </h2>
        <div className="safety">
          <a className="card" href={`${repoUrl}/blob/main/docs/DEMO_RUN.md`} target="_blank" rel="noreferrer">
            <span className="safety-emoji" aria-hidden="true">🧾</span>
            <div>
              <h3>Live runs</h3>
              <p>Every step of the child and school flows, the AI catching a trick note, and the smart-account veto, with transaction links.</p>
            </div>
          </a>
          <a className="card" href={`${repoUrl}/blob/main/docs/AI_EVAL.md`} target="_blank" rel="noreferrer">
            <span className="safety-emoji" aria-hidden="true">📊</span>
            <div>
              <h3>Guardian evaluation</h3>
              <p>50 frozen test notes: rules + AI vetoed 30/30 bad charges, 16/16 prompt injections, 0/16 genuine charges wrongly vetoed.</p>
            </div>
          </a>
          <a className="card" href={`${repoUrl}#contracts`} target="_blank" rel="noreferrer">
            <span className="safety-emoji" aria-hidden="true">✅</span>
            <div>
              <h3>Verified contracts</h3>
              <p>PocketRails v2 and the veto-only session module, source verified on the Aevum explorer.</p>
            </div>
          </a>
          <a className="card" href={`${repoUrl}/blob/main/docs/GUIDE.md`} target="_blank" rel="noreferrer">
            <span className="safety-emoji" aria-hidden="true">🧭</span>
            <div>
              <h3>Try it with a wallet</h3>
              <p>The plain-English guide walks through the parent and child screens step by step.</p>
            </div>
          </a>
        </div>
      </section>
    </main>
  );
}
