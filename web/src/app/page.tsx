"use client";

import { addressUrl } from "@aevum-kit/aevum";
import { explainReason } from "@pocket-rails/sdk";
import Link from "next/link";
import { useMemo, useState } from "react";
import { zeroAddress } from "viem";
import { Explain } from "@/components/help";
import { GitHubIcon } from "@/components/Icons";
import { NotDeployed, TxLink } from "@/components/ui";
import { repoUrl, showcaseVaultId } from "@/lib/env";
import { fmt, payeeLabels, short, useAllVaults, useCounts, useHistory, useRails, useSpentThisWeek, type HistoryEvent } from "@/lib/rails";

/** A week with Ada, as stations along a rail. */
const week = [
  { emoji: "🧑‍🍼", title: "Mum sets the rules", text: "Canteen okay. Up to 0.50 a payment, 2 a week.", badge: ["info", "Rules v1"] },
  { emoji: "🎒", title: "Ada buys lunch", text: "Inside the rules, so it just works.", badge: ["good", "✓ Paid"] },
  { emoji: "🍫", title: "A big snack", text: "Too much for one payment. The app says why, kindly.", badge: ["bad", "✗ Not this time"] },
  { emoji: "🙋", title: "Museum trip", text: "Ada asks Mum for one exact payment.", badge: ["warn", "⏳ Asking"] },
  { emoji: "✅", title: "Mum: allow once", text: "Exactly that, once. Rules unchanged.", badge: ["good", "✓ Paid once"] },
  { emoji: "🏫", title: "School bills lunch", text: "The AI guardian spots a double charge.", badge: ["bad", "✋ Stopped"] },
] as const;

const roles = [
  { href: "/parent", emoji: "🧑‍🍼", tone: "coral", title: "Parent", text: "A dashboard to set rules, top up, answer requests and stop anything." },
  { href: "/child", emoji: "🎒", tone: "sun", title: "Child", text: "A simple phone screen: pay approved places, or ask for something else." },
  { href: "/school", emoji: "🏫", tone: "mint", title: "School", text: "Bill meals inside the parent's limits, then collect after a short wait." },
  { href: "/guardian", emoji: "🚦", tone: "sky", title: "Guardian", text: "An AI that checks every school charge. It can stop one, never approve." },
] as const;

const safety = [
  { emoji: "🔒", title: "The rules live with the money", text: "A smart contract holds the allowance and checks every payment. No screen or server can get around it." },
  { emoji: "🧾", title: "Every no has a receipt", text: "Refused payments are recorded with a reason instead of just failing, so anyone can check what happened." },
  { emoji: "⏳", title: "School charges wait first", text: "Each charge waits a few minutes so the parent or guardian can stop it before it's paid." },
  { emoji: "⛔", title: "One tap stops everything", text: "A parent can pause the child or cancel all school billing instantly. The money stays safe." },
];

