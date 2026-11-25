"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";

/** Plain-language explanations for every term a first-time visitor might not know. */
export const GLOSSARY = {
  tUSD8: "A test version of a US-dollar stablecoin on Aevum testnet. 1 tUSD8 is meant to equal 1 US dollar. It isn't real money.",
  allowance: "Money a parent puts aside for a child, with rules about where and how much the child can spend.",
  rules: "Where your child can pay, how much per payment, how much per week, and when access ends. Every change gets a new version number.",
  approvedPlace: "A shop or service the parent has said yes to in advance, like the school canteen. Paying anywhere else needs an exception.",
  exception: "A one-time yes from the parent for one exact payment: the same place, amount and note, once. It never changes the standing rules.",
  gas: "The small network fee every blockchain transaction costs. Children never pay it: a relayer pays it for them.",
  relayer: "The app's server. It submits a child's signed payment and pays the network fee, but it can't change the payment or break the rules.",
  vetoWindow: "How long a school charge waits before it can be paid. During this time the parent or guardian can stop it.",
  guardian: "A helper, which can be an AI agent, that reviews school charges. It can only say no. Only the parent can say yes.",
  refusal: "When a payment breaks a rule, nothing is paid, but the refusal is still recorded on the blockchain with a reason, so anyone can check it.",
  onChain: "Recorded on the Aevum blockchain, where anyone can check it with the transaction link. Nobody can quietly change it.",
  billing: "Permission for a school to request charges from an allowance, up to limits the parent sets, and only until a date the parent picks.",
} as const;

export type Term = keyof typeof GLOSSARY;

/**
 * A small "?" that opens a plain-language explanation. Built from inline elements only (a button and a
 * span), so it can sit inside a sentence or a paragraph. Click or Enter opens it; Escape, clicking away or
 * moving focus closes it.
 */
export function Explain({ term, label }: { term: Term; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="explain" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button
        type="button"
        className="explain-btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`What does ${label ?? term} mean?`}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open && (
        <span id={id} className="explain-body" role="note">
          {label && <strong>{label}: </strong>}
          {GLOSSARY[term]}
        </span>
      )}
    </span>
  );
}

/** The "What to do next" box at the top of each page. One clear next step, never a wall of options. */
export function Guide({
  emoji,
  title,
  children,
  action,
}: {
  emoji: string;
  title: string;
  children?: ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
}) {
  return (
    <section className="guide" aria-label="What to do next">
      <span className="guide-emoji" aria-hidden="true">
        {emoji}
      </span>
      <div>
        <p className="guide-title">{title}</p>
        {children && <p className="guide-text">{children}</p>}
        {action && (
          <div className="actions">
            {action.href ? (
              <Link className="btn small" href={action.href}>
                {action.label}
              </Link>
            ) : (
              <button type="button" className="btn small" onClick={action.onClick}>
                {action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
