import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import { revertText } from "@pocket-rails/sdk";
import { explain } from "@/lib/errors";

/** PocketRails reverts and wallet errors in one plain sentence. Falls back to the kit's general explainer. */
export function explainRails(error: unknown): string {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) return "You cancelled in your wallet. Nothing was sent.";
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && revertText[name]) return revertText[name];
    }
  }
  return explain(error);
}
