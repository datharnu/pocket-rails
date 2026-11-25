import assert from "node:assert/strict";
import { test } from "node:test";
import { duplicateOf, evaluate, isWeekend, usualPrice, type ChargeFacts } from "./policy";

// 2026-11-25 (Wednesday) 12:00 UTC and 2026-11-28 (Saturday) 12:00 UTC
const WED = 1_795_608_000n;
const SAT = WED + 3n * 86_400n;
const H = (s: string) => `0x${s.padStart(64, "0")}`;

const charge = (id: number, amount: number, memo: string, status = 1, at = WED, billingId = 1n): ChargeFacts => ({
  id: BigInt(id),
  billingId,
  amount: BigInt(Math.round(amount * 1e6)),
  memoHash: H(memo),
  status,
  requestedAt: at,
});

test("weekend detection uses UTC", () => {
  assert.equal(isWeekend(WED), false);
  assert.equal(isWeekend(SAT), true);
  assert.equal(isWeekend(SAT + 86_400n), true); // Sunday
  assert.equal(isWeekend(SAT + 2n * 86_400n), false); // Monday
});

test("a second charge with the same note on the same permission is a duplicate", () => {
  const first = charge(1, 0.3, "a1", 4);
  const again = charge(2, 0.3, "a1", 1);
  assert.equal(duplicateOf(again, [first, again])?.id, 1n);
  const d = evaluate(again, [first, again]);
  assert.equal(d.action, "veto");
  assert.equal(d.rule, "duplicate");
});

test("a vetoed or failed earlier charge doesn't make a retry a duplicate", () => {
  const vetoed = charge(1, 0.3, "a1", 3);
  const failed = charge(2, 0.3, "a1", 5);
  const retry = charge(3, 0.3, "a1", 1);
  assert.equal(duplicateOf(retry, [vetoed, failed, retry]), undefined);
});

test("the same note on a different permission is not a duplicate", () => {
  const other = charge(1, 0.3, "a1", 4, WED, 2n);
  const c = charge(2, 0.3, "a1", 1, WED, 1n);
  assert.equal(duplicateOf(c, [other, c]), undefined);
});

test("usual price is the median of settled charges, and needs two of them", () => {
  assert.equal(usualPrice(1n, [charge(1, 0.3, "a", 4)]), undefined);
  assert.equal(usualPrice(1n, [charge(1, 0.3, "a", 4), charge(2, 0.5, "b", 4), charge(3, 0.3, "c", 4)]), 300_000n);
  assert.equal(usualPrice(1n, [charge(1, 0.2, "a", 4), charge(2, 0.4, "b", 4)]), 300_000n);
});

test("a charge far above the usual price is vetoed; a normal one is left alone", () => {
  const history = [charge(1, 0.3, "a", 4), charge(2, 0.3, "b", 4)];
  const high = charge(3, 0.5, "c", 1);
  const normal = charge(4, 0.3, "d", 1);
  assert.equal(evaluate(high, [...history, high]).rule, "overprice");
  assert.equal(evaluate(normal, [...history, normal]).action, "no_action");
});

test("with no history, the expected price is used", () => {
  const c = charge(1, 0.6, "a", 1);
  assert.equal(evaluate(c, [c]).action, "no_action");
  assert.equal(evaluate(c, [c], { expectedPrice: 300_000n }).rule, "overprice");
});

test("weekend charges are vetoed unless the parent turns that rule off", () => {
  const c = charge(1, 0.3, "a", 1, SAT);
  assert.equal(evaluate(c, [c]).rule, "weekend");
  assert.equal(evaluate(c, [c], { blockWeekends: false }).action, "no_action");
});

test("the guardian's only possible actions are veto, no_action and unknown", () => {
  const actions = new Set(["veto", "no_action", "unknown"]);
  for (const c of [charge(1, 0.3, "a", 1), charge(2, 0.3, "a", 1, SAT), charge(3, 9, "b", 1)]) {
    assert.ok(actions.has(evaluate(c, [c], { expectedPrice: 300_000n }).action));
  }
});
