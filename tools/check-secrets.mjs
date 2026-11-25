// Refuses a commit that contains a private key or a real .env file.
// Runs as a git pre-commit hook (.githooks/pre-commit). Enable once per clone: git config core.hooksPath .githooks
import { execSync } from "node:child_process";

const staged = execSync("git diff --cached --name-only --diff-filter=ACM", { encoding: "utf8" }).split("\n").filter(Boolean);
const problems = [];

for (const f of staged) {
  if (/(^|\/)\.env(\.[^/]*)?$/.test(f) && !f.endsWith(".env.example")) problems.push(`${f}: .env files must never be committed`);
}

// A 32-byte hex value assigned to something named *KEY / *SECRET / *MNEMONIC is almost always a secret.
// anvil's public test keys are allowed (they're documented everywhere and refused on Aevum by the relayer).
const ANVIL = new Set([
  "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
]);
const diff = execSync("git diff --cached -U0 --no-color", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
let file = "";
for (const line of diff.split("\n")) {
  if (line.startsWith("+++ b/")) file = line.slice(6);
  if (!line.startsWith("+") || line.startsWith("+++")) continue;
  const m = /(KEY|SECRET|MNEMONIC|PRIVATE)[A-Z_]*\s*[=:]\s*["']?(0x)?([0-9a-fA-F]{64})\b/i.exec(line);
  if (m && !ANVIL.has(m[3].toLowerCase())) problems.push(`${file}: looks like a private key (${m[0].split(/[=:]/)[0].trim()}=…)`);
}

if (problems.length) {
  console.error("✗ Commit blocked: possible secrets\n  " + problems.join("\n  "));
  console.error("Move them to an ignored .env file. (If this is truly not a secret: git commit --no-verify)");
  process.exit(1);
}
console.log(`✓ secret check: ${staged.length} staged file(s) clean`);
