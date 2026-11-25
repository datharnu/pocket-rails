"use client";

import { explainReason, memoHash, pocketRailsAbi, Reason } from "@pocket-rails/sdk";
import { useEffect, useMemo, useState } from "react";
import { isAddress, type Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { NeedWallet, NotDeployed, StatusNotice, Timeline, type Status } from "@/components/ui";
import { noteFor, useChildActions } from "@/lib/childActions";
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
  const { address, isConnected } = useAccount();
  const { rails, chainId } = useRails();
  const vaults = useAllVaults();
  const mine = vaults.items.filter((v) => sameAddr(v.data.child, address));
  const [selected, setSelected] = useState<bigint | null>(null);
  const current = mine.find((v) => v.id === selected) ?? mine[0];

  if (!rails) return <main className="shell"><NotDeployed /></main>;
  if (!isConnected) {
    return (
      <main className="shell">
        <div className="phone">
          <NeedWallet role="child">Your allowance lives in the account your parent set up for you. You never need gas.</NeedWallet>
        </div>
      </main>
    );
  }
  if (vaults.isLoading) return <main className="shell"><div className="phone"><p className="empty">Looking for your allowance…</p></div></main>;
  if (!current) {
    return (
      <main className="shell">
        <div className="phone card">
          <h2>No allowance for this account yet</h2>
          <p className="sub">Ask your parent to open one in the Parent view with this address:</p>
          <code className="mono" style={{ overflowWrap: "anywhere" }}>{address}</code>
          <button type="button" className="btn small secondary" onClick={() => address && navigator.clipboard?.writeText(address)}>
            Copy address
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="phone">
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
      </div>
    </main>
  );
}

function ChildVault({ vaultId, vault, chainId }: { vaultId: bigint; vault: Vault; chainId: number }) {
  const { rails } = useRails();
  const spent = useSpentThisWeek(vaultId);
  const history = useHistory(vaultId);
  const exceptions = useAllExceptions();
  const { pay, requestException } = useChildActions();

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
  const busy = status.state === "signing" || status.state === "unknown";

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
    try {
      const outcome = await fn();
      setStatus({ state: "done", outcome });
      if (outcome.kind === "allow") setAmountText("");
    } catch (e) {
      setStatus({ state: "error", text: e instanceof Error ? e.message : "Something went wrong. Nothing was sent." });
    }
  }

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
      <section className="wallet-card" aria-label="Your allowance">
        <div className="row-between">
          <span>Allowance #{vaultId.toString()}</span>
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
      </section>

      <section className="card form" aria-label={askMode ? "Ask for an exception" : "Pay"}>
        <div className="row-between" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>{askMode ? "Ask your parent" : "Pay"}</h2>
          {askMode && (
            <button type="button" className="btn small ghost" onClick={() => setAskMode(false)}>
              Back to paying
            </button>
          )}
        </div>
        {askMode && <p className="sub">Your parent can allow this exact payment once. Nothing is paid until they do.</p>}

        <div className="places" role="group" aria-label="Approved places">
          {places.map((p) => (
            <button key={p.address} type="button" className="place" aria-pressed={sameAddr(p.address, payee)} onClick={() => setPayee(p.address)}>
              <span>{p.label}</span>
              <small>Approved</small>
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
          Note <span className="hint">(stays on your device; only a fingerprint goes on-chain)</span>
          <input className="field text" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} placeholder={askMode ? "What is it for?" : "Lunch"} />
        </label>

        {!askMode && previewReason !== undefined && amount && (
          <p className={`preview ${previewReason === Reason.None ? "good" : "bad"}`} role="status">
            {previewReason === Reason.None ? "✓ Inside your rules. This will go through." : `✗ ${explainReason(previewReason).message} ${explainReason(previewReason).nextStep}`}
          </p>
        )}

        {askMode ? (
          <button type="button" className="btn big block" disabled={!amount || !payeeOk || busy} onClick={doAsk}>
            Send request to parent
          </button>
        ) : (
          <button type="button" className="btn big block" disabled={!amount || !payeeOk || busy} onClick={doPay}>
            Pay {amount ? `${fmt(amount)} tUSD8` : ""}
          </button>
        )}
        <StatusNotice status={status} onAskException={() => (setAskMode(true), setStatus({ state: "idle" }))} />
        {!askMode && (
          <button type="button" className="btn small ghost" onClick={() => (setAskMode(true), setStatus({ state: "idle" }))}>
            Need something outside your rules? Ask for an exception
          </button>
        )}
      </section>

      {myRequests.length > 0 && (
        <section className="card">
          <h2>Your requests</h2>
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
        <h2>Activity</h2>
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
