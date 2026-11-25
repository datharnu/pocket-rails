// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PocketRails} from "../../src/PocketRails.sol";
import {VetoOnlySessionValidator, PackedUserOperation} from "../../src/VetoOnlySessionValidator.sol";

interface IEntryPointV07 {
    function handleOps(PackedUserOperation[] calldata ops, address payable beneficiary) external;
    function getNonce(address sender, uint192 key) external view returns (uint256);
    function getUserOpHash(PackedUserOperation calldata userOp) external view returns (bytes32);
}

interface IKernelFactory {
    function createAccount(bytes calldata data, bytes32 salt) external payable returns (address);
}

/// @notice The guardian as a Kernel v3.1 smart account on a fork of Aevum testnet, using Aevum's own deployed
///         EntryPoint v0.7, Kernel factory and ECDSA validator. Its session key can veto school charges through
///         the EntryPoint and nothing else.
///         Run with: make test-fork
contract GuardianAccountForkTest is Test {
    IERC20 constant TUSD8 = IERC20(0x456569838f1d43009A91ebA4263147Afd7233483);
    IEntryPointV07 constant ENTRYPOINT = IEntryPointV07(0x0000000071727De22E5E9d8BAf0edAc6f37da032);
    IKernelFactory constant KERNEL_FACTORY = IKernelFactory(0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419);
    address constant ECDSA_VALIDATOR = 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57;

    PocketRails rails;
    VetoOnlySessionValidator validator;
    address account; // the guardian's smart account
    address owner;
    uint256 ownerKey;
    address sessionKey;
    uint256 sessionPk;
    address parent = makeAddr("parent");
    address child = makeAddr("child");
    address school = makeAddr("school");
    address bundler = makeAddr("bundler");
    uint256 vaultId;
    uint256 billingId;
    uint48 validUntil;

    function setUp() public {
        require(block.chainid == 44005, "run with --fork-url aevum");
        (owner, ownerKey) = makeAddrAndKey("guardian-owner");
        (sessionKey, sessionPk) = makeAddrAndKey("guardian-session");
        rails = new PocketRails(TUSD8);
        validator = new VetoOnlySessionValidator();
        validUntil = uint48(block.timestamp + 7 days);

        account = _createAccount();

        // A family vault whose guardian is the smart account, with school billing.
        address[] memory payees = new address[](0);
        string[] memory labels = new string[](0);
        vm.startPrank(parent);
        vaultId = rails.createVault(
            child, PocketRails.Rules({perPaymentLimit: 1e6, weeklyLimit: 5e6, expiresAt: uint64(block.timestamp + 30 days)}), payees, labels
        );
        rails.setGuardian(vaultId, account);
        billingId = rails.grantBilling(
            vaultId,
            PocketRails.BillingTerms({
                biller: school,
                payTo: school,
                maxPerCharge: 1e6,
                maxPerPeriod: 5e6,
                period: 7 days,
                expiresAt: uint64(block.timestamp + 30 days),
                vetoWindow: 10 minutes,
                firstChargeNeedsApproval: false
            }),
            "Meals"
        );
        vm.stopPrank();
        vm.deal(account, 1 ether); // the account pays its own gas to the EntryPoint
    }

    // ---------------------------------------------------------------- helpers

    function _createAccount() internal returns (address) {
        bytes21 rootValidator = bytes21(abi.encodePacked(bytes1(0x01), ECDSA_VALIDATOR));
        // installModule(1, validator, hook || abi.encode(validatorData, hookData, selectorData))
        bytes memory moduleInit = abi.encodePacked(
            address(1), // no hook
            abi.encode(abi.encode(sessionKey, address(rails), validUntil), bytes(""), abi.encodePacked(validator.EXECUTE_SELECTOR()))
        );
        bytes[] memory initConfig = new bytes[](1);
        initConfig[0] = abi.encodeWithSignature("installModule(uint256,address,bytes)", uint256(1), address(validator), moduleInit);
        bytes memory data = abi.encodeWithSignature(
            "initialize(bytes21,address,bytes,bytes,bytes[])", rootValidator, address(1), abi.encodePacked(owner), bytes(""), initConfig
        );
        return KERNEL_FACTORY.createAccount(data, bytes32(0));
    }

    /// Nonce key selecting our validator: mode 0x00 | type 0x01 (validator) | validator address | key 0
    function _nonceKey() internal view returns (uint192) {
        return (uint192(1) << 176) | (uint192(uint160(address(validator))) << 16);
    }

    function _execute(address target, uint256 value, bytes memory callData) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("execute(bytes32,bytes)", bytes32(0), abi.encodePacked(target, value, callData));
    }

    function _op(bytes memory callData, uint256 signerPk) internal view returns (PackedUserOperation memory op) {
        op = PackedUserOperation({
            sender: account,
            nonce: ENTRYPOINT.getNonce(account, _nonceKey()),
            initCode: "",
            callData: callData,
            accountGasLimits: bytes32((uint256(500_000) << 128) | uint256(300_000)),
            preVerificationGas: 100_000,
            gasFees: bytes32((uint256(1 gwei) << 128) | uint256(2 gwei)),
            paymasterAndData: "",
            signature: ""
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, ENTRYPOINT.getUserOpHash(op));
        op.signature = abi.encodePacked(r, s, v);
    }

    function _send(PackedUserOperation memory op) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        ENTRYPOINT.handleOps(ops, payable(bundler));
    }

    /// EntryPoint v0.7 error when validation reverts: FailedOpWithRevert(opIndex, "AA23 reverted", innerRevert)
    function _expectAA23(bytes memory inner) internal {
        vm.expectRevert(abi.encodeWithSignature("FailedOpWithRevert(uint256,string,bytes)", uint256(0), "AA23 reverted", inner));
    }

    /// EntryPoint v0.7 error for signature / time-range failures: FailedOp(opIndex, reason)
    function _expectFailedOp(string memory reason) internal {
        vm.expectRevert(abi.encodeWithSignature("FailedOp(uint256,string)", uint256(0), reason));
    }

    function _pendingCharge() internal returns (uint256 chargeId) {
        vm.prank(school);
        (chargeId,) = rails.requestCharge(billingId, 1e6, keccak256("Lunch"));
    }

    function _vetoCall(uint256 chargeId) internal view returns (bytes memory) {
        return _execute(address(rails), 0, abi.encodeCall(PocketRails.vetoCharge, (chargeId, "Duplicate of an earlier charge")));
    }

    // ---------------------------------------------------------------- tests

    function test_accountIsSetUp() public view {
        assertGt(account.code.length, 0);
        assertTrue(validator.isInitialized(account));
        (address key, address r, uint48 until) = validator.sessions(account);
        assertEq(key, sessionKey);
        assertEq(r, address(rails));
        assertEq(until, validUntil);
        assertEq(rails.getVault(vaultId).guardian, account);
    }

    function test_sessionKeyVetoesThroughEntryPoint() public {
        uint256 chargeId = _pendingCharge();
        _send(_op(_vetoCall(chargeId), sessionPk));
        assertEq(uint8(rails.getCharge(chargeId).status), uint8(PocketRails.ChargeStatus.Vetoed));
    }

    function test_sessionKeyCannotApprove() public {
        uint256 chargeId = _pendingCharge();
        bytes memory approve = _execute(address(rails), 0, abi.encodeCall(PocketRails.approveCharge, (chargeId)));
        PackedUserOperation memory op = _op(approve, sessionPk);
        _expectAA23(abi.encodeWithSelector(VetoOnlySessionValidator.OnlyVetoCharge.selector, PocketRails.approveCharge.selector));
        _send(op);
        assertEq(uint8(rails.getCharge(chargeId).status), uint8(PocketRails.ChargeStatus.Pending));
    }

    function test_sessionKeyCannotMoveTokens() public {
        deal(address(TUSD8), account, 5e6);
        bytes memory steal = _execute(address(TUSD8), 0, abi.encodeCall(IERC20.transfer, (sessionKey, 5e6)));
        PackedUserOperation memory op = _op(steal, sessionPk);
        _expectAA23(abi.encodeWithSelector(VetoOnlySessionValidator.WrongTarget.selector, address(TUSD8)));
        _send(op);
        assertEq(TUSD8.balanceOf(account), 5e6);
    }

    function test_sessionKeyCannotSendValue() public {
        uint256 chargeId = _pendingCharge();
        bytes memory withValue =
            _execute(address(rails), 1, abi.encodeCall(PocketRails.vetoCharge, (chargeId, "x")));
        PackedUserOperation memory op = _op(withValue, sessionPk);
        _expectAA23(abi.encodeWithSelector(VetoOnlySessionValidator.ValueNotAllowed.selector));
        _send(op);
    }

    function test_sessionKeyCannotCallOtherAccountFunctions() public {
        // e.g. try to install another module or change the root validator
        bytes memory install = abi.encodeWithSignature("installModule(uint256,address,bytes)", uint256(1), address(0xdead), bytes(""));
        PackedUserOperation memory op = _op(install, sessionPk);
        // Our validator refuses anything that isn't Kernel `execute` before Kernel's own selector check runs.
        _expectAA23(abi.encodeWithSelector(VetoOnlySessionValidator.NotExecute.selector));
        _send(op);
    }

    function test_wrongSignerIsRejected() public {
        uint256 chargeId = _pendingCharge();
        (, uint256 otherPk) = makeAddrAndKey("not-the-session-key");
        PackedUserOperation memory op = _op(_vetoCall(chargeId), otherPk);
        _expectFailedOp("AA24 signature error");
        _send(op);
    }

    function test_expiredSessionIsRejected() public {
        uint256 chargeId = _pendingCharge();
        vm.warp(uint256(validUntil) + 1);
        PackedUserOperation memory op = _op(_vetoCall(chargeId), sessionPk);
        _expectFailedOp("AA22 expired or not due");
        _send(op);
    }

    function test_revokedSessionIsRejected() public {
        uint256 chargeId = _pendingCharge();
        vm.prank(account); // the account (through its owner) ends the session
        validator.revokeSession();
        PackedUserOperation memory op = _op(_vetoCall(chargeId), sessionPk);
        _expectAA23(abi.encodeWithSelector(VetoOnlySessionValidator.NotInstalled.selector, account));
        _send(op);
    }

    function test_parentCanStillOverrideTheVeto() public {
        uint256 chargeId = _pendingCharge();
        deal(address(TUSD8), parent, 5e6);
        vm.startPrank(parent);
        TUSD8.approve(address(rails), 5e6);
        rails.deposit(vaultId, 5e6);
        vm.stopPrank();
        _send(_op(_vetoCall(chargeId), sessionPk));
        vm.prank(parent);
        rails.approveCharge(chargeId);
        assertEq(uint8(rails.getCharge(chargeId).status), uint8(PocketRails.ChargeStatus.Settled));
        assertEq(TUSD8.balanceOf(school), 1e6);
    }
}
