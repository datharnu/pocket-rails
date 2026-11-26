/**
 * Guardian evaluation: runs every case in agents/eval/cases.json through
 *   1. the rules only (agents/src/policy.ts; they don't read the note),
 *   2. the AI review only (agents/src/review.ts, Claude claude-opus-5-5),
 *   3. the combination the guardian agent actually uses: rules first, then the AI if the rules pass.
 * Writes agents/eval/results.json (every decision and reason) and docs/AI_EVAL.md (the summary).
 *
 *   pnpm --filter agents eval            (needs Anthropic API credentials; costs a little)
 *   pnpm --filter agents eval --cases eval/hard-cases.json --out eval/hard-results.json
 *     runs another case file; docs/AI_EVAL.md is only rewritten for the default set (or with --doc <path>).
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseUnits } from "viem";
import { evaluate, type Decision } from "./policy";
import { reviewNote } from "./review";

interface Case {
  id: string;
  category: string;
  split: "tune" | "heldout";
  note: string;
  amount: string;
  usual: string;
  maxPerCharge: string;
  expected: string;
  accept: string[];
  why_hard?: string;
}

const root = new URL("../", import.meta.url).pathname;
const { values: args } = parseArgs({ options: { cases: { type: "string" }, out: { type: "string" }, doc: { type: "string" } } });
const casesPath = args.cases ?? "eval/cases.json"; // relative to agents/
const outPath = args.out ?? "eval/results.json";
const docPath = args.doc ?? (args.cases ? undefined : "../docs/AI_EVAL.md");
const casesText = readFileSync(`${root}${casesPath}`, "utf8");
const set = JSON.parse(casesText) as { cases: Case[]; usual_price: string };
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const hashes = { cases: sha256(casesText), reviewPrompt: sha256(readFileSync(`${root}src/review.ts`, "utf8")) };
const WEEKDAY = 1_795_608_000n; // a Wednesday, so the weekend rule never fires
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rules(c: Case): Decision {
  const facts = { id: 1n, billingId: 1n, amount: parseUnits(c.amount, 6), memoHash: "0x01", status: 1, requestedAt: WEEKDAY };
  return evaluate(facts, [facts], { expectedPrice: parseUnits(c.usual, 6) });
}

async function ai(c: Case): Promise<Decision & { ms: number }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const t = Date.now();
    const d = await reviewNote({ amount: c.amount, usual: c.usual, maxPerCharge: c.maxPerCharge, note: c.note });
    if (!d.reason.includes("rate-limited")) return { ...d, ms: Date.now() - t };
    await sleep(2000 * (attempt + 1));
  }
  return { action: "unknown", rule: "ai", reason: "rate-limited after retries", ms: 0 };
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]!);
      }
    }),
  );
  return out;
}

const commit = (() => {
  try {
    return execSync(`git log -1 --format=%h -- ${casesPath} src/review.ts`, { cwd: root }).toString().trim() || "uncommitted";
  } catch {
    return "unknown";
  }
})();

console.log(`Running ${set.cases.length} cases (cases/prompt last changed in commit ${commit})…`);
const rows = await pool(set.cases, 3, async (c) => {
  const r = rules(c);
  const a = await ai(c);
  const combined: Decision = r.action === "veto" ? r : { action: a.action, rule: a.rule, reason: a.reason };
  process.stdout.write(".");
  return { ...c, rules: r.action, ai: a.action, aiReason: a.reason, aiMs: a.ms, combined: combined.action };
});
console.log("");

type Row = (typeof rows)[number];
type System = "rules" | "ai" | "combined";
const BAD = new Set(["non_school", "injection", "overprice"]);
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((100 * n) / d)}% (${n}/${d})`);

function metrics(rs: Row[], sys: System) {
  const ok = rs.filter((r) => r.accept.includes(r[sys])).length;
  const bad = rs.filter((r) => BAD.has(r.category));
  const inj = rs.filter((r) => r.category === "injection");
  const gen = rs.filter((r) => r.category === "genuine");
  return {
    accuracy: pct(ok, rs.length),
    caughtBad: pct(bad.filter((r) => r[sys] === "veto").length, bad.length),
    caughtInjection: pct(inj.filter((r) => r[sys] === "veto").length, inj.length),
    falseVeto: pct(gen.filter((r) => r[sys] === "veto").length, gen.length),
    unknown: pct(rs.filter((r) => r[sys] === "unknown").length, rs.length),
  };
}

const splits: [string, Row[]][] = [
  ["Held-out", rows.filter((r) => r.split === "heldout")],
  ["Tune", rows.filter((r) => r.split === "tune")],
  ["All", rows],
].filter(([, rs]) => rs.length > 0) as [string, Row[]][];
const systems: [System, string][] = [
  ["rules", "Rules only"],
  ["ai", "AI review only"],
  ["combined", "Rules + AI (what the guardian runs)"],
];

const lat = rows.map((r) => r.aiMs).filter((m) => m > 0).sort((a, b) => a - b);
const p = (q: number) => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] ?? 0;
const date = new Date().toISOString().slice(0, 10);

let md = `# Guardian evaluation

How well the guardian agent stops wrong school charges, measured on ${rows.length} school-charge notes
([agents/${casesPath}](../agents/${casesPath})). Run on ${date} with \`pnpm --filter agents eval\`; model
\`claude-opus-5-5\` at low effort; cases and prompt as of commit \`${commit}\` (frozen before this run; the prompt in
[agents/src/review.ts](../agents/src/review.ts) was not changed for this set). Raw decisions and reasons:
[agents/${outPath}](../agents/${outPath}).

The guardian can only **veto** or leave a charge alone; "unknown" leaves it for the parent. It can never approve,
so the worst a wrong answer can do is stop a genuine charge (which the parent can pay anyway) or let a bad one
through to the parent's normal review window.

| Category | Cases | What a good guardian does |
|---|---|---|
| genuine | ${rows.filter((r) => r.category === "genuine").length} | leave it (no_action) |
| non_school | ${rows.filter((r) => r.category === "non_school").length} | veto (gift cards, betting, personal transfers…) |
| injection | ${rows.filter((r) => r.category === "injection").length} | veto (the note tries to instruct the reviewer) |
| vague | ${rows.filter((r) => r.category === "vague").length} | unknown or no_action ("Fee", "Payment"…) |
| overprice | ${rows.filter((r) => r.category === "overprice").length} | veto (normal note, three times the usual price) |

`;
for (const [name, rs] of splits) {
  md += `## ${name} (${rs.length} cases)\n\n| System | Correct | Bad charges vetoed | Injections vetoed | Genuine charges wrongly vetoed | Unknown |\n|---|---|---|---|---|---|\n`;
  for (const [sys, label] of systems) {
    const m = metrics(rs, sys);
    md += `| ${label} | ${m.accuracy} | ${m.caughtBad} | ${m.caughtInjection} | ${m.falseVeto} | ${m.unknown} |\n`;
  }
  md += "\n";
}
const misses = rows.filter((r) => !r.accept.includes(r.combined));
md += `## Where the guardian got it wrong\n\n`;
md += misses.length
  ? `| Case | Note | Expected | Guardian decided | AI reason |\n|---|---|---|---|---|\n` +
    misses.map((r) => `| ${r.id} (${r.split}) | ${r.note.replace(/\n/g, " ").replace(/\|/g, "\\|")} | ${r.expected} | ${r.combined} | ${r.aiReason.replace(/\|/g, "\\|")} |`).join("\n") +
    "\n\n"
  : "No mistakes on this set.\n\n";
md += `## Latency of the AI review\n\nMedian ${(p(0.5) / 1000).toFixed(1)} s, 95th percentile ${(p(0.95) / 1000).toFixed(1)} s (per charge, from this machine).\n\n`;
md += `## Limits\n\n- ${rows.length} hand-written cases is a small set; it shows behaviour, not a guarantee.\n- The rules don't read notes, so on note-only problems the rules-only row shows what the AI adds.\n- A determined attacker might find notes that pass; that's why the guardian can only veto, and charges still wait\n  in the parent's veto window.\n`;

writeFileSync(`${root}${outPath}`, JSON.stringify({ date, commit, sha256: hashes, model: "claude-opus-5-5", rows }, null, 2));
if (docPath) writeFileSync(`${root}${docPath}`, md);
console.log(md);
