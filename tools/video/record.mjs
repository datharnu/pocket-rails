// Records the demo on the LIVE site with a scripted browser, timed to the narration in out/voice/.
//   npm run record              (full take; sends one child refusal, one child payment and one trick note on Aevum)
//   DRY=1 npm run record        (rehearsal: same screens, but no payment and no trick note are sent)
//
// The wallet in the video is a small test wallet injected into the page. It answers with the Parent or Child test
// address and signs in Node with the keys from examples/.env: the keys never enter the page or the video.
// It refuses to send transactions; the child's payments are signatures that the app's relayer submits.
import { readFile, mkdir, writeFile, rm, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { privateKeyToAccount } from "viem/accounts";

const SITE = process.env.SITE ?? "https://web-production-b9d9f11e.up.railway.app";
const RPC = "https://rpc-test.qday.info";
const DRY = process.env.DRY === "1";
const dir = import.meta.dirname;
const out = path.join(dir, "out");
const { durations } = JSON.parse(await readFile(path.join(out, "voice/durations.json"), "utf8"));

// Test keys, read in Node only.
const envText = await readFile(path.join(dir, "../../examples/.env"), "utf8");
const keyOf = (name) => {
  const v = envText.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim().replace(/"/g, "");
  if (!v) throw new Error(`${name} missing in examples/.env`);
  return v.startsWith("0x") ? v : `0x${v}`;
};
const accounts = { parent: privateKeyToAccount(keyOf("PARENT_KEY")), child: privateKeyToAccount(keyOf("CHILD_KEY")) };
let who = "parent"; // whose address the test wallet answers with ("none" = disconnected)

// ---------------------------------------------------------------------------------------------- browser
await rm(path.join(out, "raw"), { recursive: true, force: true });
await mkdir(path.join(out, "raw"), { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: path.join(out, "raw"), size: { width: 1920, height: 1080 } },
});

// The test wallet's Node side.
function toTyped(json) {
  const { domain, types, primaryType, message } = JSON.parse(json);
  delete types.EIP712Domain;
  const fix = (type, value) => {
    if (/^u?int\d*$/.test(type)) return BigInt(value);
    if (types[type]) return Object.fromEntries(types[type].map((f) => [f.name, fix(f.type, value[f.name])]));
    return value;
  };
  const d = { ...domain };
  if (d.chainId !== undefined) d.chainId = Number(d.chainId);
  return { domain: d, types, primaryType, message: fix(primaryType, message) };
}
await context.exposeBinding("__testWallet", async (_src, method, params) => {
  const me = who === "none" ? undefined : accounts[who];
  switch (method) {
    case "eth_accounts":
    case "eth_requestAccounts":
      return me ? [me.address] : [];
    case "eth_chainId":
      return "0xabe5";
    case "net_version":
      return "44005";
    case "wallet_switchEthereumChain":
    case "wallet_addEthereumChain":
    case "wallet_requestPermissions":
      return null;
    case "eth_signTypedData_v4": {
      if (!me || params[0].toLowerCase() !== me.address.toLowerCase()) throw new Error("wrong account");
      if (DRY) throw new Error("DRY run: not signing");
      return me.signTypedData(toTyped(params[1]));
    }
    case "eth_sendTransaction":
    case "eth_sendRawTransaction":
      throw new Error("The video wallet doesn't send transactions.");
    default: {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    }
  }
});

// Page side: the EIP-1193 provider, a visible cursor and a caption strip.
await context.addInitScript(() => {
  const listeners = {};
  const provider = {
    isMetaMask: true,
    request: ({ method, params }) => window.__testWallet(method, params ?? []),
    on: (e, f) => ((listeners[e] ??= []).push(f), provider),
    removeListener: (e, f) => ((listeners[e] = (listeners[e] ?? []).filter((x) => x !== f)), provider),
    emit: (e, ...a) => (listeners[e] ?? []).forEach((f) => f(...a)),
  };
  window.ethereum = provider;
  window.__emit = provider.emit;
  const announce = () =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "6b0f0c5e-video-wallet", name: "MetaMask", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "io.metamask" }, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();

  const css = `#__cur{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:transform .05s}
#__cur svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}
#__cur.down{transform:translate(-3px,-2px) scale(.85)}
#__cap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483646;pointer-events:none;background:rgba(31,42,68,.92);color:#fff;font:600 17px Inter,system-ui,sans-serif;padding:10px 18px;border-radius:999px;opacity:0;transition:opacity .3s;white-space:nowrap}
#__cap.on{opacity:1}`;
  const setup = () => {
    document.documentElement.style.zoom = "1.25"; // 1536x864 layout, drawn crisp at 1920x1080
    if (document.getElementById("__cur")) return;
    const s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
    const c = document.createElement("div");
    c.id = "__cur";
    c.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.6-3.6 6.9z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    document.body.appendChild(c);
    const cap = document.createElement("div");
    cap.id = "__cap";
    document.body.appendChild(cap);
    const pos = window.__curPos ?? { x: 760, y: 430 };
    c.style.left = `${pos.x}px`;
    c.style.top = `${pos.y}px`;
    addEventListener("mousemove", (e) => {
      c.style.left = `${e.clientX}px`;
      c.style.top = `${e.clientY}px`;
      sessionStorage.setItem("__cur", JSON.stringify({ x: e.clientX, y: e.clientY }));
    }, true);
    addEventListener("mousedown", () => c.classList.add("down"), true);
    addEventListener("mouseup", () => c.classList.remove("down"), true);
  };
  try {
    window.__curPos = JSON.parse(sessionStorage.getItem("__cur") ?? "null") ?? undefined;
  } catch {}
  window.__caption = (t) => {
    setup();
    const cap = document.getElementById("__cap");
    if (!t) return cap.classList.remove("on");
    cap.textContent = t;
    cap.classList.add("on");
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", setup);
  else setup();
});

const page = await context.newPage();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const marks = {};
const cuts = []; // [from, to] stretches of pure waiting (no narration) that the editor removes
let voiceUntil = 0;
const log = (m) => console.log(`${now().toFixed(1).padStart(6)}s  ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts a narration part now; resolves when it has finished playing (plus a short breath). */
function say(id, pad = 0.35) {
  marks[id] = now();
  voiceUntil = marks[id] + durations[id] + 0.4;
  log(`voice ${id} (${durations[id].toFixed(1)}s)`);
  return sleep((durations[id] + pad) * 1000);
}
const caption = (t) => page.evaluate((x) => window.__caption?.(x), t).catch(() => {});
let cur = { x: 960, y: 540 };
async function glide(x, y, ms = 700) {
  const steps = Math.max(8, Math.round(ms / 16));
  await page.mouse.move(x, y, { steps });
  cur = { x, y };
}
async function point(locator, ms = 700) {
  const l = locator.first();
  await l.scrollIntoViewIfNeeded().catch(() => {});
  const b = await l.boundingBox();
  if (!b) return log("point: not visible");
  await glide(b.x + Math.min(b.width / 2, 120), b.y + b.height / 2, ms);
}
async function click(locator) {
  await point(locator, 600);
  await sleep(150);
  await locator.first().click();
}
async function typeSlow(locator, text) {
  await click(locator);
  await locator.first().fill("");
  await locator.first().type(text, { delay: 140 });
}
async function go(url) {
  await page.goto(`${url.startsWith("http") ? "" : SITE}${url}`, { waitUntil: "domcontentloaded" });
  await page.mouse.move(cur.x, cur.y);
}
async function scrollTo(locator, block = "center") {
  await locator.first().evaluate((el, b) => el.scrollIntoView({ behavior: "smooth", block: b }), block).catch(() => {});
  await sleep(900);
}
/** Runs a wait (page load, relayer, guardian); the part of it with no narration playing is cut in editing. */
async function waiting(fn) {
  const t = now();
  const r = await fn();
  const from = Math.max(t + 0.4, voiceUntil);
  const to = now() - 0.7;
  if (to - from > 1.2) {
    cuts.push([from, to]);
    log(`cut ${(to - from).toFixed(1)}s of waiting`);
  }
  return r;
}

async function connect(as) {
  who = as;
  // Wait until the app has started (the header's wallet button only appears once it has), then connect if needed:
  // after a page load the app may already have reconnected by itself.
  const btn = page.locator("header").getByRole("button", { name: /connect wallet/i });
  const done = page.locator("header").getByRole("button", { name: /0x[0-9a-f]{2}/i });
  await Promise.race([btn.waitFor({ timeout: 30000 }), done.waitFor({ timeout: 30000 })]);
  await sleep(500);
  if (!(await done.isVisible().catch(() => false))) {
    await click(btn);
    const option = page.getByRole("button", { name: /metamask|browser wallet|injected/i });
    await option.first().waitFor({ timeout: 10000 });
    await click(option);
    await done.waitFor({ timeout: 15000 });
  }
  await sleep(400);
}
async function switchTo(as) {
  who = as;
  const addr = as === "none" ? [] : [accounts[as].address];
  await page.evaluate((a) => window.__emit?.("accountsChanged", a), addr);
  await sleep(800);
}

// ---------------------------------------------------------------------------------------------- the take
log(DRY ? "DRY rehearsal: nothing is signed or sent" : "FULL take");

// Pre-roll: load the homepage and wait for live data (trimmed off later).
who = "none";
await go("/");
await page.getByText(/Showcase family/).waitFor({ timeout: 30000 });
await page.getByText(/proof/).first().waitFor({ timeout: 30000 }).catch(() => {});
await sleep(1500);
marks.start = now();

// Scene 1: the problem
{
  const v = say("s1");
  await sleep(600);
  await point(page.locator("h1"), 1200);
  await sleep(6000);
  await point(page.locator(".live-balance"), 1200);
  await sleep(3500);
  await point(page.locator(".feed li").nth(0), 900);
  await sleep(1500);
  await point(page.locator(".feed li").nth(2), 900);
  await v;
}

// Scene 2: the parent's rules
{
  await waiting(async () => {
    await go("/parent");
    await page.locator(".dash").waitFor({ timeout: 20000 });
  });
  const v = say("s2");
  await connect("parent");
  await page.locator(".kpis").waitFor({ timeout: 20000 });
  await point(page.locator(".kpi").nth(0), 800);
  await sleep(1200);
  await point(page.locator(".kpi").nth(1), 700);
  await sleep(900);
  await click(page.getByRole("button", { name: /Rules & places/ }));
  await page.getByText(/Approved places/).first().waitFor({ timeout: 10000 });
  await point(page.getByText("School canteen").first(), 900);
  await sleep(2500);
  await point(page.getByText("Per payment").first(), 900);
  await sleep(1500);
  await v;
}

// Scene 3: the child pays
let refusalUrl;
{
  await waiting(async () => {
    await switchTo("child");
    await go("/child");
    await page.locator(".wallet-card").waitFor({ timeout: 20000 });
    await page.locator(".place").first().waitFor({ timeout: 20000 });
  });
  const v1 = say("s3a");
  await click(page.locator(".place").first());
  await typeSlow(page.locator(".amount-input"), "0.6");
  await page.locator(".preview.bad").waitFor({ timeout: 15000 }).catch(() => log("no preview shown"));
  await scrollTo(page.locator(".preview"));
  await point(page.locator(".preview"), 800);
  await v1;

  const v2 = say("s3b");
  if (!DRY) {
    await click(page.getByRole("button", { name: /^Pay/ }));
    await waiting(() => page.getByText(/didn.t go through/).waitFor({ timeout: 90000 }));
    await point(page.getByText(/didn.t go through/), 700);
    await sleep(1200);
    refusalUrl = await page.getByRole("link", { name: /See the record/ }).first().getAttribute("href");
    await point(page.getByRole("link", { name: /See the record/ }), 700);
    await sleep(500);
    await waiting(async () => {
      await go(`${refusalUrl}?tab=logs`);
      await page.getByText(/Refused/).first().waitFor({ timeout: 30000 }).catch(() => log("explorer: no decoded log text"));
    });
    await sleep(800);
    await point(page.getByText(/Refused/).first(), 900);
    await sleep(6000); // hold on the hash and reason code
  } else await sleep(9000);
  await v2;

  await waiting(async () => {
    await go("/child");
    await page.locator(".place").first().waitFor({ timeout: 20000 });
  });
  const v3 = say("s3c");
  await click(page.locator(".place").first());
  await typeSlow(page.locator(".amount-input"), "0.3");
  await page.locator(".preview.good").waitFor({ timeout: 15000 }).catch(() => {});
  await scrollTo(page.locator(".preview"));
  await point(page.locator(".preview"), 600);
  if (!DRY) {
    await click(page.getByRole("button", { name: /^Pay/ }));
    await waiting(() => page.locator(".notice.good").waitFor({ timeout: 90000 }));
    await point(page.locator(".notice.good"), 800);
  }
  await v3;
}

// Scene 4: school billing
{
  await waiting(async () => {
    await switchTo("parent");
    await go("/parent#school");
    await page.getByText(/Billing permissions/).first().waitFor({ timeout: 20000 });
  });
  const v = say("s4");
  const perm = page.getByText(/max .* per charge/).first();
  await scrollTo(perm);
  await point(perm, 900);
  await sleep(6500);
  await click(page.getByRole("button", { name: /^.*History$/ }));
  const settled = page.locator(".tl-text", { hasText: /settled/ }).first();
  await settled.waitFor({ timeout: 20000 }).catch(() => {});
  const text = (await settled.textContent().catch(() => "")) ?? "";
  const id = text.match(/#(\d+)/)?.[1];
  const requested = id ? page.locator(".tl-text", { hasText: new RegExp(`School charge #${id}:`) }).first() : settled;
  await caption("Recorded earlier");
  await scrollTo(requested);
  await point(requested, 900);
  await sleep(2200);
  await point(settled, 900);
  await v;
  await caption("");
}

// Scene 5: the AI guardian
{
  const card = page.locator(".card", { hasText: "Send a trick note" }).first();
  await waiting(async () => {
    await go("/judge");
    await card.waitFor({ timeout: 20000 });
    await page.getByText(/Latest charges/).first().waitFor({ timeout: 20000 });
    await scrollTo(card);
  });
  const v1 = say("s5a");
  await point(card, 900);
  await sleep(1500);
  if (!DRY) {
    await click(card.getByRole("button", { name: /Try it/ }));
    await caption("Live on Aevum testnet · waiting time shortened in editing");
    await waiting(() => page.getByText(/Vetoed by the guardian smart account/).waitFor({ timeout: 150000 }));
    await caption("");
    await v1;
    const vetoed = page.getByText(/Vetoed by the guardian smart account/);
    await scrollTo(vetoed);
    await point(vetoed, 700);
  } else await v1;
  await say("s5b");
}

// Scene 6: proof and control
{
  const row = page.locator("tr", { hasText: "SYSTEM NOTICE" }).first();
  await waiting(async () => {
    await switchTo("none");
    await go("/guardian#decisions");
    await row.waitFor({ timeout: 20000 });
  });
  const v1 = say("s6a");
  await scrollTo(row);
  await point(row.locator("td").nth(2), 800);
  await sleep(900);
  await point(row.locator(".why").first(), 700);
  await sleep(700);
  const vetoLink = row.getByRole("link", { name: /See the veto/ });
  const href = await vetoLink.getAttribute("href");
  await point(vetoLink, 600);
  await sleep(400);
  await waiting(async () => {
    await go(href);
    await page.getByText(/^Success$/).first().waitFor({ timeout: 40000 }).catch(() => log("explorer: status not shown"));
    await sleep(1200);
  });
  await sleep(1000);
  await point(page.getByText(/^Transaction hash$/).first(), 900);
  await sleep(3000); // hold on the transaction hash
  await point(page.getByText(/^handleOps$/).first(), 700);
  await sleep(3000); // a user operation from the guardian smart account
  await v1;

  const stopped = page.getByText(/Stopped charges/).first();
  await waiting(async () => {
    await go("/parent#school");
    await connect("parent");
    await stopped.waitFor({ timeout: 20000 });
  });
  const v2 = say("s6b");
  await scrollTo(stopped, "start");
  await point(page.getByRole("button", { name: /Pay it anyway/ }), 900);
  await sleep(4200);
  await click(page.getByRole("button", { name: /Pause & stop/ }));
  await point(page.getByRole("button", { name: /Pause spending/ }), 900);
  await v2;
}

// Scene 7: close
{
  await waiting(async () => {
    await switchTo("none");
    await go("/");
    await page.locator(".proof-band").waitFor({ timeout: 20000 });
    await page.getByText(/proof/).first().waitFor({ timeout: 20000 }).catch(() => {});
  });
  const v = say("s7", 1.2);
  await caption("Testnet only. Test tokens. Not audited.");
  await scrollTo(page.locator(".proof-band"));
  await point(page.locator(".proof-band > div").nth(0), 900);
  await sleep(4200);
  await point(page.locator(".proof-band > div").nth(1), 800);
  await sleep(5000);
  await scrollTo(page.locator(".slogan-box"));
  await point(page.locator(".slogan-box h2"), 1000);
  await v;
}
marks.end = now();
log("done");

await page.close();
await context.close();
await browser.close();
const files = (await readdir(path.join(out, "raw"))).filter((f) => f.endsWith(".webm"));
await rename(path.join(out, "raw", files[0]), path.join(out, "raw/take.webm"));
await writeFile(path.join(out, "marks.json"), JSON.stringify({ dry: DRY, marks, cuts, refusalUrl }, null, 2));
console.log(`Video: out/raw/take.webm, marks: out/marks.json (${(marks.end - marks.start).toFixed(1)}s from scene 1 to the end)`);
