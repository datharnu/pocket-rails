# Hosting Pocket Rails on Railway

One Railway service runs everything judges need, 24/7:

| Process | What it does |
|---|---|
| Web app | The screens, the judge page (`/judge`), the relayer for children's payments, charge notes and the history cache |
| School billing agent | Bills one lunch per school day (weekends skipped) on the showcase allowance, and collects charges after their waiting time |
| Guardian agent | The guardian smart account: checks every charge (rules, then AI review) and vetoes through QDay's bundler |

The judge page's **"See it live"** buttons let a visitor send a labelled, simulated problem charge and watch the guardian or
the contract react within seconds. They are rate-limited (4 per visitor per hour, 30 per day in total).

**Keys on the server:** only the relayer key, the school billing key and the guardian's veto-only session key. The parent,
child and guardian owner keys stay on your computer.

**Cost:** Railway's free trial gives a one-time $5 credit without a card (check [railway.com/pricing](https://railway.com/pricing)
for current terms). One small always-on service should fit for the judging period; if the credit runs low, the Hobby
plan ($5/month) keeps it running. AI reviews use your Anthropic API key (a few dollars at most until 15 Dec).

---

## Before you start: fund the showcase

The hosted agents use allowance #1 on PocketRails v2, guarded by the smart account. Do these once, in MetaMask or the app:

1. **School → Parent:** send the tUSD8 the School account holds back to Parent.
2. **Top up allowance #1:** as Parent, on the Parent page → 💵 Money → top up **1.5 tUSD8** (about 14 school lunches at 0.1).
3. **Gas:** from Parent, send **0.1 tQDAY** to the guardian smart account (`0x4D22c96D456CA81892C925bB2044DD28d21a31B0`) and
   **0.1 tQDAY** to School (`0x8C6a84C3B1463EB302214D8356280aE218e0368F`). Judge demos cost a little gas each.

## Step 1: create the Railway project

1. Go to [railway.com](https://railway.com) and sign up with your GitHub account (the free trial needs no card).
2. **New Project → Deploy from GitHub repo.** Allow Railway to see `datharnu/pocket-rails` (it's private; Railway asks
   for permission to that one repo).
3. Railway finds the `Dockerfile` and `railway.json` and starts a first build. It will fail or be incomplete until the
   variables are set; that's expected.

**Important:** if Railway offered to deploy each folder separately (`web`, `agents`, …), keep one service, delete the
others, and in that service's **Settings** make sure: **Root Directory** is empty, **Builder** is Dockerfile,
**Custom Build Command** is empty, **Custom Start Command** is `node tools/start-all.mjs` (Railway may have filled in
`pnpm --filter web start`, which starts only the web app), and **Watch Paths** is empty.

## Step 2: add the variables

1. In your own terminal (not in a chat), run:
   ```
   cd ~/Desktop/Odun.Dev/pocket-rails
   node tools/railway-vars.mjs
   ```
   It prints every setting the server needs, read from your local `.env` files.
2. In Railway, open the service → **Variables** → **Raw Editor**, paste the block, and replace
   `PASTE_YOUR_ANTHROPIC_API_KEY_HERE` with your Anthropic API key (create one in the Anthropic Console with a low spend
   limit).
3. Save. Railway rebuilds with the new settings.

## Step 3: keep the history and notes between restarts

Service → **Settings → Volumes → Add volume**, mount path **`/app/web/.cache`**. Without it, history and charge notes are
rebuilt after each deploy (the app still works, it's just slower after a restart).

## Step 4: get the public link

Service → **Settings → Networking → Generate Domain**. Open it: you should see the home page. Then check:

- `https://<your-domain>/judge` shows the showcase allowance and the three "Try it" buttons.
- **Deployments → View logs** shows `[web] ✓ Ready`, `[school] billing as 0x8C6a…` and
  `[guardian] smart-account mode: session key 0xE007… (veto-only)`.
- Press **Send a trick note** on the judge page: within about 30 seconds it should say "Vetoed by the guardian smart account".

Send the link to your developer to add to the README and the submission.

## Troubleshooting

| Problem | What to do |
|---|---|
| Build fails | Open the build logs; send the last 20 lines to your developer. |
| Only the web app runs (no `[school]` / `[guardian]` lines, charges never vetoed) | Settings → Deploy → Custom Start Command must be `node tools/start-all.mjs`, not `pnpm --filter web start`. |
| Home page works but the judge page says the live demo isn't switched on | `SCHOOL_KEY`, `DEMO_BILLING_ID` or the billing permission don't match. Re-run `node tools/railway-vars.mjs` and check the values. |
| "Waiting for the guardian" never finishes | Logs should show `[guardian]` lines. If the AI key is wrong you'll see "AI review unavailable"; if the smart account is out of gas, send it tQDAY. |
| Children's payments fail with "relayer is out of gas" | Send the Relayer account a little tQDAY. |
| Credit running low | Railway → Usage. Upgrade to Hobby, or stop the service after judging. |
