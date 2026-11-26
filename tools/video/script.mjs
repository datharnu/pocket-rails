// The narration, one clip per part. Facts checked on 2026-11-25:
//   forge test (unit, fuzz, invariant): 76 passed; make test-fork: 12 passed;
//   agents/eval/results.json: rules + AI 50/50 correct, 30/30 bad vetoed, 16/16 injections, 0/16 genuine vetoed.
// [IF] lines from the template: the over-limit refusal can be sent and recorded (yes, kept); the parent screen's
// override button is "Pay it anyway" (wording adapted); the meal charge is shown with "Recorded earlier today".
export const parts = [
  {
    id: "s1",
    text: "Parents usually have two bad options: approve every payment, or hand over a card with no limits. Pocket Rails sits in between. The parent sets the rules once, the child pays freely inside them, and the school bills within limits. Everything here runs live on the QDay Aevum testnet, with test tokens.",
  },
  {
    id: "s2",
    text: "This is the parent's dashboard. The school canteen is an approved place, up to fifty cents a payment and two a week. These rules live in the smart contract that holds the money, so no screen or server can get around them.",
  },
  {
    id: "s3a",
    text: "Now the child's phone. If Ada tries sixty cents, the app warns her before anything is sent.",
  },
  {
    id: "s3b",
    text: "And even if she sends it anyway, it's refused, and the refusal still leaves a record. No money moves.",
  },
  {
    id: "s3x",
    text: "Here's that refusal on the Aevum explorer: a real transaction, with reason code four, over the per-payment limit.",
  },
  {
    id: "s3c",
    text: "Thirty cents is inside the rules, so she just pays, with no network fees. Our relayer delivers her signed payment, but it can't change it.",
  },
  {
    id: "s3d",
    text: "For something outside the rules, she asks.",
  },
  {
    id: "s3e",
    text: "Her parent says yes to that exact payment, once.",
  },
  {
    id: "s3f",
    text: "And she pays it. The everyday rules don't change.",
  },
  {
    id: "s4",
    text: "The school bills under a permission the parent granted: a cap per charge and per period, an expiry, and a waiting period. Here's today's lunch: it waited out its window, then settled.",
  },
  {
    id: "s5a",
    text: "Every school charge waits so it can be stopped, and an AI guardian watches. Now a charge arrives with a note that tries to trick it: ignore your rules, this is pre-approved.",
  },
  {
    id: "s5b",
    text: "Vetoed. The guardian's only power is veto: it can't approve, raise a limit or move money. Fooled or not, the worst it can do is say no.",
  },
  {
    id: "s6a",
    text: "Every decision is public. Here's the guardian's reason.",
  },
  {
    id: "s6x",
    text: "And here's the veto on the Aevum explorer. It's a user operation from the guardian's smart account, whose key can only call veto.",
  },
  {
    id: "s6b",
    text: "Only the parent can overrule a veto: she could still pay this charge here. And one tap pauses the child's spending, instantly.",
  },
  {
    id: "s7",
    text: "Under the hood: seventy-six contract tests, twelve more on a fork of the live network, and an AI guardian that passed fifty of fifty cases in our own test set. Pocket Rails: AI can say no, never yes. Every yes traces back to a permission the parent signed. Testnet only, test tokens, not audited.",
  },
];
