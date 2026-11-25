"use client";

import { addressUrl } from "@aevum-kit/aevum";
import Link from "next/link";
import { NotDeployed } from "@/components/ui";
import { repoUrl } from "@/lib/env";
import { useCounts, useRails } from "@/lib/rails";

const roles = [
  {
    href: "/parent",
    emoji: "🧑‍🍼",
    title: "Parent",
    text: "Fund the allowance, set the rules once, answer requests, manage school billing, revoke anything instantly.",
  },
  {
    href: "/child",
    emoji: "🎒",
    title: "Child",
    text: "Pay approved places without asking. If a rule stops you, see why and ask for a one-time exception. No gas needed.",
  },
  {
    href: "/school",
    emoji: "🏫",
    title: "School",
    text: "Bill meals or transport inside the parent's caps. Each charge waits out a veto window, then settles.",
  },
  {
    href: "/guardian",
    emoji: "🛡️",
    title: "Guardian",
    text: "A helper (or AI agent) that reviews school charges. It can veto, and that's all it can do.",
  },
];

export default function Home() {
  const { rails, net } = useRails();
  const counts = useCounts();

  return (
    <main className="shell">
      <section className="page-head">
        <div>
          <p className="eyebrow">Aevum testnet · tUSD8</p>
          <h1>Kids pay out, the school bills in, parents set the rules once.</h1>
          <p className="lede">
            Pocket Rails gives a child spending freedom in stages. Every payment, in either direction, is checked by the smart contract that
            holds the money, so no screen can be bypassed.
          </p>
          <p className="slogan" style={{ marginTop: 16 }}>
            AI can say no, never yes. Every yes traces back to a parent&apos;s signature.
          </p>
        </div>
      </section>

      {!rails && <NotDeployed />}

      <section className="roles" aria-label="Choose your role">
        {roles.map((r) => (
          <Link key={r.href} href={r.href} className="card role">
            <span className="role-emoji" aria-hidden="true">
              {r.emoji}
            </span>
            <h2>{r.title}</h2>
            <p>{r.text}</p>
            <span className="btn small secondary" style={{ alignSelf: "flex-start" }}>
              Open {r.title.toLowerCase()} view →
            </span>
          </Link>
        ))}
      </section>

      <section className="stack">
        <h2>How it works</h2>
        <ol className="flow">
          <li>
            <strong>Standing rules</strong>Approved places, a per-payment limit, a weekly limit and an end date. Every change is a new numbered
            version.
          </li>
          <li>
            <strong>Pay inside them</strong>The child signs; a relayer pays the gas. Inside the rules it&apos;s paid with no approval needed.
          </li>
          <li>
            <strong>Refusals are recorded</strong>Break a rule and nothing moves, but the refusal is a real transaction with a reason code
            and a plain explanation.
          </li>
          <li>
            <strong>Exact exceptions</strong>The child asks; the parent allows one exact payment, once. The standing rules don&apos;t change.
          </li>
          <li>
            <strong>School billing</strong>Capped, expiring permission. Each charge waits in a veto window. The guardian can say no; only the
            parent can say yes.
          </li>
          <li>
            <strong>Instant revoke</strong>One click pauses the child or stops everything, including pending charges and requests.
          </li>
        </ol>
      </section>

      {rails && (
        <section className="stats" aria-label="Live on-chain">
          <div className="stat">
            <span className="stat-label">Vaults</span>
            <span className="stat-value">{counts.vaults.toString()}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Exception requests</span>
            <span className="stat-value">{counts.exceptions.toString()}</span>
          </div>
          <div className="stat">
            <span className="stat-label">School charges</span>
            <span className="stat-value">{counts.charges.toString()}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Contract</span>
            <span className="stat-note">
              {net.hasExplorer ? (
                <a href={addressUrl(rails)} target="_blank" rel="noreferrer" className="mono">
                  {rails.slice(0, 10)}… ↗
                </a>
              ) : (
                <code>{rails.slice(0, 10)}…</code>
              )}
            </span>
            <span className="stat-note">
              <a href={repoUrl} target="_blank" rel="noreferrer">
                Source code
              </a>
            </span>
          </div>
        </section>
      )}

      <p className="fine">
        Testnet only, test tokens only, not audited. No real money, no real children&apos;s data, no real merchants. It doesn&apos;t replace
        parental judgment.
      </p>
    </main>
  );
}
