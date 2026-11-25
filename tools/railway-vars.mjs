// Prints the settings block for Railway's "Raw Editor" (Variables tab), read from your local .env files.
// Run it in YOUR OWN terminal and paste the output into Railway. Don't paste it into a chat or commit it.
//   node tools/railway-vars.mjs
// It only includes what the server needs: the relayer key, the school billing key and the guardian's
// veto-only session key. Parent, child and guardian owner keys are never included.
import { readFileSync } from "node:fs";

function parse(file) {
  const out = {};
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && m[2] !== "") out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* missing file: skip */
  }
  return out;
}

const web = parse("web/.env.local");
const agents = parse("agents/.env");
const need = (v, name) => v || `MISSING_${name}`;

const vars = {
  // public, compiled into the web app at build time
  NEXT_PUBLIC_NETWORKS: "aevum",
  NEXT_PUBLIC_RAILS_AEVUM: need(web.NEXT_PUBLIC_RAILS_AEVUM, "RAILS"),
  NEXT_PUBLIC_RAILS_DEPLOY_BLOCK_AEVUM: need(web.NEXT_PUBLIC_RAILS_DEPLOY_BLOCK_AEVUM, "DEPLOY_BLOCK"),
  NEXT_PUBLIC_DEMO_CHILD: web.NEXT_PUBLIC_DEMO_CHILD ?? "",
  NEXT_PUBLIC_DEMO_SCHOOL: web.NEXT_PUBLIC_DEMO_SCHOOL ?? "",
  NEXT_PUBLIC_DEMO_GUARDIAN: agents.GUARDIAN_ACCOUNT || web.NEXT_PUBLIC_DEMO_GUARDIAN || "",
  NEXT_PUBLIC_REPO_URL: "https://github.com/datharnu/pocket-rails",
  // web server
  RELAYER_PRIVATE_KEY: need(web.RELAYER_PRIVATE_KEY, "RELAYER_KEY"),
  TRUSTED_IP_HEADER: "x-real-ip",
  DEMO_BILLING_ID: web.DEMO_BILLING_ID || "1",
  DEMO_PRICE: "0.1",
  // agents
  RPC_URL: "https://rpc-test.qday.info",
  RAILS_ADDRESS: need(agents.RAILS_ADDRESS, "RAILS"),
  SCHOOL_KEY: need(agents.SCHOOL_KEY, "SCHOOL_KEY"),
  MEAL_PRICE: "0.1",
  BILL_EVERY: "day",
  POLL_SECONDS: "20",
  GUARDIAN_ACCOUNT: need(agents.GUARDIAN_ACCOUNT, "GUARDIAN_ACCOUNT"),
  GUARDIAN_VALIDATOR: need(agents.GUARDIAN_VALIDATOR, "GUARDIAN_VALIDATOR"),
  GUARDIAN_SESSION_KEY: need(agents.GUARDIAN_SESSION_KEY, "SESSION_KEY"),
  BUNDLER_URL: agents.BUNDLER_URL || "https://bundler.qday.info",
  EXPECTED_PRICE: "0.1",
  GUARDIAN_BLOCK_WEEKENDS: "0",
  AI_REVIEW: "1",
  ANTHROPIC_API_KEY: "PASTE_YOUR_ANTHROPIC_API_KEY_HERE",
};

console.error("\n⚠️  Secrets below. Paste them only into Railway → Variables → Raw Editor. Never into a chat or a file in the repo.\n");
console.log(Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n"));
const missing = Object.entries(vars).filter(([, v]) => String(v).startsWith("MISSING_")).map(([k]) => k);
console.error(missing.length ? `\n✗ Missing locally: ${missing.join(", ")}` : "\n✓ Everything found. Replace PASTE_YOUR_ANTHROPIC_API_KEY_HERE with your key.");
