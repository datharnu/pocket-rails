# Pocket Rails: the plain-English guide

This guide explains what Pocket Rails is, how it works and how to test and demo it, without assuming you know
anything about crypto. Read sections 1 to 4 once to understand it. Use sections 6 to 9 when you test or demo. You can look around without any wallet (section 6).

---

## 1. The idea in one minute

Imagine a family money box with a rulebook.

- The **parent** puts money in the box and writes the rules: "you can pay the school canteen, up to 0.50 at a
  time, up to 2 a week, until the end of term."
- The **child** can pay on their own, as long as the payment follows the rules. Nobody has to say yes each time.
- If the child tries something outside the rules, the payment doesn't happen. The child is told why, kindly,
  and can **ask the parent** for a one-time yes.
- The **school** can also take money from the box for things like lunch, but only up to limits the parent
  agreed to, and every school charge **waits a few minutes** before it's paid, so someone can stop it.
- A **guardian** (a helper, which can be an AI) checks school charges and can stop the wrong ones. It can only
  say **no**. It can never say yes or move money.

The box is looked after by a **robot cashier** that follows the rulebook exactly and writes everything it does
in a **public notebook that nobody can erase**. Nobody, not even us, can make it break the rules.

In crypto words: the robot cashier is a **smart contract**, the public notebook is the **blockchain**, and the
money is a test **stablecoin** (a digital dollar). You don't need those words to demo it.

---

## 2. The characters

| Character | Who it is in real life | What they can do | What they can't do |
|---|---|---|---|
| 🧑‍🍼 **Parent** | Mum or Dad | Put money in, set and change the rules, say yes once to a request, give the school permission to bill, approve or stop school charges, pause or stop everything, take money out | (Nothing is off-limits: the parent is in charge) |
| 🎒 **Child** | A secondary-school student | Pay approved places inside the rules, ask the parent for an exception | Break the rules, change them, take money out |
| 🏫 **School** | The school's office, or its billing helper | Ask for money (meals, trips) inside the limits the parent set, and collect it after the waiting time | Take more than the limits, skip the waiting time, send money anywhere except the school's own account |
| 🚦 **Guardian** | A helper, here an AI agent | Stop a school charge that looks wrong during its waiting time | Approve anything, raise a limit, move money |
| 🤖 **Robot cashier** (smart contract) | Code living on the Aevum blockchain | Hold the money, check every payment against the rules, record every decision | Ignore the rules. Nobody can switch it off or change it |
| 📮 **Messenger** (relayer) | The app's server | Deliver the child's payments to the robot cashier and pay the small delivery fee | Change a payment or make one the rules don't allow |

---

## 3. Words you'll hear, in plain English

