# Guardian evaluation

How well the guardian agent stops wrong school charges, measured on 50 school-charge notes
([agents/eval/cases.json](../agents/eval/cases.json)). Run on 2026-11-25 with `pnpm --filter agents eval`; model
`claude-opus-5-5` at low effort; cases and prompt as of commit `2c2ee93` (frozen before this run; the prompt in
[agents/src/review.ts](../agents/src/review.ts) was not changed for this set). Raw decisions and reasons:
[agents/eval/results.json](../agents/eval/results.json).

The guardian can only **veto** or leave a charge alone; "unknown" leaves it for the parent. It can never approve,
so the worst a wrong answer can do is stop a genuine charge (which the parent can pay anyway) or let a bad one
through to the parent's normal review window.

| Category | Cases | What a good guardian does |
|---|---|---|
| genuine | 16 | leave it (no_action) |
| non_school | 12 | veto (gift cards, betting, personal transfers…) |
| injection | 16 | veto (the note tries to instruct the reviewer) |
| vague | 4 | unknown or no_action ("Fee", "Payment"…) |
| overprice | 2 | veto (normal note, three times the usual price) |

## Held-out (25 cases)

| System | Correct | Bad charges vetoed | Injections vetoed | Genuine charges wrongly vetoed | Unknown |
|---|---|---|---|---|---|
| Rules only | 44% (11/25) | 7% (1/15) | 0% (0/8) | 0% (0/8) | 0% (0/25) |
| AI review only | 96% (24/25) | 93% (14/15) | 100% (8/8) | 0% (0/8) | 12% (3/25) |
| Rules + AI (what the guardian runs) | 100% (25/25) | 100% (15/15) | 100% (8/8) | 0% (0/8) | 8% (2/25) |

## Tune (25 cases)

| System | Correct | Bad charges vetoed | Injections vetoed | Genuine charges wrongly vetoed | Unknown |
|---|---|---|---|---|---|
| Rules only | 44% (11/25) | 7% (1/15) | 0% (0/8) | 0% (0/8) | 0% (0/25) |
| AI review only | 96% (24/25) | 93% (14/15) | 100% (8/8) | 0% (0/8) | 8% (2/25) |
| Rules + AI (what the guardian runs) | 100% (25/25) | 100% (15/15) | 100% (8/8) | 0% (0/8) | 4% (1/25) |

## All (50 cases)

| System | Correct | Bad charges vetoed | Injections vetoed | Genuine charges wrongly vetoed | Unknown |
|---|---|---|---|---|---|
| Rules only | 44% (22/50) | 7% (2/30) | 0% (0/16) | 0% (0/16) | 0% (0/50) |
| AI review only | 96% (48/50) | 93% (28/30) | 100% (16/16) | 0% (0/16) | 10% (5/50) |
| Rules + AI (what the guardian runs) | 100% (50/50) | 100% (30/30) | 100% (16/16) | 0% (0/16) | 6% (3/50) |

## Where the guardian got it wrong

No mistakes on this set.

## Latency of the AI review

Median 1.8 s, 95th percentile 2.2 s (per charge, from this machine).

## Limits

- 50 hand-written cases is a small set; it shows behaviour, not a guarantee.
- The rules don't read notes, so on note-only problems the rules-only row shows what the AI adds.
- A determined attacker might find notes that pass; that's why the guardian can only veto, and charges still wait
  in the parent's veto window.
