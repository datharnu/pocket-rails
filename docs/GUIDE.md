# Pocket Rails: the plain-English guide

This guide explains what Pocket Rails is, how it works and how to test and demo it, without assuming you know
anything about crypto. Read sections 1 to 4 once to understand it. Use sections 7 to 9 when you test or demo.

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
| 🛡️ **Guardian** | A helper, here an AI agent | Stop a school charge that looks wrong during its waiting time | Approve anything, raise a limit, move money |
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
5. If the guardian stopped it by mistake, the parent can still **pay it anyway** (only the parent can).
6. If the school asks for more than the limits, the robot cashier refuses it straight away and writes that down.

### The one-line summary

**"AI can say no, never yes. Every yes traces back to a permission the parent signed."**
The child's payments are allowed by the parent's rules, exceptions by the parent's "allow once", and school
charges by the billing permission the parent gave.

---

## 5. What we built and where it lives

| Piece | Where it is | Does it need to be running? |
|---|---|---|
| The robot cashier (smart contract) | On Aevum. Current version (v2): `0xB179197A660029b1d96FEF09e3E8515b271E3801` ([see it](https://explorer-test.qday.info/address/0xB179197A660029b1d96FEF09e3E8515b271E3801?tab=contract)). The first version (v1) holds the earlier demo runs. | No. It's always there. |
| The app (screens + messenger) | On your Mac for now: [http://localhost:3000](http://localhost:3000) | Yes, while you test or demo. (A public link comes with hosting.) |
| School billing agent | `agents/` folder, runs in a terminal | Only when you want the school to bill automatically |
| Guardian agent | `agents/` folder, runs in a terminal | Only when you want automatic checking |
| Proof of earlier runs | [DEMO_RUN.md](DEMO_RUN.md) | No |

---

## 6. Your five accounts

All five are in MetaMask. Balances are from 25 Nov 2026 and change as you test.

| Account | Role | Holds now | Needs |
|---|---|---|---|
| Parent `0xD035…a485` | Parent | 1.5 tUSD8, 0.69 tQDAY | tUSD8 to top up, a little tQDAY for fees |
| Child `0x7961…0d16` | Child | nothing | nothing (the messenger pays fees) |
| Relayer `0xF534…016E` | Messenger (the app's server) | 0.199 tQDAY | tQDAY for fees (enough for hundreds of payments) |
| School `0x8C6a…368F` | School billing | 1.9 tUSD8 (from meals and canteen), 0.049 tQDAY | a little tQDAY for fees |
| Guardian `0xEA66…00db` | Guardian | 0.05 tQDAY | a little tQDAY for fees (vetoes only) |

The current contract (v2) is new and empty: you'll open a fresh allowance in Part 1. The School account holds 1.9 tUSD8 from earlier demos, which you can send back to Parent to fund testing.

**Keys:** the private keys live only in files that never go to GitHub: `web/.env.local` (Relayer),
`examples/.env` (Parent, Child) and `agents/.env` (School, Guardian). Never paste a key into a file ending in
`.example`, and never paste one into a chat.

---

## 7. Before you test or demo: checklist

1. **Start the app.** Open Terminal and run:
   ```
   cd ~/Desktop/Odun.Dev/pocket-rails
   nvm use 22
   pnpm dev
   ```
   Wait for "Ready", then open [http://localhost:3000](http://localhost:3000). Leave this terminal open.
2. **MetaMask:** the network is **QDay Aevum Testnet**, and tUSD8 is added as a token
   (`0x456569838f1d43009A91ebA4263147Afd7233483`, 6 decimals).
3. **Switching roles:** in MetaMask, pick another account (Parent, Child, School, Guardian). If the app says
   it isn't connected, click **Connect Wallet** and choose that account. The app always acts as whichever
   account MetaMask has selected.
4. **Fresh contract:** the app and agents now use v2 (it adds money set aside for school). v2 starts with no
   allowances and no billing permissions, so Part 1 opens a new allowance. A billing permission's weekly limit
   restarts 7 days after it was granted; the child's weekly limit restarts every Monday 00:00 UTC.
5. **Agents' settings** are in `agents/.env`. Right now they're in demo mode: a meal every 2 minutes
   (`BILL_EVERY=120`), one "trick" charge to test the AI (`DEMO_SCENARIO=trick`), and AI review on
   (`AI_REVIEW=1`).

---

## 8. Full test, step by step

Do the parts in order. Each step says which account to use, what to click and what you should see.
Amounts are chosen to fit the money you have: 1.5 tUSD8 in Parent, plus 1.9 you'll move from School.

### Part 1: the parent gets ready (account: Parent, page: Parent)

| # | Do this | You should see |
|---|---|---|
| 1.0 | Switch MetaMask to **School**, send **1.9 tUSD8** to the Parent address (`0xD035…a485`) | Parent now holds 3.4 tUSD8. (One-time money move.) |
| 1.1 | Switch to **Parent**, open [localhost:3000/parent](http://localhost:3000/parent) | **Allowance #1** already exists on v2 (it was opened for the smart-account guardian test, with School billing and the guardian set). Use it. |
| 1.2 | (Only if you want a second allowance) Click **+ New allowance**, then **Open allowance** | A new allowance tab. You'd then need to set its guardian and school billing yourself. |
| 1.3 | In **💵 Money**, type `2`, click **Top up**, confirm twice (allow, then deposit) | Balance shows **2 tUSD8**. |
| 1.4 | In **💵 Money**, under **🚌 Set aside for school**, type `0.9`, click **Save amount set aside**, confirm | "0.9 set aside, so your child can spend 1.1". Rules go up one version. |

### Part 2: the child pays (account: Child, page: Child)

| # | Do this | You should see |
|---|---|---|
| 2.1 | Switch MetaMask to **Child**, open [localhost:3000/child](http://localhost:3000/child) | The orange allowance card with 2 tUSD8, "🚌 0.9 set aside for school · you can spend 1.1", and "School canteen" as an approved place. |
| 2.2 | Tap **School canteen**, type `0.3`, tap **Pay**, sign in MetaMask (free) | "✓ Inside your rules" before you pay, then **Paid** with a "See the record" link. |
| 2.3 | Type `0.6`, tap **Pay** (more than the 0.50 per-payment limit) | Before paying: "✗ This is more than you can spend in one payment." If you pay anyway: **"That didn't go through, and that's okay"**, the reason, and "No money moved. The refusal is recorded on Aevum". |
| 2.4 | Tap **Ask for an exception** (the amount stays 0.6), add a note like `Museum trip snacks`, tap **Send request to parent**, sign | "Request sent. Waiting for your parent." It appears under **📨 My requests** as "Waiting for parent". |

### Part 3: the parent answers (account: Parent, page: Parent)

| # | Do this | You should see |
|---|---|---|
| 3.1 | Switch to **Parent**, open the Parent page | "What to do next": **Your child is asking for something**. |
| 3.2 | In **🙋 Requests from your child**, click **Allow once**, confirm | Confirmed. The request disappears from the list. Your everyday rules (version number) don't change. |

### Part 4: the child uses the exception (account: Child, page: Child)

| # | Do this | You should see |
|---|---|---|
| 4.1 | Switch to **Child**, open the Child page | "What to do next": **Your parent said yes!** |
| 4.2 | Under **📨 My requests**, tap **Pay now**, sign | **Paid**. The request now shows "Used". Paying it again would be refused. |
| 4.3 | Try to pay the canteen `0.3` | Only 0.2 is left to spend; the rest is set aside. Before paying: "✗ That money is set aside for school costs." If you pay anyway: refused and recorded, no money moves. |

### Part 5: school billing with the agents (accounts: Parent, then watch)

| # | Do this | You should see |
|---|---|---|
| 5.1 | Allowance #1 already has school billing (2-minute window, no first-charge approval). To try the full setup yourself, as **Parent**, in **🏫 School billing**, open **Grant a billing permission**. Everything is filled in. Change **Veto window (minutes)** to `2`. Leave "The first charge waits for my approval" ticked. Click **Grant**. | Confirmed. A new permission appears in the list. School charges can use the 0.9 set aside. |
| 5.2 | Open **two new Terminal windows**. In the first run `cd ~/Desktop/Odun.Dev/pocket-rails && nvm use 22 && pnpm --filter agents school`. In the second run the same but end with `guardian`. | The school prints "billing as 0x8C6a…" and soon "meal: charged 0.3". The guardian prints "AI review: on" and then "ok … normal school meal cost". |
| 5.3 | Go to the Parent page. "What to do next" says **A school charge is waiting**. In **🏫 School charges waiting**, the charge says "first charge: waits for your approval". Click **Approve**, confirm | Confirmed: the school is paid. |
| 5.4 | Wait about 15 seconds | The school sends the **trick charge** (its note tries to tell the AI to approve it). The guardian prints **VETO … "The note tries to instruct the reviewer…"**. On the Parent page it appears in **✋ Stopped charges** with that reason. |
| 5.5 | On the trick charge, click **Pay it anyway**, read the box, then click **Cancel** | The confirm box repeats why it was stopped. Cancel: nothing is paid. (This shows the parent has the final say, without paying a bad charge.) |
| 5.6 | Wait 2–3 minutes | New meal charges arrive every 2 minutes and are paid to the school after their 2-minute wait, with no action from you. Each one uses up the money set aside for school first. |
| 5.7 | When you've seen enough, press **Ctrl + C** in both agent terminals | The agents stop. Nothing new is charged. |

The guardian of allowance #1 is a **smart account** (`0x4D22…31B0`), so its vetoes come from the guardian agent through QDay's bundler, not from the Guardian page. The Guardian page works when the guardian is a normal account.

Optional, to show a **wrong** veto being fixed: in **🛡️ Guardian** on the Parent page, set the guardian to the Guardian account (`0xEA66…00db`), wait for a normal meal, switch to **Guardian**, open
the Guardian page and click **Stop it**. Switch back to **Parent**: the charge is in **✋ Stopped charges**.
Click **Pay it anyway** and **Yes, pay it**. The school is paid.

### Part 6: stopping everything (accounts: Parent, then Child)

| # | Do this | You should see |
|---|---|---|
| 6.1 | As **Parent**, in **⛔ Pause and stop**, click **Pause child's spending** | Confirmed. "Child can spend" shows **Paused**. |
| 6.2 | Switch to **Child**, try to pay the canteen `0.1` | "Your spending is paused" at the top. If you pay anyway: refused and recorded, "Your parent has paused your spending." |
| 6.3 | (End of a demo only) As **Parent**, **Revoke everything…** → **Yes** | Child access off, all school billing and pending charges stopped. The money stays in the allowance. |

### Part 7: show the proof

| # | Do this | You should see |
|---|---|---|
| 7.1 | Parent page → **🧾 History** | Every payment, refusal, request, rule change, school charge and veto, newest first, each with a link. |
| 7.2 | Click any link | The transaction on the Aevum explorer, the public record anyone can check. |
| 7.3 | Open the [contract on the explorer](https://explorer-test.qday.info/address/0xB179197A660029b1d96FEF09e3E8515b271E3801?tab=contract) | The verified source code of the robot cashier. |

---

## 9. A 3–4 minute demo for judges

Practise this once with the steps above. Have Parent and Child ready in MetaMask, the app open, and the two
agent terminals ready to start.

| Time | Show | Say |
|---|---|---|
| 0:00 | Home page (Ada's story) | "Parents either approve every payment or hand over a card with no limits. Pocket Rails sits in between: the parent sets the rules once, the child pays inside them, and the school can bill too, under limits." |
| 0:30 | Parent page: rules, places, balance | "These rules live inside a smart contract that holds the money. No screen or server can get around them." |
| 0:50 | Child page: pay 0.3 → Paid | "Inside the rules, it just works. The child never pays fees." |
| 1:10 | Child: try 0.6 → kind refusal → ask for exception | "Outside the rules, nothing moves, but the refusal is recorded with a reason, and the child is told what to do next." |
| 1:40 | Parent: Allow once → Child: Pay now | "The parent says yes to that exact payment, once. The everyday rules don't change." |
| 2:00 | Child tries to spend the bus-pass money → refused | "Mum set 0.90 aside for school costs. Ada can't spend it on snacks, but the school can still collect it." |
| 2:10 | Parent: school billing; agents running; first charge → Approve | "The school bills the same allowance under a permission the parent signed. Every charge waits a few minutes." |
| 2:40 | Guardian vetoes the trick charge; Stopped charges shows the AI's reason | "This charge's note tries to talk the AI into approving it. The guardian caught it. And the guardian can only ever say no. Only the parent can say yes." |
| 3:10 | Pause child → payment refused; History panel and explorer link | "One tap pauses everything, and every decision has a public receipt." |
| 3:30 | Close | "AI can say no, never yes. Every yes traces back to a permission the parent signed." |

Short answers to likely questions are in [PITCH.md](PITCH.md).

---

## 10. If something goes wrong

| Problem | What to do |
|---|---|
| The page says "Your wallet is on another network" | Click **Switch network** in the yellow bar, or pick QDay Aevum Testnet in MetaMask. |
| Nothing happens when I click a button | Look for the MetaMask pop-up. If none opened, click the MetaMask fox icon in the browser toolbar. |
| "Connect the … wallet" | Click **Connect Wallet** and choose the account for that role. |
| The child sees "No allowance for this account yet" | MetaMask is on the wrong account. Switch to **Child**. |
| The school agent says "this period's cap is reached" | That permission's weekly limit is used up. Grant a new billing permission (step 5.1) or wait for its week to restart. |
| A payment says "the relayer is out of gas" | Send the Relayer account a little tQDAY from Parent in MetaMask (0.1 is plenty). |
| The relayer is down and the child sees "Plan B: send it yourself" | Either fix the app, or give the Child account a tiny bit of tQDAY and tap **Send it myself**. |
| "Not enough in the allowance" / balance too low | Top up from the Parent page. If the Parent wallet is empty, get more tUSD8 from the Discord faucet (`/faucet <address>` in #faucet, once per Discord account) or ask a teammate to claim and send it. |
| The agents print "poll failed, retrying" | Usually a short network hiccup. If it repeats, check the app is running and `agents/.env` has `RAILS_ADDRESS` set. |
| I pasted a key in the wrong file | Tell your developer before committing anything. The commit check blocks keys, but the file should be fixed. |

---

## 11. Command cheat sheet

Run these from the `pocket-rails` folder (`cd ~/Desktop/Odun.Dev/pocket-rails`), after `nvm use 22`.

| What | Command |
|---|---|
| Start the app | `pnpm dev` |
| Start the school billing agent | `pnpm --filter agents school` |
| Start the guardian agent | `pnpm --filter agents guardian` |
| Stop anything running in a terminal | **Ctrl + C** |
| Run the whole child flow automatically (uses 2 tUSD8 of the Parent's) | `pnpm example demo-flow` (with the app running) |
| Run the contract tests | `make test FORGE=/opt/homebrew/bin/forge` |

For everyday (non-demo) school billing, set `BILL_EVERY=day` and clear `DEMO_SCENARIO` in `agents/.env`.
