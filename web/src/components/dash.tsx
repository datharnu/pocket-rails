"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { ReactNode } from "react";
import { short } from "@/lib/rails";

export type NavItem<K extends string> = { key: K; emoji: string; label: string; count?: number };

/**
 * The app layout for the role dashboards: a sidebar (sections, plus who you are at the bottom) and the
 * content. On small screens the sidebar becomes a scrollable strip above the content.
 */
export function DashShell<K extends string>({
  title,
  emoji,
  nav,
  view,
  onView,
  top,
  who,
  children,
}: {
  title: string;
  emoji: string;
  nav: NavItem<K>[];
  view: K;
  onView: (k: K) => void;
  top?: ReactNode;
  who: { label: string; address?: string; demo: boolean };
  children: ReactNode;
}) {
  return (
    <div className="dash">
      <aside className="dash-side" aria-label={`${title} sections`}>
        <div className="dash-role">
          <span className="dash-role-emoji" aria-hidden="true">
            {emoji}
          </span>
          <span>{title}</span>
        </div>
        {top}
        <nav className="dash-nav">
          {nav.map((n) => (
            <button key={n.key} type="button" aria-current={view === n.key ? "page" : undefined} onClick={() => onView(n.key)}>
              <span aria-hidden="true">{n.emoji}</span>
              <span className="dash-nav-label">{n.label}</span>
              {n.count ? <span className="dash-count">{n.count}</span> : null}
            </button>
          ))}
        </nav>
        <div className="dash-who">
          {who.demo ? <span className="badge warn">👀 Demo mode</span> : <span className="badge good">● Connected</span>}
          <span className="fine">
            {who.label}
            {who.address ? <> · <code>{short(who.address)}</code></> : null}
          </span>
        </div>
      </aside>
      <div className="dash-main">{children}</div>
    </div>
  );
}

/** The strip at the top of a page in demo mode: what you're looking at, and how to go live. */
export function DemoBanner({ role, what }: { role: string; what: ReactNode }) {
  return (
    <div className="demo-banner" role="note">
      <div>
        <strong>👀 Demo mode · live testnet data, read-only</strong>
        <span>{what}</span>
      </div>
      <div className="demo-banner-cta">
        <span className="fine">Connect the {role} wallet to act</span>
        <ConnectButton.Custom>
          {({ openConnectModal, mounted }) => (
            <button type="button" className="btn small" disabled={!mounted} onClick={openConnectModal}>
              Connect wallet
            </button>
          )}
        </ConnectButton.Custom>
      </div>
    </div>
  );
}

/** A dashboard number card. */
export function Kpi({ emoji, label, value, unit, note, meter, tone }: { emoji: string; label: string; value: ReactNode; unit?: string; note?: ReactNode; meter?: number; tone?: "coral" | "sun" | "mint" | "sky" }) {
  return (
    <div className={`kpi ${tone ?? ""}`}>
      <span className="kpi-label">
        <span className="kpi-icon" aria-hidden="true">
          {emoji}
        </span>
        {label}
      </span>
      <span className="kpi-value">
        {value} {unit && <small>{unit}</small>}
      </span>
      {meter !== undefined && (
        <span className="meter" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(100, meter))}%` }} />
        </span>
      )}
      {note && <span className="kpi-note">{note}</span>}
    </div>
  );
}

/** A coloured status chip for charges, payments and requests. */
export function Chip({ tone, children }: { tone: "good" | "bad" | "warn" | "info" | "plain"; children: ReactNode }) {
  return <span className={`badge ${tone === "plain" ? "" : tone}`}>{children}</span>;
}

export function PanelHead({ title, sub, action }: { title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel-head">
      <div>
        <h2>{title}</h2>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {action}
    </div>
  );
}
