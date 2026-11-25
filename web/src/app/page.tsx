"use client";

import { addressUrl } from "@aevum-kit/aevum";
import Link from "next/link";
import { Explain, Guide } from "@/components/help";
import { NotDeployed } from "@/components/ui";
import { repoUrl } from "@/lib/env";
import { useCounts, useRails } from "@/lib/rails";

/** A short story that explains the whole product before any jargon. */
const story = [
  { emoji: "🧑‍🍼", title: "Mum sets the rules once", text: "The school canteen is okay. Up to 0.50 a payment, 2 a week, until the end of term.", badge: ["info", "📋 Rules, version 1"] },
  { emoji: "🎒", title: "Ada buys lunch", text: "0.30 at the canteen. It's inside the rules, so it just works. Nobody has to approve it.", badge: ["good", "✓ Paid"] },
  { emoji: "🍫", title: "Ada tries a big snack", text: "0.80 is more than one payment allows. The app tells her why, kindly, and what she can do.", badge: ["bad", "✗ Not this time"] },
  { emoji: "🙋", title: "Ada asks for the museum trip", text: "She sends Mum a request for one exact payment: the museum, 1.20, “school trip”.", badge: ["warn", "⏳ Waiting for Mum"] },
  { emoji: "✅", title: "Mum taps “Allow once”", text: "Ada pays exactly that, once. The everyday rules stay the same.", badge: ["good", "✓ Paid, once"] },
  { emoji: "🏫", title: "The school bills lunch", text: "Each charge waits a few minutes first. The guardian spots a double charge and stops it.", badge: ["warn", "🛡️ Stopped"] },
] as const;

const roles = [
  { href: "/parent", emoji: "🧑‍🍼", title: "I'm a parent", text: "Set the rules, top up, answer requests, and stop anything with one tap." },
  { href: "/child", emoji: "🎒", title: "I'm a child", text: "See your money, pay approved places, and ask when you need something else." },
  { href: "/school", emoji: "🏫", title: "I'm a school", text: "Bill meals or transport, inside the limits a parent agreed to." },
  { href: "/guardian", emoji: "🛡️", title: "I'm a guardian", text: "Check school charges and stop the wrong ones. That's all a guardian can do." },
];

const safety = [
  { emoji: "🔒", title: "The rules live with the money", text: "A smart contract holds the allowance and checks every payment. No screen or server can get around it." },
  { emoji: "🙅", title: "AI can say no, never yes", text: "The guardian, even an AI one, can only stop charges. Every yes comes from rules or a permission the parent gave." },
  { emoji: "🧾", title: "Every decision has a receipt", text: "Payments, refusals, requests and rule changes are all recorded publicly, so anyone can check them." },
  { emoji: "⛔", title: "One tap stops everything", text: "A parent can pause the child or cancel all school billing instantly. The money stays safe." },
];

export default function Home() {
  const { rails, net } = useRails();
  const counts = useCounts();

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Pocket money with guard rails</p>
        <h1>Let kids pay on their own, safely.</h1>
        <p className="lede">
          Parents set the rules once. Children pay freely inside them. Schools bill within limits. Here&apos;s how a week looks for Ada:
        </p>
      </section>

      {!rails && <NotDeployed />}

      <section className="story" aria-label="A week with Pocket Rails">
        {story.map((p) => (
          <article key={p.title} className="panel">
            <span className="panel-emoji" aria-hidden="true">
              {p.emoji}
            </span>
            <h2 className="panel-title">{p.title}</h2>
            <p className="panel-text">{p.text}</p>
            <span className={`badge ${p.badge[0]}`}>{p.badge[1]}</span>
          </article>
        ))}
      </section>

      <p className="story-line">
        Freedom for kids. <span>Guard rails</span> for parents.
      </p>

      <section className="stack" aria-labelledby="who">
        <h2 id="who" className="section-title">
          Who are you?
        </h2>
        <div className="roles">
          {roles.map((r) => (
            <Link key={r.href} href={r.href} className="card role">
              <span className="role-emoji" aria-hidden="true">
                {r.emoji}
              </span>
              <h3>{r.title}</h3>
              <p>{r.text}</p>
              <span className="go">Open →</span>
            </Link>
          ))}
        </div>
      </section>

      <Guide emoji="🚀" title="New here? Try the demo in three steps" action={{ label: "Start as a parent", href: "/parent" }}>
        1. As the parent, open an allowance (the form is filled in for you) and top it up. 2. Switch your wallet to the child account and make
        a payment. 3. As the parent, grant school billing and watch the guardian at work.
      </Guide>

      <section className="stack" aria-labelledby="safe">
        <h2 id="safe" className="section-title">
          Why it&apos;s safe
        </h2>
        <div className="safety">
          {safety.map((s) => (
            <div key={s.title} className="card">
              <span className="safety-emoji" aria-hidden="true">
                {s.emoji}
              </span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="slogan">“AI can say no, never yes. Every yes traces back to a permission the parent gave.”</p>
      </section>

      {rails && (
        <section className="stack" aria-labelledby="proof">
          <h2 id="proof" className="section-title">
            Live on Aevum <Explain term="onChain" label="On-chain" />
          </h2>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">💰 Allowances</span>
              <span className="stat-value">{counts.vaults.toString()}</span>
            </div>
            <div className="stat">
              <span className="stat-label">🙋 Requests to parents</span>
              <span className="stat-value">{counts.exceptions.toString()}</span>
            </div>
            <div className="stat">
              <span className="stat-label">🏫 School charges</span>
              <span className="stat-value">{counts.charges.toString()}</span>
            </div>
            <div className="stat">
              <span className="stat-label">📜 The contract</span>
              <span className="stat-note">
                {net.hasExplorer ? (
                  <a href={addressUrl(rails)} target="_blank" rel="noreferrer">
                    See it on the explorer ↗
                  </a>
                ) : (
                  <code>{rails.slice(0, 10)}…</code>
                )}
              </span>
              <span className="stat-note">
                <a href={repoUrl} target="_blank" rel="noreferrer">
                  Read the code ↗
                </a>
              </span>
            </div>
          </div>
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