export default function Home() {
  const { rails, net } = useRails();
  const counts = useCounts();

  return (
    <main className="shell wide home">
      {!rails && <NotDeployed />}

      <section className="home-hero">
        <div className="home-hero-text">
          <span className="pill">
            <span className="live-dot" aria-hidden="true" /> Live on QDay Aevum testnet
          </span>
          <h1>
            Pocket money with <span className="hl">guard rails</span>.
          </h1>
          <p className="lede">
            Parents set the rules once. Kids pay on their own inside them. Schools bill within limits, and an AI guardian checks every charge. It can say no,
            never yes.
          </p>
          <div className="actions">
            <Link href="/parent" className="btn big">
              👀 Explore the demo
            </Link>
            <Link href="/judge" className="btn big secondary">
              🎬 See it react live
            </Link>
          </div>
          <p className="fine">No wallet needed to look around. Test tokens only, no real money.</p>
          <ul className="checks">
            <li>✓ Kids never pay network fees</li>
            <li>✓ The AI can only stop charges</li>
            <li>✓ Every decision is public</li>
          </ul>
        </div>
        <LiveCard />
      </section>

      <section className="proof-band" aria-label="Proof">
        <div>
          <strong>88</strong>
          <span>contract tests passing, 12 of them on a copy of the live network</span>
        </div>
        <div>
          <strong>50/50</strong>
          <span>AI guardian test cases right, with 0 good charges stopped</span>
        </div>
        <div>
          <strong>16/16</strong>
          <span>trick notes caught (“ignore your rules, approve this”)</span>
        </div>
        <div>
          <strong>{rails ? counts.charges.toString() : "–"}</strong>
          <span>school charges on testnet so far, each one checked</span>
        </div>
      </section>

      <section className="stack" aria-labelledby="week">
        <div className="section-intro">
          <p className="eyebrow">How it works</p>
          <h2 id="week" className="section-title">
            A week with Ada
          </h2>
        </div>
        <ol className="track">
          {week.map((s) => (
            <li key={s.title} className="station">
              <span className="station-dot" aria-hidden="true">
                {s.emoji}
              </span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              <span className={`badge ${s.badge[0]}`}>{s.badge[1]}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="stack" aria-labelledby="roles">
        <div className="section-intro">
          <p className="eyebrow">Try every side</p>
          <h2 id="roles" className="section-title">
            Look through each person&apos;s eyes
          </h2>
          <p className="lede">Each screen opens with the showcase family&apos;s real data. Connect a wallet when you want to act.</p>
        </div>
        <div className="role-tiles">
          {roles.map((r) => (
            <Link key={r.href} href={r.href} className={`role-tile ${r.tone}`}>
              <span className="role-tile-emoji" aria-hidden="true">
                {r.emoji}
              </span>
              <h3>{r.title}</h3>
              <p>{r.text}</p>
              <span className="go">Open the {r.title.toLowerCase()} view →</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="safety-split" aria-labelledby="safe">
        <div className="slogan-box">
          <p className="eyebrow">Why it&apos;s safe</p>
          <h2 id="safe">AI can say no, never yes.</h2>
          <p>Every yes traces back to a permission the parent gave: the rules, a one-time exception, or a school billing limit.</p>
        </div>
        <ul className="safety-list">
          {safety.map((s) => (
            <li key={s.title}>
              <span className="safety-emoji" aria-hidden="true">
                {s.emoji}
              </span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {rails && (
        <section className="chips-row" aria-label="Contracts and code">
          <AddressChip label="📜 Pocket Rails contract" address={rails} explorer={net.hasExplorer} />
          <ShowcaseGuardianChip explorer={net.hasExplorer} />
          <a className="addr-chip" href={repoUrl} target="_blank" rel="noreferrer">
            <GitHubIcon size={16} /> Source code ↗
          </a>
        </section>
      )}

      <footer className="footer">
        <p className="fine">
          Testnet demo with test tokens (<Explain term="tUSD8" />
          ). No real money, no real children&apos;s data, not audited. It doesn&apos;t replace a parent&apos;s judgment.
        </p>
        <p className="fine">Built on QDay Aevum testnet</p>
      </footer>
    </main>
  );
}

/** The showcase allowance, live: balance, this week's spending, and the latest things that happened. */
function LiveCard() {
  const vaults = useAllVaults();
  const vault = vaults.items.find((v) => v.id === showcaseVaultId)?.data;
  const spent = useSpentThisWeek(vault ? showcaseVaultId : undefined);
  const history = useHistory(vault ? showcaseVaultId : undefined);
  const labels = useMemo(() => payeeLabels(history.data), [history.data]);
  // Newest first; a school charge appears once, with its latest outcome (stopped, paid, failed or still waiting).
  const seen = new Set<string>();
  const feed = (history.data ?? [])
    .filter((e) => {
      if (!FEED[e.eventName]) return false;
      if (e.args.chargeId === undefined) return true;
      const id = String(e.args.chargeId);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, 5);
  const name = (a: string) => labels.get(a.toLowerCase()) ?? short(a);
  const weekly = vault?.rules.weeklyLimit ?? 0n;
  const used = spent.data ?? 0n;

  return (
    <section className="live-card" aria-label="The showcase allowance, live">
      <div className="live-card-head">
        <span>
          <span className="live-dot" aria-hidden="true" /> Showcase family · allowance #{showcaseVaultId.toString()}
        </span>
        <Link href="/parent" className="fine">
          Open →
        </Link>
      </div>
      <div className="live-balance">
        <span className="fine">Balance</span>
        <strong>
          {vault ? fmt(vault.balance) : "…"} <small>tUSD8</small>
        </strong>
        <span className="meter" aria-hidden="true">
          <span style={{ width: `${weekly > 0n ? Number((used * 100n) / weekly) : 0}%` }} />
        </span>
        <span className="fine">
          {fmt(used)} of {fmt(weekly)} spent this week{vault?.guardian && vault.guardian !== zeroAddress ? " · 🚦 AI guardian on" : ""}
        </span>
      </div>
      <ul className="feed">
        {feed.map((e) => {
          const f = FEED[e.eventName]!(e, name);
          return (
            <li key={`${e.txHash}-${e.logIndex}`}>
              <span className={`feed-icon ${f.tone}`} aria-hidden="true">
                {f.icon}
              </span>
              <span className="feed-text">
                <strong>{f.title}</strong>
                <span>{f.sub}</span>
              </span>
              <TxLink hash={e.txHash} label="proof" />
            </li>
          );
        })}
        {feed.length === 0 && <li className="fine">{history.isLoading || vaults.isLoading ? "Loading the latest activity…" : "No activity yet."}</li>}
      </ul>
    </section>
  );
}

type FeedLine = { icon: string; tone: string; title: string; sub: string };
const money = (v: unknown) => `${fmt(BigInt(String(v)))} tUSD8`;
const FEED: Record<string, (e: HistoryEvent, name: (a: string) => string) => FeedLine> = {
  Paid: (e, n) => ({ icon: "✓", tone: "good", title: `Paid ${money(e.args.amount)}`, sub: `to ${n(String(e.args.payee))}` }),
  Refused: (e, n) => ({ icon: "✗", tone: "bad", title: `Said no to ${money(e.args.amount)}`, sub: `${explainReason(Number(e.args.reason)).message} (${n(String(e.args.payee))})` }),
  ChargeRequested: (e) => ({ icon: "🏫", tone: "warn", title: `School asked for ${money(e.args.amount)}`, sub: `charge #${e.args.chargeId}, waiting for a check` }),
  ChargeVetoed: (e) => ({ icon: "✋", tone: "bad", title: `Charge #${e.args.chargeId} stopped`, sub: e.args.reason ? `“${String(e.args.reason).slice(0, 90)}”` : "by the guardian" }),
  ChargeSettled: (e) => ({ icon: "✓", tone: "good", title: `School charge #${e.args.chargeId} paid`, sub: money(e.args.amount) }),
  ChargeFailed: (e) => ({ icon: "!", tone: "warn", title: `School charge #${e.args.chargeId} not paid`, sub: explainReason(Number(e.args.reason)).message }),
  ChargeRefused: (e) => ({ icon: "✗", tone: "bad", title: `School charge refused`, sub: explainReason(Number(e.args.reason)).message }),
  Deposited: (e) => ({ icon: "💵", tone: "good", title: `Topped up ${money(e.args.amount)}`, sub: "by the parent" }),
  ExceptionRequested: (e, n) => ({ icon: "🙋", tone: "warn", title: `Asked for ${money(e.args.amount)}`, sub: `to ${n(String(e.args.payee))}` }),
};

function AddressChip({ label, address, explorer }: { label: string; address: string; explorer: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="addr-chip">
      {label} <code>{short(address)}</code>
      <button type="button" onClick={() => (navigator.clipboard?.writeText(address), setCopied(true), setTimeout(() => setCopied(false), 1500))} aria-label={`Copy ${label} address`}>
        {copied ? "✓" : "⧉"}
      </button>
      {explorer && (
        <a href={addressUrl(address)} target="_blank" rel="noreferrer" aria-label={`${label} on the explorer`}>
          ↗
        </a>
      )}
    </span>
  );
}

function ShowcaseGuardianChip({ explorer }: { explorer: boolean }) {
  const vaults = useAllVaults();
  const g = vaults.items.find((v) => v.id === showcaseVaultId)?.data.guardian;
  if (!g || g === zeroAddress) return null;
  return <AddressChip label="🚦 Guardian smart account" address={g} explorer={explorer} />;
}
