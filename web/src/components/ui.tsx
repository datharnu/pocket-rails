"use client";

import { txUrl } from "@aevum-kit/aevum";
import { explainReason, type Outcome } from "@pocket-rails/sdk";
import { useState, type ReactNode } from "react";
import type { Hash } from "viem";
import { useNetwork } from "@/lib/network";
import { short, type HistoryEvent } from "@/lib/rails";
import { ConnectButton } from "@rainbow-me/rainbowkit";

/** A transaction hash as an explorer link (on Aevum), or just the short hash (local chains). */
export function TxLink({ hash, label }: { hash: string; label?: string }) {
  const { net } = useNetwork();
  if (!net.hasExplorer) return <code title={hash}>{label ?? short(hash)}</code>;
  return (
    <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="mono" title="Open on the Aevum explorer">
      {label ?? short(hash)} ↗
    </a>
  );
}

/** What happened, in plain words, with proof. "unknown" means: not confirmed yet, assume nothing. */
export type Status =
  | { state: "idle" }
  | { state: "signing"; text: string }
  | { state: "unknown"; text: string; hash?: Hash }
  | { state: "done"; outcome: Outcome }
  | { state: "error"; text: string };

export function StatusNotice({ status, onAskException }: { status: Status; onAskException?: () => void }) {
  if (status.state === "idle") return null;
  if (status.state === "signing")
    return (
      <div className="notice info" role="status">
        <strong>{status.text}</strong>
        <span className="fine">Check your wallet. If no window opened, click the wallet icon in your browser toolbar.</span>
      </div>
    );
  if (status.state === "unknown")
    return (
      <div className="notice info" role="status">
        <strong>
          <span className="spinner" aria-hidden="true" /> {status.text}
        </strong>
        <span className="fine">
          Waiting for the blockchain to confirm. We won&apos;t show a result until it does. {status.hash && <TxLink hash={status.hash} label="Track it" />}
        </span>
      </div>
    );
  if (status.state === "error")
    return (
      <div className="notice bad" role="alert">
        <strong>{status.text}</strong>
      </div>
    );
  const o = status.outcome;
  if (o.kind === "refuse" && o.reason !== undefined) {
    const r = explainReason(o.reason);
    return (
      <div className="notice bad" role="alert">
        <strong>That didn&apos;t go through, and that&apos;s okay. {r.message}</strong>
        <span>{r.nextStep}</span>
        <div className="row-between">
          <span className="fine">
            No money moved. The refusal is recorded on Aevum (reason {o.reason}). <TxLink hash={o.hash} label="See the record" />
          </span>
          {r.canAskException && onAskException && (
            <button type="button" className="btn small secondary" onClick={onAskException}>
              Ask for an exception
            </button>
          )}
        </div>
      </div>
    );
  }
  const tone = o.kind === "failed" ? "bad" : o.kind === "pending" ? "warn" : "good";
  return (
    <div className={`notice ${tone}`} role="status">
      <strong>{o.message}</strong>
      <span className="fine">
        Confirmed on Aevum. <TxLink hash={o.hash} label="See the record" />
      </span>
    </div>
  );
}

export function NeedWallet({ role, emoji = "👛", children }: { role: string; emoji?: string; children?: ReactNode }) {
  return (
    <div className="card center-card">
      <span style={{ fontSize: 44, lineHeight: 1 }} aria-hidden="true">
        {emoji}
      </span>
      <h2>Connect the {role} wallet</h2>
      <p className="sub">{children ?? "Use the account you set up for this role."}</p>
      <ConnectButton />
    </div>
  );
}

export function NotDeployed() {
  const { net } = useNetwork();
  return (
    <div className="notice warn">
      <strong>Pocket Rails isn&apos;t set up on {net.label} yet.</strong>
      <span>Set NEXT_PUBLIC_RAILS_{net.key.toUpperCase()} in web/.env.local and restart the app.</span>
    </div>
  );
}

