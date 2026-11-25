"use client";

import { explainReason, memoHash, pocketRailsAbi, Reason } from "@pocket-rails/sdk";
import { useEffect, useMemo, useState } from "react";
import { isAddress, type Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { Explain, Guide } from "@/components/help";
import { PanelHead, DemoBanner } from "@/components/dash";
import { NotDeployed, StatusNotice, Timeline, type Status } from "@/components/ui";
import { showcaseVaultId } from "@/lib/env";
import { ReadOnlyContext, useReadOnly } from "@/lib/viewMode";
import { noteFor, RelayError, useChildActions } from "@/lib/childActions";
import {
  dateOf,
  ExceptionStatus,
  fmt,
  nowSec,
  parseAmount,
  payeeLabels,
  sameAddr,
  short,
  timeLeft,
  useAllExceptions,
  useAllVaults,
  useHistory,
  useRails,
  useSpentThisWeek,
  type Vault,
} from "@/lib/rails";

type Place = { address: Address; label: string };

/** Approved places, from the parent's PayeeChanged history (latest change per payee wins). */
function approvedPlaces(history: ReturnType<typeof useHistory>["data"]): Place[] {
  const latest = new Map<string, { allowed: boolean; label: string; address: Address }>();
  for (const e of [...(history ?? [])].reverse()) {
    if (e.eventName !== "PayeeChanged") continue;
    const a = String(e.args.payee) as Address;
    latest.set(a.toLowerCase(), { allowed: Boolean(e.args.allowed), label: String(e.args.label || short(a)), address: a });
  }
  return [...latest.values()].filter((p) => p.allowed).map(({ address, label }) => ({ address, label }));
}

export default function ChildPage() {
  const { address, isConnected, status: walletStatus } = useAccount();
  const { rails, chainId } = useRails();
  const vaults = useAllVaults();
  const [demoPick, setDemoPick] = useState(false);
  const isDemo = !isConnected || demoPick;
  const mine = vaults.items.filter((v) => (isDemo ? v.id === showcaseVaultId : sameAddr(v.data.child, address)));
  const [selected, setSelected] = useState<bigint | null>(null);
  const current = mine.find((v) => v.id === selected) ?? mine[0];

  if (!rails) return <main className="shell"><NotDeployed /></main>;
  if (walletStatus === "connecting" || walletStatus === "reconnecting") return <main className="shell"><p className="empty">Connecting your wallet…</p></main>;

  let body;
  if (vaults.isLoading) body = <p className="empty">Finding the allowance…</p>;
  else if (!current && !isDemo)
    body = (
      <div className="card">
        <span style={{ fontSize: 44 }} aria-hidden="true">🔎</span>
        <h2>No allowance for this account yet</h2>
        <p className="sub">Ask your parent to open one for you. They&apos;ll need this address:</p>
        <code className="mono" style={{ overflowWrap: "anywhere" }}>{address}</code>
        <div className="actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn small secondary" onClick={() => address && navigator.clipboard?.writeText(address)}>
            Copy address
          </button>
          <button type="button" className="btn small ghost" onClick={() => setDemoPick(true)}>
            See the showcase child instead
          </button>
        </div>
      </div>
    );
  else if (!current) body = <p className="empty">The showcase allowance isn&apos;t on this network.</p>;
  else
    body = (
      <>
        {mine.length > 1 && (
          <div className="tabs" role="group" aria-label="Allowances">
            {mine.map((v) => (
              <button key={v.id.toString()} type="button" aria-pressed={v.id === current.id} onClick={() => setSelected(v.id)}>
                Allowance #{v.id.toString()}
              </button>
            ))}
          </div>
        )}
        <ChildVault vaultId={current.id} vault={current.data} chainId={chainId} />
      </>
    );

  return (
    <ReadOnlyContext.Provider value={isDemo}>
      <main className="shell wide">
        {isDemo && (
          <DemoBanner
            role="child"
            what={<>You&apos;re seeing the showcase child&apos;s phone (allowance #{showcaseVaultId.toString()}). Pick a place and type an amount: the app checks it against the parent&apos;s rules live.</>}
          />
        )}
        <div className="child-layout">
          <div className="phone">{body}</div>
          <aside className="child-aside" aria-label="How it works for children">
            <section className="card">
              <PanelHead title="🎒 Made for kids" sub="Simple words, no fees, and a kind answer when something isn't allowed." />
              <div className="powers" style={{ gridTemplateColumns: "1fr" }}>
                <div className="power yes">✓ Pays approved places on their own, no waiting</div>
                <div className="power yes">✓ Never pays network fees <Explain term="gas" label="Fees" /></div>
                <div className="power yes">✓ Sees before paying whether it will go through</div>
                <div className="power yes">✓ Can ask a parent for a one-time yes <Explain term="exception" label="Exception" /></div>
              </div>
            </section>
            {isDemo && (
              <section className="card warm">
                <PanelHead title="🧪 Try it here" />
                <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li>Tap a place, then <strong>0.1</strong>: it says ✓ inside the rules.</li>
                  <li>Type <strong>5</strong>: it explains, kindly, which rule says no.</li>
                  <li>Connect the child wallet to really pay. The parent never has to approve it.</li>
                </ol>
              </section>
            )}
          </aside>
        </div>
      </main>
    </ReadOnlyContext.Provider>
  );
}

function ChildVault({ vaultId, vault, chainId }: { vaultId: bigint; vault: Vault; chainId: number }) {
  const { rails } = useRails();
  const spent = useSpentThisWeek(vaultId);
  const history = useHistory(vaultId);
  const exceptions = useAllExceptions();
  const { pay, requestException, submitYourself } = useChildActions();
  const [fallback, setFallback] = useState<RelayError | null>(null);

  const places = useMemo(() => approvedPlaces(history.data), [history.data]);
  const labels = useMemo(() => payeeLabels(history.data), [history.data]);
  const label = (a: string) => labels.get(a.toLowerCase()) ?? short(a);

  const [payee, setPayee] = useState<string>("");
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [askMode, setAskMode] = useState(false);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  useEffect(() => {
    if (!payee && places[0]) setPayee(places[0].address);
  }, [places, payee]);

  const amount = parseAmount(amountText);
  const payeeOk = isAddress(payee);
  const weekly = vault.rules.weeklyLimit;
  const spentNow = spent.data ?? 0n;
  const left = weekly > spentNow ? weekly - spentNow : 0n;
  const expired = nowSec() >= vault.rules.expiresAt;
  const readOnly = useReadOnly();
  const busy = readOnly || status.state === "signing" || status.state === "unknown";

  // Live check against the contract before signing: the same rules the contract will apply.
  const preview = useReadContract({
    address: rails,
    abi: pocketRailsAbi,
    functionName: "previewPayment",
    args: payeeOk && amount ? [vaultId, payee as Address, amount, memoHash(note), 0n] : undefined,
    chainId,
    query: { enabled: Boolean(rails && payeeOk && amount && !askMode) },
  });
  const previewReason = preview.data !== undefined ? Number(preview.data) : undefined;

  const myRequests = exceptions.items.filter((x) => x.data.vaultId === vaultId).slice(0, 8);

  async function run(fn: () => Promise<import("@pocket-rails/sdk").Outcome>) {
    setStatus({ state: "signing", text: "Check your wallet…" });
    setFallback(null);
    try {
      const outcome = await fn();
      setStatus({ state: "done", outcome });
      if (outcome.kind === "allow") setAmountText("");
    } catch (e) {
      if (e instanceof RelayError && e.canSelfSubmit) setFallback(e);
      setStatus({ state: "error", text: e instanceof Error ? e.message : "Something went wrong. Nothing was sent." });
    }
  }

  const sendYourself = () => fallback && run(() => submitYourself(fallback.signed, (s) => setStatus(s)));

  const doPay = () =>
    amount && payeeOk &&
    run(() => pay({ vaultId, epoch: vault.childEpoch, payee: payee as Address, amount, note }, (s) => setStatus(s)));

  const doAsk = () =>
    amount && payeeOk &&
    run(async () => {
      const o = await requestException({ vaultId, epoch: vault.childEpoch, payee: payee as Address, amount, note }, (s) => setStatus(s));
      if (o.kind === "pending") setAskMode(false);
      return o;
    });

  const payException = (id: bigint, x: { payee: Address; amount: bigint; memoHash: string }) => {
    const text = noteFor(x.memoHash);
    if (text === undefined) {
      setStatus({ state: "error", text: "This request's note isn't saved on this device. Type the exact same note in the box above, pick the place and amount, then use Pay." });
      setPayee(x.payee);
      setAmountText((Number(x.amount) / 1e6).toString());
      return;
    }
    run(() => pay({ vaultId, epoch: vault.childEpoch, payee: x.payee, amount: x.amount, note: text, exceptionId: id }, (s) => setStatus(s)));
  };

  return (
    <>
      <ChildGuide
        paused={!vault.childActive}
        ended={expired}
        empty={vault.balance === 0n}
        yes={myRequests.some(({ data: x }) => x.status === 2 && x.epoch === vault.childEpoch && nowSec() <= x.validUntil)}
        waiting={myRequests.some(({ data: x }) => x.status === 1 && x.epoch === vault.childEpoch)}
      />
      <section className="wallet-card" aria-label="Your allowance">
        <div className="row-between">
          <span>🎒 My allowance</span>
          <span>{!vault.childActive ? "⏸ Paused by parent" : expired ? "Ended" : `Until ${dateOf(vault.rules.expiresAt)}`}</span>
        </div>
        <span className="big">
          {fmt(vault.balance)} <small>tUSD8</small>
        </span>
        <div className="meter" aria-hidden="true">
          <span style={{ width: `${weekly > 0n ? Number((spentNow * 100n) / weekly) : 0}%` }} />
        </div>
        <div className="row-between">
          <span>
            {fmt(left)} left this week (of {fmt(weekly)})
          </span>
          <span>max {fmt(vault.rules.perPaymentLimit)} per payment</span>
        </div>
        {vault.schoolReserve > 0n && (
          <div className="row-between">
            <span>🚌 {fmt(vault.schoolReserve)} set aside for school</span>
            <span>you can spend {fmt(vault.balance - vault.schoolReserve)}</span>
          </div>
        )}
      </section>

      <section className="card form" aria-label={askMode ? "Ask for an exception" : "Pay"}>
        <div className="row-between" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>{askMode ? "🙋 Ask your parent" : "💸 Pay"}</h2>
          {askMode && (
            <button type="button" className="btn small ghost" onClick={() => setAskMode(false)}>
              Back to paying
            </button>
          )}
        </div>
        {askMode && <p className="sub">Your parent can say yes to this exact payment, once <Explain term="exception" label="Exception" />. Nothing is paid until they do.</p>}

        <div className="places" role="group" aria-label="Approved places">
          {places.map((p) => (
            <button key={p.address} type="button" className="place" aria-pressed={sameAddr(p.address, payee)} onClick={() => setPayee(p.address)}>
              <span>{p.label}</span>
              <small>✓ Approved</small>
            </button>
          ))}
          {places.length === 0 && <p className="fine">{history.isLoading ? "Loading your places…" : "No approved places yet."}</p>}
        </div>
        {askMode && (
          <label className="lbl">
            Somewhere else? Paste the address <span className="hint">(for example the museum for a school trip)</span>
            <input className="field" value={payee} onChange={(e) => setPayee(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
          </label>
        )}

        <label className="lbl">
          Amount (tUSD8)
          <input className="amount-input" inputMode="decimal" placeholder="0.00" value={amountText} onChange={(e) => setAmountText(e.target.value.replace(",", "."))} />
        </label>
        {!askMode && (
          <div className="quick">
            {["0.1", "0.25", "0.5"].map((q) => (
              <button key={q} type="button" className="btn small ghost" onClick={() => setAmountText(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        <label className="lbl">
          <span>
            What&apos;s it for? <span className="hint">(optional, stays on your phone)</span>
          </span>
          <input className="field text" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} placeholder={askMode ? "What is it for?" : "Lunch"} />
        </label>

        {!askMode && previewReason !== undefined && amount && (
          <p className={`preview ${previewReason === Reason.None ? "good" : "bad"}`} role="status">
            {previewReason === Reason.None ? "✓ Inside your rules. This will go through." : `✗ ${explainReason(previewReason).message} ${explainReason(previewReason).nextStep}`}
          </p>
        )}

        {askMode ? (
          <button type="button" className="btn big block" disabled={!amount || !payeeOk || busy} onClick={doAsk}>
            {readOnly ? "Connect the child wallet to ask" : "Send request to parent"}
          </button>
        ) : (
          <button type="button" className="btn big block" disabled={!amount || !payeeOk || busy} onClick={doPay}>
            {readOnly ? "Connect the child wallet to pay" : `Pay ${amount ? `${fmt(amount)} tUSD8` : ""}`}
          </button>
        )}
        <StatusNotice status={status} onAskException={() => (setAskMode(true), setStatus({ state: "idle" }))} />
        {fallback && status.state === "error" && (
          <div className="notice warn">
            <strong>Plan B: send it yourself</strong>
            <span>
              The app&apos;s server can&apos;t send this right now. You can send the payment you already signed from your own wallet. The rules are
              exactly the same; you just pay a tiny network fee <Explain term="gas" label="Fee" /> in tQDAY.
            </span>
            <div className="actions">
              <button type="button" className="btn small" disabled={busy} onClick={sendYourself}>
                Send it myself
              </button>
            </div>
          </div>
        )}
        {!askMode && (
          <button type="button" className="btn small ghost" onClick={() => (setAskMode(true), setStatus({ state: "idle" }))}>
            Need something else? Ask your parent
          </button>
        )}
      </section>

      {myRequests.length > 0 && (
        <section className="card">
          <h2>📨 My requests</h2>
          <div className="list" style={{ marginTop: 12 }}>
            {myRequests.map(({ id, data: x }) => {
              const statusName = ExceptionStatus[x.status] ?? "Unknown";
              const stale = x.epoch !== vault.childEpoch && x.status !== 4;
              const usable = x.status === 2 && !stale && nowSec() <= x.validUntil;
              return (
                <div key={id.toString()} className="item">
                  <div className="item-main">
                    <span className="item-title">
                      {fmt(x.amount)} tUSD8 to {label(x.payee)}
                    </span>
                    <span className="item-sub">
                      {noteFor(x.memoHash) || "No note saved on this device"}
                      {usable && ` · allowed for ${timeLeft(x.validUntil)} more`}
                    </span>
                  </div>
                  {usable ? (
                    <button type="button" className="btn small" disabled={busy} onClick={() => payException(id, x)}>
                      Pay now
                    </button>
                  ) : (
                    <span className={`badge ${x.status === 1 ? "warn" : x.status === 3 || stale ? "bad" : x.status === 4 ? "good" : ""}`}>
                      {stale ? "Cancelled" : x.status === 2 ? "Expired" : x.status === 1 ? "Waiting for parent" : statusName}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="card">
        <h2>🧾 What happened</h2>
        <div style={{ marginTop: 12 }}>
          <Timeline
            events={history.data?.filter((e) => ["Paid", "Refused", "ExceptionRequested", "ExceptionDecided", "Deposited"].includes(e.eventName)).slice(0, 15)}
            label={label}
            money={(v) => `${fmt(BigInt(String(v)))} tUSD8`}
            loading={history.isLoading}
            error={history.error?.message}
          />
        </div>
      </section>
    </>
  );
}

/** One friendly line about what the child can do right now. */
function ChildGuide({ paused, ended, empty, yes, waiting }: { paused: boolean; ended: boolean; empty: boolean; yes: boolean; waiting: boolean }) {
  if (paused) return <Guide emoji="⏸️" title="Your spending is paused">Your parent has paused it for now. Talk to them to turn it back on.</Guide>;
  if (ended) return <Guide emoji="📅" title="Your allowance has ended">Ask your parent to renew it.</Guide>;
  if (yes) return <Guide emoji="🎉" title="Your parent said yes!">Find it under “My requests” and tap “Pay now”.</Guide>;
  if (empty) return <Guide emoji="🪫" title="Your allowance is empty">Ask your parent to top it up.</Guide>;
  if (waiting) return <Guide emoji="⏳" title="Waiting for your parent">You&apos;ll see their answer under “My requests”.</Guide>;
  return (
    <Guide emoji="👋" title="Pick a place, choose an amount, tap Pay">
      You never pay fees <Explain term="gas" label="Fees" />. If something isn&apos;t allowed, we&apos;ll tell you why and how to ask.
    </Guide>
  );
}
