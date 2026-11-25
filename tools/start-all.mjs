// Runs the web app and the two agents in one container (used by the Dockerfile on Railway).
// Each process is restarted if it exits, with a growing delay. An agent only starts if its key is set:
//   web app:          always (needs NEXT_PUBLIC_* at build time, RELAYER_PRIVATE_KEY etc. at run time)
//   school agent:     SCHOOL_KEY
//   guardian agent:   GUARDIAN_SESSION_KEY + GUARDIAN_ACCOUNT + GUARDIAN_VALIDATOR (smart-account mode)
import { spawn } from "node:child_process";

const PORT = process.env.PORT || "3000";
const env = { ...process.env, APP_URL: process.env.APP_URL || `http://127.0.0.1:${PORT}` };
const tsx = "agents/node_modules/.bin/tsx";

const procs = [
  { name: "web", cmd: "node_modules/.bin/next", args: ["start", "-p", PORT, "-H", "0.0.0.0"], cwd: "web", enabled: true },
  { name: "school", cmd: tsx, args: ["agents/src/school-biller.ts"], cwd: ".", enabled: Boolean(env.SCHOOL_KEY) },
  {
    name: "guardian",
    cmd: tsx,
    args: ["agents/src/guardian.ts"],
    cwd: ".",
    enabled: Boolean(env.GUARDIAN_SESSION_KEY && env.GUARDIAN_ACCOUNT && env.GUARDIAN_VALIDATOR),
  },
];

const children = new Map();
let stopping = false;

function start(p, attempt = 0) {
  const child = spawn(p.cmd, p.args, { cwd: p.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  children.set(p.name, child);
  const tag = (line) => line && console.log(`[${p.name}] ${line}`);
  child.stdout.on("data", (d) => d.toString().split("\n").forEach(tag));
  child.stderr.on("data", (d) => d.toString().split("\n").forEach(tag));
  child.on("exit", (code) => {
    children.delete(p.name);
    if (stopping) return;
    const delay = Math.min(60_000, 2_000 * 2 ** attempt);
    console.log(`[start-all] ${p.name} exited (${code}); restarting in ${delay / 1000}s`);
    setTimeout(() => start(p, Math.min(attempt + 1, 5)), delay);
  });
}

for (const p of procs) {
  if (p.enabled) start(p);
  else console.log(`[start-all] ${p.name} not started (its settings aren't set)`);
}

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    stopping = true;
    for (const c of children.values()) c.kill(sig);
    setTimeout(() => process.exit(0), 3000);
  });
}
