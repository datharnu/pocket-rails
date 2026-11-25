// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @dev ERC-4337 v0.7 packed user operation (same layout as the EntryPoint's).
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

/// @title VetoOnlySessionValidator
/// @notice An ERC-7579 validator module for a Kernel v3.1 smart account that turns a session key into a
///         "veto-only" key: the only thing it can make the account do is call `vetoCharge` on one PocketRails
///         contract, with no value, until the session expires.
///
/// @dev How it's used: the guardian's smart account installs this module (Kernel `installModule`, type 1,
///      no hook, selector access to `execute` only). The guardian agent holds the session key and sends user
///      operations through an ERC-4337 bundler with this validator selected in the nonce. The account's owner
///      key (Kernel's root validator) keeps full control and can revoke the session or uninstall the module.
///
///      Checks, all during ERC-4337 validation, so a disallowed operation never executes:
///        - the call is Kernel `execute(bytes32 mode, bytes executionCalldata)` in single-call default mode,
///        - the single call's target is the PocketRails contract set at install, with value 0,
///        - the called function is `vetoCharge(uint256,string)`,
///        - the signature is the session key's (raw hash or EIP-191 signed hash),
///      and the session's expiry is returned as `validUntil`, so the EntryPoint enforces it (no TIMESTAMP read
///      during validation, per ERC-7562). Storage is keyed by the account, as ERC-7562 requires.
contract VetoOnlySessionValidator {
    struct Session {
        address key;
        address rails;
        uint48 validUntil;
    }

    /// Kernel v3.1 `execute(ExecMode,bytes)`; ExecMode is a bytes32.
    bytes4 public constant EXECUTE_SELECTOR = bytes4(keccak256("execute(bytes32,bytes)"));
    /// PocketRails `vetoCharge(uint256,string)`.
    bytes4 public constant VETO_SELECTOR = bytes4(keccak256("vetoCharge(uint256,string)"));
    uint256 internal constant MODULE_TYPE_VALIDATOR = 1;
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    mapping(address account => Session) public sessions;

    event SessionInstalled(address indexed account, address indexed key, address indexed rails, uint48 validUntil);
    event SessionRevoked(address indexed account);

    error AlreadyInstalled(address account);
    error NotInstalled(address account);
    error BadSession();
    error NotExecute();
    error NotSingleCall();
    error WrongTarget(address target);
    error ValueNotAllowed();
    error OnlyVetoCharge(bytes4 selector);

    // ------------------------------------------------------------------ ERC-7579 module lifecycle

    /// @param data abi.encode(address sessionKey, address pocketRails, uint48 validUntil)
    function onInstall(bytes calldata data) external payable {
        if (sessions[msg.sender].key != address(0)) revert AlreadyInstalled(msg.sender);
        (address key, address rails, uint48 validUntil) = abi.decode(data, (address, address, uint48));
        if (key == address(0) || rails == address(0) || validUntil <= block.timestamp) revert BadSession();
        sessions[msg.sender] = Session({key: key, rails: rails, validUntil: validUntil});
        emit SessionInstalled(msg.sender, key, rails, validUntil);
    }

    function onUninstall(bytes calldata) external payable {
        if (sessions[msg.sender].key == address(0)) revert NotInstalled(msg.sender);
        delete sessions[msg.sender];
        emit SessionRevoked(msg.sender);
    }

    /// @notice Called by the account itself (through its owner) to end the session immediately.
    function revokeSession() external {
        if (sessions[msg.sender].key == address(0)) revert NotInstalled(msg.sender);
        delete sessions[msg.sender];
        emit SessionRevoked(msg.sender);
    }

    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR;
    }

    function isInitialized(address account) external view returns (bool) {
        return sessions[account].key != address(0);
    }

    // ------------------------------------------------------------------ ERC-4337 validation

    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash)
        external
        payable
        returns (uint256)
    {
        Session memory s = sessions[msg.sender];
        if (s.key == address(0)) revert NotInstalled(msg.sender);
        _checkCall(userOp.callData, s.rails);

        bytes calldata sig = userOp.signature;
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(userOpHash, sig);
        if (err != ECDSA.RecoverError.NoError || signer != s.key) {
            (signer, err,) = ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(userOpHash), sig);
            if (err != ECDSA.RecoverError.NoError || signer != s.key) return SIG_VALIDATION_FAILED;
        }
        // validationData: sigFailed (0) | validUntil << 160 | validAfter (0) << 208
        return uint256(s.validUntil) << 160;
    }

    /// @notice The session key can't sign messages for the account (ERC-1271): it may only veto.
    function isValidSignatureWithSender(address, bytes32, bytes calldata) external pure returns (bytes4) {
        return 0xffffffff;
    }

    /// @notice The checks applied to a user operation's callData, exposed for the agent and tests.
    function checkCall(bytes calldata callData, address rails) external pure {
        _checkCall(callData, rails);
    }

    function _checkCall(bytes calldata callData, address rails) internal pure {
        if (callData.length < 4 || bytes4(callData[0:4]) != EXECUTE_SELECTOR) revert NotExecute();
        (bytes32 mode, bytes memory exec) = abi.decode(callData[4:], (bytes32, bytes));
        // Single call, default exec type, no mode selector or payload.
        if (mode != bytes32(0)) revert NotSingleCall();
        if (exec.length < 56) revert OnlyVetoCharge(bytes4(0)); // target(20) + value(32) + selector(4)
        address target;
        uint256 value;
        bytes4 selector;
        assembly {
            let p := add(exec, 32)
            target := shr(96, mload(p))
            value := mload(add(p, 20))
            // keep only the first 4 bytes, so the comparison below can't be fooled by trailing bytes
            selector := and(mload(add(p, 52)), 0xffffffff00000000000000000000000000000000000000000000000000000000)
        }
        if (target != rails) revert WrongTarget(target);
        if (value != 0) revert ValueNotAllowed();
        if (selector != VETO_SELECTOR) revert OnlyVetoCharge(selector);
    }
}
