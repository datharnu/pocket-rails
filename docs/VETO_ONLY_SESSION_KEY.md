# Template: a "can only say no" session key for a Kernel smart account

Pocket Rails' guardian is an AI agent. We wanted it to be able to **stop** a payment but never **approve**, move
money or change anything else, even if the AI is tricked or its server is compromised. The answer was a tiny
ERC-7579 validator module that turns an ordinary session key into a key for exactly one function on exactly one
contract. It runs live on Aevum today, and the pattern works for any "an agent may do this one safe thing" need.

| | |
|---|---|
| Contract | [`contracts/src/VetoOnlySessionValidator.sol`](../contracts/src/VetoOnlySessionValidator.sol) (~150 lines, MIT) |
| On Aevum | [`0xCC02a255bb48927090F23bB86DA497830eE0fC7C`](https://explorer-test.qday.info/address/0xCC02a255bb48927090F23bB86DA497830eE0fC7C?tab=contract) (verified) |
| Account | Kernel v3.1 [`0x4D22c96D456CA81892C925bB2044DD28d21a31B0`](https://explorer-test.qday.info/address/0x4D22c96D456CA81892C925bB2044DD28d21a31B0), EntryPoint v0.7, QDay's bundler `https://bundler.qday.info` |
| Agent side | [`agents/src/userop.ts`](../agents/src/userop.ts): builds, signs and sends the user operation (viem, no SDK) |
| Install | [`contracts/script/DeployGuardianAccount.s.sol`](../contracts/script/DeployGuardianAccount.s.sol): creates the account with the module installed |
| Tests | [8 unit tests](../contracts/test/VetoOnlySessionValidator.t.sol) and [10 fork tests](../contracts/test/fork/GuardianAccountFork.t.sol) against Aevum's real EntryPoint and Kernel |
| Live proof | Vetoes sent as user operations: see [EVIDENCE.md](EVIDENCE.md) |

## What it enforces

All checks run during ERC-4337 **validation**, so a disallowed operation is rejected by the EntryPoint before
anything executes (and before the account pays for execution):

1. The operation calls Kernel `execute(bytes32 mode, bytes executionCalldata)` in **single-call default mode**
   (`mode == 0`): no batches, no delegatecall.
2. The one call goes to the **one contract** set at install time, with **value 0**.
3. The called function is **`vetoCharge(uint256,string)`**. The selector is masked to 4 bytes, so trailing data
   can't fake it.
4. The signature is the **session key's** (raw `userOpHash` or EIP-191 signed hash).
5. The session's expiry is returned as **`validUntil`**, so the EntryPoint enforces it without reading the clock
   during validation (ERC-7562), and storage is keyed by the account (also ERC-7562).
6. `isValidSignatureWithSender` always fails: the session key **can't sign messages** (ERC-1271) for the account.

The account's owner key (Kernel's root ECDSA validator) keeps full control: it can call `revokeSession()` or
uninstall the module at any time.

## Adapt it to your own contract

Change two constants and the install data:

```solidity
// the one function the agent may call, e.g. "pause()" or "cancelOrder(uint256)"
bytes4 public constant VETO_SELECTOR = bytes4(keccak256("vetoCharge(uint256,string)"));
// onInstall(abi.encode(address sessionKey, address targetContract, uint48 validUntil))
```

Good fits are actions whose worst case is safe: cancel, pause, flag, revoke, veto. Don't use it for anything
that moves funds or grants rights: the point is that a compromised key can only do harm in one safe direction.

## Install it on a Kernel v3.1 account

At account creation (from our deploy script), add it as a type-1 (validator) module with no hook, allowed to use
`execute` only:

```solidity
bytes memory moduleInit = abi.encodePacked(
    address(1), // no hook
    abi.encode(abi.encode(sessionKey, targetContract, validUntil), bytes(""), abi.encodePacked(validator.EXECUTE_SELECTOR()))
);
bytes[] memory initConfig = new bytes[](1);
initConfig[0] = abi.encodeWithSignature("installModule(uint256,address,bytes)", uint256(1), address(validator), moduleInit);
// then the Kernel factory's createAccount(initialize(rootValidator, hook, ownerData, "", initConfig), salt)
```

## Send an operation with the session key

Select the validator in the nonce key, wrap the call in Kernel `execute`, sign the user-operation hash with the
session key and send it to the bundler (from [`agents/src/userop.ts`](../agents/src/userop.ts)):

```ts
// nonce key: mode 0x00 | type 0x01 (validator) | validator address | key 0
const key = (1n << 176n) | (BigInt(validator) << 16n);
const nonce = await client.readContract({ address: entryPoint07Address, abi: entryPoint07Abi, functionName: "getNonce", args: [account, key] });

// Kernel execute, single-call mode: target (20 bytes) | value (32 bytes) | call data
const callData = encodeFunctionData({
  abi: parseAbi(["function execute(bytes32 mode, bytes executionCalldata) payable"]),
  functionName: "execute",
  args: [zeroHash, encodePacked(["address", "uint256", "bytes"], [rails, 0n, encodeFunctionData({ abi: pocketRailsAbi, functionName: "vetoCharge", args: [chargeId, reason] })])],
});
// ...fill gas fields (QDay's Rundler: rundler_maxPriorityFeePerGas), sign getUserOperationHash(...) with the
// session key, then eth_sendUserOperation to https://bundler.qday.info
```

## Notes from running it on Aevum

- The bundler at `bundler.qday.info` is Rundler; use `rundler_maxPriorityFeePerGas` for the priority fee.
- No paymaster is needed: the account pays its own gas (about 0.0002 tQDAY per veto), so keep it topped up.
  A stolen session key can therefore spend the account's gas balance, but nothing else; keep the balance small.
- EntryPoint errors are precise and worth testing for: a wrong target or function fails in validation
  (`AA23` with the module's error inside), an expired session gives `AA22`, a bad signature `AA24`. Our fork
  tests assert each one.