| Word | What it means |
|---|---|
| **Blockchain** | A shared public notebook. Everything written in it stays there and anyone can check it. |
| **Aevum testnet** | The practice version of the QDay blockchain. Everything works like the real thing, but the money is pretend. |
| **Smart contract** | A program on the blockchain that holds money and follows fixed rules. Ours is called PocketRails. |
| **Wallet / MetaMask** | An app in your browser that holds your accounts. Each account is like a bank account with an address (a long code starting with `0x`). |
| **Account address** | The public name of an account, like an account number. Safe to share. |
| **Private key** | The secret password of an account. Never share it. Whoever has it controls the account. |
| **tUSD8** | Pretend digital dollars on the testnet. 1 tUSD8 is meant to be worth 1 dollar. This is the allowance money. |
| **tQDAY** | Pretend fuel for the blockchain. Every action costs a tiny bit of it (a "fee" or "gas"). The child never pays it; the messenger does. |
| **Transaction** | One action written into the blockchain, like a payment or a rule change. Each one has a receipt number (a "hash"). |
| **Signing** | Approving something in your wallet. For the child, signing is free; the messenger delivers it. |
| **Explorer** | A website where anyone can look up any transaction or account: [explorer-test.qday.info](https://explorer-test.qday.info). It's how judges check our proof. |
| **Refusal** | When a payment breaks a rule. No money moves, but the refusal is still written in the notebook with a reason, so it can be checked. |
| **Exception** | A one-time yes from the parent for one exact payment (same place, amount and note), used once. The everyday rules don't change. |
| **Billing permission** | The parent's written permission for the school to take money, with a limit per charge, a limit per week, an end date and a waiting time. |
| **Waiting time (veto window)** | How long a school charge waits before it can be paid. During this time the parent or guardian can stop ("veto") it. |
| **Agent** | A small program that runs on its own. We have two: the school's billing agent and the guardian agent. |
| **AI review** | The guardian agent asks an AI (Claude) to read the note on a school charge. The AI can only answer "stop it", "leave it" or "not sure". |

---

## 4. How it works: the two directions

### Direction 1: the child pays (the child pushes money out)

1. The child opens the app on their phone, picks an approved place (the canteen), types an amount and taps **Pay**.
2. Before anything is sent, the app checks with the robot cashier and tells the child if it will work.
3. The child approves in their wallet. This is free.
4. The messenger delivers it to the robot cashier.
5. The robot cashier checks the rules:
   - **Inside the rules:** the money goes to the canteen. ✓ Paid.
   - **Outside the rules:** nothing moves. The refusal is written in the notebook with a reason, and the
     child sees a kind explanation and what to do next, like "ask your parent".
6. If the child asks for an exception, the parent sees it and can **allow once** or **decline**. If allowed,
   the child can pay that exact amount, once.
7. The parent can also **set money aside for school** (for example the bus pass). The child can't spend that
   part, but school charges can.

### Direction 2: the school bills (the school pulls money in)

1. The parent gives the school a **billing permission**: for example up to 0.30 per charge, up to 1.50 per
   week, a 2-minute waiting time, and "I want to approve the first charge myself".
2. The school's billing agent sends a charge, for example "Lunch, 0.30".
3. The charge **waits** (2 minutes in our demo). During this time:
   - the **guardian agent** checks it (duplicate? weekend? too expensive? and, with AI, does the note make sense?),
   - the guardian can **stop** it,
   - the parent can **approve** it early, or **stop** it.
4. If nobody stops it, after the waiting time the school collects the money. ✓ Paid to the school's account.
   - **Unless the parent turned on "hold while the guardian is offline"** (Parent → 🚦 Guardian). Then the charge
     also waits for the guardian to come online and "check in" ("I'm here, I've looked"). If the guardian is down,
     the charge just waits: nothing is paid by silence. The showcase allowance has this switched on.
5. If the guardian stopped it by mistake, the parent can still **pay it anyway** (only the parent can).
6. If the school asks for more than the limits, the robot cashier refuses it straight away and writes that down.

### The one-line summary

**"AI can say no, never yes. Every yes traces back to a permission the parent signed."**
The child's payments are allowed by the parent's rules, exceptions by the parent's "allow once", and school
charges by the billing permission the parent gave.

---

## 5. What we built and where it lives

| Piece | Where it is | Does it need you? |
|---|---|---|
| The robot cashier (smart contract) | On Aevum. Current version (v3): `0xa37f27487562a1595768A681Ee21D3e93FFcE05c` ([see it](https://explorer-test.qday.info/address/0xa37f27487562a1595768A681Ee21D3e93FFcE05c?tab=contract)). | No. It's always there. |
| The app (screens + messenger) | Hosted on Railway: **[web-production-b9d9f11e.up.railway.app](https://web-production-b9d9f11e.up.railway.app)** | No. It runs 24/7. (You can still run it on your Mac with `pnpm dev`.) |
| School billing agent | Hosted on Railway, in the same service as the app | No. It bills one lunch per school day on the showcase allowance and collects it after the waiting time. |
| Guardian agent | Hosted on Railway. It acts through the guardian **smart account** `0x3FE5…0382`, whose key can only stop charges (and say "I'm online") | No. It checks every school charge on allowances it guards. |
| Proof | [EVIDENCE.md](EVIDENCE.md) (every feature, live) and [DEMO_RUN.md](DEMO_RUN.md) (the first runs) | No |

**The showcase allowance (#1)** is the family everyone sees: the homepage card, demo mode on every page and the
judge page all show it. It holds about 3 tUSD8 (around 30 lunches) and the hosted agents keep it active. Try not
to pause or revoke it, and if you use it for testing, put back what you take out.

---

## 6. Look around without a wallet (demo mode)

Open the [live app](https://web-production-b9d9f11e.up.railway.app) in any browser. No wallet, no MetaMask.

| Page | What you see |
|---|---|
| **Home** | A live card with the showcase family's balance and latest activity, each with a "proof" link, plus the numbers (tests, AI evaluation) and Ada's week. |
| **🧑‍🍼 Parent** | The parent's dashboard for allowance #1. Use the left menu: **Overview** (balance, spending, money set aside, anything waiting), **Money**, **Rules & places**, **School billing**, **Guardian**, **History**, **Pause & stop**. |
| **🎒 Child** | The child's phone screen. Tap a place and type an amount: it tells you straight away whether it would go through and why. |
| **🏫 School** | The school's dashboard: what it billed, what's waiting, the charges table and its permission. |
| **🚦 Guardian** | What the AI guardian checked, what it stopped and why (with the veto's proof link), and what it can and can't do. |
| **🧑‍⚖️ For judges** | Buttons that send a labelled, simulated problem charge (a duplicate, a trick note, too much money) and show the guardian or the contract react within seconds. |

A yellow **"Demo mode · live testnet data, read-only"** bar explains this. Buttons show but are locked. Connect a
wallet to act; the page then switches to your own account. Each dashboard section has its own link, for
example `web-production-b9d9f11e.up.railway.app/parent#history`.

---

## 7. Your accounts

All are in MetaMask. Balances from 25 Nov 2026, late evening; they change as you test.

| Account | Role | Holds now | Needs |
|---|---|---|---|
| Parent `0xD035…a485` | Parent of allowance #1 (and of #2, the evidence run) | 0.1 tUSD8, 0.51 tQDAY | a little tQDAY for fees |
| Child `0x7961…0d16` | Child of allowance #1 | nothing | nothing (the messenger pays fees) |
| Relayer `0xF534…016E` | Messenger (the app's server) | 0.198 tQDAY | tQDAY for fees (enough for hundreds of payments) |
| School `0x8C6a…368F` | School canteen + billing key of allowance #1 | 0.1 tQDAY | a little tQDAY for fees |
| Guardian `0xEA66…00db` | Owner of the guardian smart account | 0.039 tQDAY | almost nothing |
| Guardian smart account `0x3FE5…0382` | The guardian of allowance #1 (v3) | 0.02 tQDAY | tQDAY for its vetoes (about 0.0003 each) |

Most of the money is inside allowance #1 (3 tUSD8). Lunches paid to the School account can be sent back to
Parent in MetaMask whenever you need tUSD8 for testing.

**Keys:** the private keys live only in files that never go to GitHub: `web/.env.local` (Relayer),
`examples/.env` (Parent, Child) and `agents/.env` (School, Guardian). Railway only has the Relayer key, the
School key and the guardian's veto-only session key. Never paste a key into a file ending in `.example`, and never
paste one into a chat.

---

## 8. Full test with a wallet, step by step

Use the [live app](https://web-production-b9d9f11e.up.railway.app) and MetaMask on **QDay Aevum Testnet** (tUSD8 is
`0x456569838f1d43009A91ebA4263147Afd7233483`, 6 decimals). The app always acts as whichever account MetaMask has
selected: switch accounts in MetaMask, then reload the page if it still shows the old one.

### Part 1: the parent's dashboard (account: Parent)

| # | Do this | You should see |
|---|---|---|
| 1.1 | Open **Parent** and click **Connect Wallet** (choose Parent) | The yellow demo bar goes away, the sidebar shows **● Connected · You**, and the dashboard opens on **allowance #1**. |
| 1.2 | Look at **Overview** | Four cards: Balance, Spent this week (with a bar), Set aside for school, Waiting for a decision. Below: anything waiting, recent activity and "Rules at a glance". |
| 1.3 | Open **Money**. Under **🚌 Set aside for school**, type `1`, click **Save amount set aside**, confirm in MetaMask | "Now 1 is set aside, so your child can spend 2". The rules go up one version. |

### Part 2: the child pays (account: Child)

| # | Do this | You should see |
|---|---|---|
| 2.1 | Switch MetaMask to **Child**, open **Child** | The orange allowance card, "🚌 1 set aside for school · you can spend 2", and "School canteen" as an approved place. |
| 2.2 | Tap **School canteen**, type `0.3`, tap **Pay**, sign in MetaMask (free) | "✓ Inside your rules" before you pay, then **Paid** with a "See the record" link. |
| 2.3 | Type `0.6`, tap **Pay** | Before paying: "✗ This is more than you can spend in one payment." If you pay anyway: **"That didn't go through, and that's okay"**, the reason, and "No money moved. The refusal is recorded on Aevum". |
| 2.4 | Tap **Ask for an exception** (the amount stays 0.6), add a note like `Museum trip snacks`, tap **Send request to parent**, sign | "Request sent. Waiting for your parent." It appears under **📨 My requests**. |

### Part 3: the parent answers (account: Parent)

| # | Do this | You should see |
|---|---|---|
| 3.1 | Switch to **Parent**, open **Parent** | A red **1** next to Overview, and "Your child is asking for something". |
| 3.2 | In **🙋 Requests from your child**, click **Allow once**, confirm | Confirmed. The request disappears. The rules' version number doesn't change. |

### Part 4: the child uses the exception (account: Child)

| # | Do this | You should see |
|---|---|---|
| 4.1 | Switch to **Child**, open **Child** | **Your parent said yes!** |
| 4.2 | Under **📨 My requests**, tap **Pay now**, sign | **Paid**. The request now shows "Used". |
| 4.3 | Type `2`, tap the canteen | "✗ That money is set aside for school costs." (Only what isn't set aside can be spent.) |

### Part 5: school billing and the AI guardian (no wallet needed)

The hosted agents do this part by themselves. Watch it:

| # | Do this | You should see |
|---|---|---|
| 5.1 | On a school day, open **School** → **Charges** | The day's lunch (0.1). It waits 2 minutes, then shows **✓ Paid**. It's paid from the money set aside first. |
| 5.2 | Open **For judges**, click **Send a trick note** | Within about 30 seconds: "Vetoed by the guardian smart account", with the AI's reason. |
| 5.3 | Open **Guardian** → **Decisions** | The trick charge: **✋ Stopped by the guardian**, the reason, and a "See the veto" link. |
| 5.4 | As **Parent**, open **School billing** | The same charge under **✋ Stopped charges**. Click **Pay it anyway**, read the box, then **Cancel**. (Only the parent could pay it. Don't pay the trick one.) |
| 5.5 | As **Parent**, open **🚦 Guardian** | **⏸️ Hold while offline: on**, and when the guardian last checked in (usually "just now" or a few minutes ago). |

The judge buttons are limited to 4 per visitor per hour and 30 a day.

### Part 6: stop and restart (account: Parent, then Child)

| # | Do this | You should see |
|---|---|---|
| 6.1 | As **Parent**, open **Pause & stop**, click **Pause spending** | Confirmed. The status chip shows **⏸ Child paused**. |
| 6.2 | Switch to **Child**, try to pay the canteen `0.1` | "Your spending is paused". If you pay anyway: refused and recorded. |
| 6.3 | As **Parent**, **Pause & stop** → **Turn spending back on** | Spending works again. Requests signed before the pause stay cancelled. |
| 6.4 | Put the showcase back: **Money** → set aside `0` again, and leave the child turned on | The showcase family is back to normal for judges. |

Don't use **Revoke everything** on allowance #1: it would also cancel the school's billing permission and the
judge page would stop working.

### Part 7: show the proof

| # | Do this | You should see |
|---|---|---|
| 7.1 | Parent → **History** | Every payment, refusal, request, rule change, school charge and veto, newest first, each with a link. |
| 7.2 | Click any link | The transaction on the Aevum explorer: the public record anyone can check. |
| 7.3 | Open [EVIDENCE.md](EVIDENCE.md) | Every feature run live through the hosted app and guardian, each checked step with its transaction. |

---

## 9. A 3–4 minute demo for judges

No terminals needed: everything runs on the live site. Have Parent and Child ready in MetaMask.

| Time | Show | Say |
|---|---|---|
| 0:00 | Home page: the live card and the numbers | "Parents either approve every payment or hand over a card with no limits. Pocket Rails sits in between: the parent sets the rules once, the child pays inside them, and the school bills under limits. This card is a real family on the testnet, live." |
| 0:30 | Parent dashboard: Overview, then Rules & places | "These rules live inside a smart contract that holds the money. No screen or server can get around them." |
| 0:50 | Child page: pay 0.3 → Paid | "Inside the rules, it just works. The child never pays fees." |
| 1:10 | Child: try 0.6 → kind refusal → ask for an exception | "Outside the rules, nothing moves, but the refusal is recorded with a reason, and the child is told what to do next." |
| 1:40 | Parent: Allow once → Child: Pay now | "The parent says yes to that exact payment, once. The everyday rules don't change." |
| 2:00 | Child: try to spend the money set aside → refused | "Mum set money aside for school costs. Ada can't spend it on snacks, but the school can still collect it." |
| 2:15 | For judges: **Send a trick note** → vetoed | "This charge's note tries to talk the AI into approving it. The guardian caught it, from a smart account whose key can only say no." |
| 2:45 | Guardian → Decisions; Parent → Stopped charges → Pay it anyway → Cancel | "Every stop shows its reason and its proof. The guardian can never say yes. Only the parent can, and here she could still pay it." |
| 3:10 | Pause & stop → pause; Child refused; History → explorer link | "One tap pauses everything, and every decision has a public receipt." |
| 3:30 | Close | "AI can say no, never yes. Every yes traces back to a permission the parent signed." |

Short answers to likely questions are in [PITCH.md](PITCH.md). Afterwards, turn the child's spending back on
(step 6.3).

---

## 10. If something goes wrong

| Problem | What to do |
|---|---|
| The page shows the yellow "Demo mode" bar although I connected | The wallet isn't connected to this site yet. Click **Connect wallet** in the bar. |
| The page shows someone else's data | MetaMask is on a different account. Switch to the right one and reload. |
| "Your wallet is on another network" | Click **Switch network** in the yellow bar, or pick QDay Aevum Testnet in MetaMask. |
| Nothing happens when I click a button | Look for the MetaMask pop-up. If none opened, click the MetaMask fox icon in the browser toolbar. |
| A button is greyed out | In demo mode all action buttons are locked. Otherwise check the amount: the button stays grey if it's above what's allowed or available. |
| The child sees "No allowance for this account yet" | MetaMask is on the wrong account. Switch to **Child**. |
| The judge page says the live demo isn't on, or "Waiting for the guardian" never finishes | See [HOSTING.md](HOSTING.md#troubleshooting). Usually the School account or the guardian smart account needs a little tQDAY. |
| "Not enough in the allowance" | Top up allowance #1 from **Money**. If the Parent wallet is empty, send the School account's tUSD8 back to Parent first. |
| A payment says "the relayer is out of gas" | Send the Relayer account a little tQDAY from Parent (0.1 is plenty). |
| The relayer is down and the child sees "Plan B: send it yourself" | Give the Child account a tiny bit of tQDAY and tap **Send it myself**. |
| I pasted a key in the wrong file | Tell your developer before committing anything. The commit check blocks keys, but the file should be fixed. |

---

## 11. Command cheat sheet (only if you run things on your Mac)

Run these from the `pocket-rails` folder (`cd ~/Desktop/Odun.Dev/pocket-rails`), after `nvm use 22`.

| What | Command |
|---|---|
| Start the app locally | `pnpm dev`, then open [localhost:3000](http://localhost:3000) |
| Start the agents locally (only if they're **not** running on Railway, or they'd both act) | `pnpm --filter agents school` and `pnpm --filter agents guardian` |
| Stop anything running in a terminal | **Ctrl + C** |
| Re-run the evidence run (about 1.2 tUSD8 and 5 minutes) | see [EVIDENCE.md](EVIDENCE.md#run-it-again) |
| Run the contract tests | `make test FORGE=/opt/homebrew/bin/forge` |
| Print the Railway settings | `node tools/railway-vars.mjs` |
