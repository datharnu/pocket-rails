/**
 * Reason codes recorded by PocketRails when it refuses something. The numbers are part of the contract's
 * interface and never change. `message` is what a child or parent sees; `nextStep` says what they can do.
 */

export enum Reason {
  None = 0,
  AccessRevoked = 1,
  AccessExpired = 2,
  PayeeNotApproved = 3,
  OverPaymentLimit = 4,
  OverWeeklyLimit = 5,
  InsufficientBalance = 6,
  ExceptionNotApproved = 7,
  ExceptionMismatch = 8,
  OverChargeLimit = 9,
  OverPeriodLimit = 10,
  BillingExpired = 11,
  BillingRevoked = 12,
}

export interface ReasonText {
  name: string;
  message: string;
  nextStep: string;
  /** Whether asking the parent for a one-time exception makes sense. */
  canAskException: boolean;
}

export const reasonText: Record<Reason, ReasonText> = {
  [Reason.None]: { name: "None", message: "Paid.", nextStep: "", canAskException: false },
  [Reason.AccessRevoked]: {
    name: "AccessRevoked",
    message: "Your parent has paused your spending.",
    nextStep: "Talk to your parent to turn it back on.",
    canAskException: false,
  },
  [Reason.AccessExpired]: {
    name: "AccessExpired",
    message: "Your spending access has ended.",
    nextStep: "Ask your parent to renew it.",
    canAskException: false,
  },
  [Reason.PayeeNotApproved]: {
    name: "PayeeNotApproved",
    message: "This place isn't on your approved list.",
    nextStep: "You can ask your parent for a one-time exception.",
    canAskException: true,
  },
  [Reason.OverPaymentLimit]: {
    name: "OverPaymentLimit",
    message: "This is more than you can spend in one payment.",
    nextStep: "Pay a smaller amount, or ask your parent for a one-time exception.",
    canAskException: true,
  },
  [Reason.OverWeeklyLimit]: {
    name: "OverWeeklyLimit",
    message: "This would take you over your weekly limit.",
    nextStep: "Your limit resets on Monday. Or ask your parent for a one-time exception.",
    canAskException: true,
  },
  [Reason.InsufficientBalance]: {
    name: "InsufficientBalance",
    message: "There isn't enough money in your allowance.",
    nextStep: "Ask your parent to top it up.",
    canAskException: false,
  },
  [Reason.ExceptionNotApproved]: {
    name: "ExceptionNotApproved",
    message: "That exception isn't approved, has expired, or was already used.",
    nextStep: "Check its status, or send a new request.",
    canAskException: true,
  },
  [Reason.ExceptionMismatch]: {
    name: "ExceptionMismatch",
    message: "This payment doesn't match the exception your parent approved.",
    nextStep: "Use exactly the place, amount and note that were approved.",
    canAskException: false,
  },
  [Reason.OverChargeLimit]: {
    name: "OverChargeLimit",
    message: "The school asked for more than one charge is allowed to be.",
    nextStep: "Nothing was taken. The school can send a smaller charge.",
    canAskException: false,
  },
  [Reason.OverPeriodLimit]: {
    name: "OverPeriodLimit",
    message: "The school has reached this period's billing limit.",
    nextStep: "Nothing was taken. The limit resets next period.",
    canAskException: false,
  },
  [Reason.BillingExpired]: {
    name: "BillingExpired",
    message: "This billing permission has ended.",
    nextStep: "The parent can grant a new one.",
    canAskException: false,
  },
  [Reason.BillingRevoked]: {
    name: "BillingRevoked",
    message: "The parent has cancelled this billing permission.",
    nextStep: "Nothing was taken.",
    canAskException: false,
  },
};

export function explainReason(code: number | bigint): ReasonText {
  const n = Number(code);
  return (
    reasonText[n as Reason] ?? {
      name: `Unknown(${n})`,
      message: "This was refused for a reason this app doesn't recognise.",
      nextStep: "Check the transaction on the explorer.",
      canAskException: false,
    }
  );
}

/** Contract errors (reverts) in plain language. These mean nothing was recorded or paid. */
export const revertText: Record<string, string> = {
  BadSignature: "The signature doesn't match this payment. Nothing was sent. Try again.",
  IntentExpired: "This request took too long and expired. Nothing was sent. Try again.",
  NonceAlreadyUsed: "This exact request was already submitted.",
  ZeroAmount: "The amount must be more than zero.",
  ZeroAddress: "An address is missing.",
  UnknownVault: "This allowance doesn't exist on this network.",
  NotParent: "Only the parent can do this.",
  NotBiller: "Only the school's billing key can send charges.",
  NotParentOrGuardian: "Only the parent or the guardian can stop a charge.",
  ChildInactive: "Spending is paused, so requests can't be sent right now.",
  VetoWindowClosed: "The time to stop this charge has passed.",
  VetoWindowOpen: "This charge is still in its waiting period.",
  BadRules: "Those rules aren't valid: limits must be above zero, the weekly limit at least the per-payment limit, and the end date in the future.",
  BadTerms: "Those billing terms aren't valid.",
  BadState: "This item can't change from its current state.",
  NotEnoughBalance: "There isn't enough in the vault.",
  LengthMismatch: "Each payee needs a label.",
};
