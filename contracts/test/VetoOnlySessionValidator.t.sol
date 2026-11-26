// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VetoOnlySessionValidator} from "../src/VetoOnlySessionValidator.sol";

/// @notice Unit tests for the veto-only call check and the module lifecycle.
///         The full flow through Aevum's EntryPoint and Kernel is in test/fork/GuardianAccountFork.t.sol.
contract VetoOnlySessionValidatorTest is Test {
    VetoOnlySessionValidator v;
    address rails = makeAddr("rails");
    bytes4 constant VETO = bytes4(keccak256("vetoCharge(uint256,string)"));

    function setUp() public {
        v = new VetoOnlySessionValidator();
    }

    function _exec(bytes32 mode, bytes memory execData) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("execute(bytes32,bytes)", mode, execData);
    }

    function _veto() internal pure returns (bytes memory) {
        return abi.encodeWithSelector(VETO, uint256(7), "duplicate");
    }

    function test_allowsExactlyAVetoCall() public view {
        v.checkCall(_exec(bytes32(0), abi.encodePacked(rails, uint256(0), _veto())), rails);
    }

    function test_allowsAGuardianCheckIn() public view {
        v.checkCall(_exec(bytes32(0), abi.encodePacked(rails, uint256(0), abi.encodeWithSignature("guardianCheckIn(uint64)", uint64(5)))), rails);
    }

    function test_rejectsApproveAndOtherRailsFunctions() public {
        bytes4[3] memory denied = [
            bytes4(keccak256("approveCharge(uint256)")),
            bytes4(keccak256("setGuardianHold(uint256,bool)")),
            bytes4(keccak256("withdraw(uint256,uint256,address)"))
        ];
        for (uint256 i; i < denied.length; i++) {
            vm.expectRevert(abi.encodeWithSelector(VetoOnlySessionValidator.OnlyVetoCharge.selector, denied[i]));
            v.checkCall(_exec(bytes32(0), abi.encodePacked(rails, uint256(0), denied[i], uint256(7))), rails);
        }
    }

    function test_rejectsBatchOrOtherModes() public {
        bytes32 batch = bytes32(uint256(0x01) << 248); // CALLTYPE_BATCH
        vm.expectRevert(VetoOnlySessionValidator.NotSingleCall.selector);
        v.checkCall(_exec(batch, abi.encodePacked(rails, uint256(0), _veto())), rails);
        bytes32 tryMode = bytes32(uint256(0x01) << 240); // EXECTYPE_TRY
        vm.expectRevert(VetoOnlySessionValidator.NotSingleCall.selector);
        v.checkCall(_exec(tryMode, abi.encodePacked(rails, uint256(0), _veto())), rails);
    }

    function test_rejectsTruncatedCall() public {
        vm.expectRevert(abi.encodeWithSelector(VetoOnlySessionValidator.OnlyVetoCharge.selector, bytes4(0)));
        v.checkCall(_exec(bytes32(0), abi.encodePacked(rails, uint256(0), bytes2(0x1234))), rails);
    }

    function test_rejectsLookalikeSelector() public {
        bytes4 other = bytes4(uint32(VETO) ^ 1); // differs in the last bit only
        vm.expectRevert(abi.encodeWithSelector(VetoOnlySessionValidator.OnlyVetoCharge.selector, other));
        v.checkCall(_exec(bytes32(0), abi.encodePacked(rails, uint256(0), other, uint256(7))), rails);
    }

    function test_rejectsNonExecute() public {
        vm.expectRevert(VetoOnlySessionValidator.NotExecute.selector);
        v.checkCall(abi.encodeWithSignature("executeUserOp(bytes,bytes32)", bytes(""), bytes32(0)), rails);
        vm.expectRevert(VetoOnlySessionValidator.NotExecute.selector);
        v.checkCall(hex"00", rails);
    }

    function testFuzz_onlyTheRailsTargetIsAccepted(address target) public {
        vm.assume(target != rails);
        vm.expectRevert(abi.encodeWithSelector(VetoOnlySessionValidator.WrongTarget.selector, target));
        v.checkCall(_exec(bytes32(0), abi.encodePacked(target, uint256(0), _veto())), rails);
    }

    function test_installValidatesSession_andOnlyOncePerAccount() public {
        vm.expectRevert(VetoOnlySessionValidator.BadSession.selector);
        v.onInstall(abi.encode(address(0), rails, uint48(block.timestamp + 1)));
        vm.expectRevert(VetoOnlySessionValidator.BadSession.selector);
        v.onInstall(abi.encode(address(1), rails, uint48(block.timestamp)));

        v.onInstall(abi.encode(address(1), rails, uint48(block.timestamp + 1 days)));
        assertTrue(v.isInitialized(address(this)));
        vm.expectRevert(abi.encodeWithSelector(VetoOnlySessionValidator.AlreadyInstalled.selector, address(this)));
        v.onInstall(abi.encode(address(1), rails, uint48(block.timestamp + 1 days)));

        v.revokeSession();
        assertFalse(v.isInitialized(address(this)));
    }

    function test_sessionKeyCantSignMessagesForTheAccount() public view {
        assertEq(v.isValidSignatureWithSender(address(0), bytes32(0), ""), bytes4(0xffffffff));
        assertTrue(v.isModuleType(1));
        assertFalse(v.isModuleType(2));
    }
}