const EVENT_TEXT: Record<string, (a: HistoryEvent["args"], label: (x: string) => string, money: (x: unknown) => string) => string> = {
  VaultCreated: () => "Allowance opened",
  Deposited: (a, l, m) => `Topped up ${m(a.amount)} from ${l(String(a.from))}`,
  Withdrawn: (a, _l, m) => `Parent withdrew ${m(a.amount)}`,
  RulesChanged: (a, _l, m) => `Rules v${a.version}: ${m(a.perPaymentLimit)} per payment, ${m(a.weeklyLimit)} a week`,
  PayeeChanged: (a, l) => `Rules v${a.version}: ${a.allowed ? "approved" : "removed"} ${a.label || l(String(a.payee))}`,
  ChildChanged: (a) => `Rules v${a.version}: child access ${a.active ? "on" : "paused"}`,
  GuardianChanged: (a, l) => `Rules v${a.version}: guardian ${String(a.guardian) === "0x0000000000000000000000000000000000000000" ? "removed" : `set to ${l(String(a.guardian))}`}`,
  VaultRevoked: (a) => `Rules v${a.version}: everything revoked`,
  SchoolReserveChanged: (a, _l, m) => `Rules v${a.version}: ${m(a.amount)} set aside for school costs`,
  Paid: (a, l, m) => `Paid ${m(a.amount)} to ${l(String(a.payee))}${String(a.exceptionId) !== "0" ? ` (exception #${a.exceptionId})` : ""}`,
  Refused: (a, l, m) => `Refused ${m(a.amount)} to ${l(String(a.payee))}: ${explainReason(Number(a.reason)).message}`,
  ExceptionRequested: (a, l, m) => `Exception #${a.exceptionId} requested: ${m(a.amount)} to ${l(String(a.payee))}`,
  ExceptionDecided: (a) => `Exception #${a.exceptionId} ${a.allowed ? "allowed once" : "declined"}`,
  BillingGranted: (a) => `Rules v${a.version}: school billing #${a.billingId} granted (${a.label || "billing"})`,
  BillingRevoked: (a) => `Rules v${a.version}: school billing #${a.billingId} revoked`,
  ChargeRequested: (a, _l, m) => `School charge #${a.chargeId}: ${m(a.amount)} requested`,
  ChargeRefused: (a, _l, m) => `School charge of ${m(a.amount)} refused: ${explainReason(Number(a.reason)).message}`,
  ChargeVetoed: (a, l) => `Charge #${a.chargeId} vetoed by ${l(String(a.by))}${a.reason ? `: “${a.reason}”` : ""}`,
  ChargeApproved: (a) => `Charge #${a.chargeId} approved by the parent`,
  ChargeSettled: (a, l, m) => `Charge #${a.chargeId} settled: ${m(a.amount)} to ${l(String(a.payTo))}`,
  ChargeFailed: (a) => `Charge #${a.chargeId} failed: ${explainReason(Number(a.reason)).message}`,
};

const TONE: Record<string, string> = {
  Paid: "good",
  ChargeSettled: "good",
  Deposited: "good",
  Refused: "bad",
  ChargeRefused: "bad",
  ChargeFailed: "bad",
  ChargeVetoed: "warn",
  ExceptionRequested: "warn",
  ChargeRequested: "warn",
  VaultRevoked: "bad",
};

type Line = { kind: "event"; e: HistoryEvent } | { kind: "failed"; events: HistoryEvent[]; ids: string[] };

/**
 * Groups runs of school charges that couldn't be paid (each a "requested" + "failed" pair) into one line, so a
 * stretch when the allowance was empty doesn't drown out everything else. Nothing is dropped: the line expands.
 */
function groupFailed(events: HistoryEvent[]): Line[] {
  const failed = new Set(events.filter((e) => e.eventName === "ChargeFailed").map((e) => String(e.args.chargeId)));
  const isFailedCharge = (e: HistoryEvent) => (e.eventName === "ChargeRequested" || e.eventName === "ChargeFailed") && failed.has(String(e.args.chargeId));
  const out: Line[] = [];
  let run: HistoryEvent[] = [];
  const flush = () => {
    const ids = [...new Set(run.map((e) => String(e.args.chargeId)))];
    if (ids.length >= 3) out.push({ kind: "failed", events: run, ids });
    else run.forEach((e) => out.push({ kind: "event", e }));
    run = [];
  };
  for (const e of events) {
    if (isFailedCharge(e)) run.push(e);
    else {
      flush();
      out.push({ kind: "event", e });
    }
  }
  flush();
  return out;
}

function FailedRun({ line, label, money }: { line: Extract<Line, { kind: "failed" }>; label: (a: string) => string; money: (x: unknown) => string }) {
  const [open, setOpen] = useState(false);
  const nums = line.ids.map(Number).sort((a, b) => a - b);
  const reason = line.events.find((e) => e.eventName === "ChargeFailed");
  return (
    <li className="warn">
      <span className="tl-text">
        {line.ids.length} school charges couldn&apos;t be paid{reason ? `: ${Number(reason.args.reason) === 6 ? "the allowance didn't have enough money at the time" : explainReason(Number(reason.args.reason)).message.replace(/\.$/, "").toLowerCase()}` : ""} (#{nums[0]}–#{nums[nums.length - 1]}).
        No money moved.{" "}
        <button type="button" className="btn small ghost" onClick={() => setOpen((x) => !x)}>
          {open ? "Hide them" : "Show them"}
        </button>
      </span>
      {open && (
        <ol className="timeline" style={{ marginTop: 6 }}>
          {line.events.map((e) => (
            <li key={`${e.txHash}-${e.logIndex}`} className={TONE[e.eventName] ?? ""}>
              <span className="tl-text">{EVENT_TEXT[e.eventName]?.(e.args, label, money) ?? e.eventName}</span>
              <span className="tl-meta">
                block {e.blockNumber} · <TxLink hash={e.txHash} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

/** The on-chain history of a vault, newest first, each line linked to its transaction. */
export function Timeline({
  events,
  label,
  money,
  loading,
  error,
}: {
  events?: HistoryEvent[];
  label: (a: string) => string;
  money: (x: unknown) => string;
  loading?: boolean;
  error?: string;
}) {
  if (error) return <p className="empty">{error}</p>;
  if (loading && !events) return <p className="empty">Loading the history from Aevum…</p>;
  if (!events?.length) return <p className="empty">Nothing yet.</p>;
  return (
    <ol className="timeline">
      {groupFailed(events).map((l) =>
        l.kind === "failed" ? (
          <FailedRun key={`failed-${l.ids[0]}`} line={l} label={label} money={money} />
        ) : (
          <li key={`${l.e.txHash}-${l.e.logIndex}`} className={TONE[l.e.eventName] ?? ""}>
            <span className="tl-text">{EVENT_TEXT[l.e.eventName]?.(l.e.args, label, money) ?? l.e.eventName}</span>
            <span className="tl-meta">
              block {l.e.blockNumber} · <TxLink hash={l.e.txHash} />
            </span>
          </li>
        ),
      )}
    </ol>
  );
}
