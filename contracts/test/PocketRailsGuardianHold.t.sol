// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PocketRails} from "../src/PocketRails.sol";
import {PocketRailsBase} from "./PocketRailsBase.sol";

/// @notice "Hold school charges while the guardian is offline": with the hold on, silence from the
///         guardian no longer lets a charge settle; the guardian has to check in after the charge was requested.
contract PocketRailsGuardianHoldTest is PocketRailsBase {
    uint256 billingId;

    function setUp() public override {
        super.setUp();
        vm.startPrank(parent);
        rails.setGuardian(vaultId, guardian);
        rails.setGuardianHold(vaultId, true);
        vm.stopPrank();
        billingId = _grantMeals(); // 10-minute veto window
    }

    function _status(uint256 chargeId) internal view returns (PocketRails.ChargeStatus) {
        return rails.getCharge(chargeId).status;
    }

    function test_onlyParentCanSetHold_andItBumpsVersion() public {
        vm.prank(stranger);
        vm.expectRevert(PocketRails.NotParent.selector);
        rails.setGuardianHold(vaultId, false);
        vm.prank(guardian);
        vm.expectRevert(PocketRails.NotParent.selector);
        rails.setGuardianHold(vaultId, false);

        uint64 before = rails.getVault(vaultId).version;
        vm.expectEmit(true, true, false, true, address(rails));
        emit PocketRails.GuardianHoldChanged(vaultId, before + 1, parent, false);
        vm.prank(parent);
        rails.setGuardianHold(vaultId, false);
        assertFalse(rails.holdIfGuardianSilent(vaultId));
    }

    function test_silentGuardian_chargeIsHeldPastItsWindow() public {
        (uint256 chargeId,) = _charge(billingId, 3e6);
        assertFalse(rails.isHeld(chargeId)); // window still open: not "held" yet
        vm.warp(block.timestamp + 1 days);
        assertTrue(rails.isHeld(chargeId));
        vm.expectRevert(PocketRails.GuardianSilent.selector);
        rails.settle(chargeId);
        assertEq(uint8(_status(chargeId)), uint8(PocketRails.ChargeStatus.Pending));
        assertEq(rails.getVault(vaultId).balance, DEPOSIT);
    }

    function test_checkInBeforeTheCharge_doesNotCount() public {
        vm.prank(guardian);
        rails.guardianCheckIn(uint64(block.timestamp));
        vm.warp(block.timestamp + 1);
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.warp(block.timestamp + 10 minutes);
        vm.expectRevert(PocketRails.GuardianSilent.selector);
        rails.settle(chargeId);
    }

    function test_checkInInTheSameSecondAsTheCharge_doesNotCount() public {
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.prank(guardian);
        rails.guardianCheckIn(uint64(block.timestamp)); // same timestamp: the guardian can't have reviewed it yet
        vm.warp(block.timestamp + 10 minutes);
        assertTrue(rails.isHeld(chargeId));
    }

    function test_checkInAfterTheCharge_releasesIt() public {
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.warp(block.timestamp + 1 minutes);
        vm.expectEmit(true, false, false, true, address(rails));
        emit PocketRails.GuardianCheckedIn(guardian, uint64(block.timestamp));
        vm.prank(guardian);
        rails.guardianCheckIn(uint64(block.timestamp));

        // Checking in doesn't skip the veto window.
        vm.expectRevert(PocketRails.VetoWindowOpen.selector);
        rails.settle(chargeId);

        vm.warp(block.timestamp + 10 minutes);
        assertFalse(rails.isHeld(chargeId));
        rails.settle(chargeId);
        assertEq(uint8(_status(chargeId)), uint8(PocketRails.ChargeStatus.Settled));
        assertEq(token.balanceOf(schoolTreasury), 3e6);
    }

    function test_heldCharge_canStillBeVetoedByGuardianOrParent() public {
        (uint256 a,) = _charge(billingId, 3e6);
        (uint256 b,) = _charge(billingId, 2e6);
        vm.warp(block.timestamp + 1 days);

        vm.prank(guardian); // guardian comes back, reviews, vetoes, then checks in
        rails.vetoCharge(a, "duplicate");
        vm.prank(parent);
        rails.vetoCharge(b, "not this week");
        assertEq(uint8(_status(a)), uint8(PocketRails.ChargeStatus.Vetoed));
        assertEq(uint8(_status(b)), uint8(PocketRails.ChargeStatus.Vetoed));
    }

    function test_afterCheckIn_lateVetoIsRefusedAgain() public {
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.warp(block.timestamp + 1 days);
        vm.prank(guardian);
        rails.guardianCheckIn(uint64(block.timestamp));
        vm.prank(guardian);
        vm.expectRevert(PocketRails.VetoWindowClosed.selector);
        rails.vetoCharge(chargeId, "too late");
    }

    function test_parentCanApproveAHeldCharge() public {
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.warp(block.timestamp + 1 days);
        vm.prank(parent);
        rails.approveCharge(chargeId);
        assertEq(uint8(_status(chargeId)), uint8(PocketRails.ChargeStatus.Settled));
    }

    function test_turningHoldOff_releasesHeldCharges() public {
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.warp(block.timestamp + 1 days);
        vm.prank(parent);
        rails.setGuardianHold(vaultId, false);
        assertFalse(rails.isHeld(chargeId));
        rails.settle(chargeId);
        assertEq(uint8(_status(chargeId)), uint8(PocketRails.ChargeStatus.Settled));
    }

    function test_noGuardian_meansNoHold() public {
        vm.prank(parent);
        rails.setGuardian(vaultId, address(0));
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.warp(block.timestamp + 10 minutes);
        rails.settle(chargeId);
        assertEq(uint8(_status(chargeId)), uint8(PocketRails.ChargeStatus.Settled));
    }

    function test_newGuardian_mustCheckInItself() public {
        address other = makeAddr("otherGuardian");
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.warp(block.timestamp + 1 minutes);
        vm.prank(guardian);
        rails.guardianCheckIn(uint64(block.timestamp)); // the old guardian
        vm.prank(parent);
        rails.setGuardian(vaultId, other);
        vm.warp(block.timestamp + 10 minutes);
        vm.expectRevert(PocketRails.GuardianSilent.selector);
        rails.settle(chargeId);
        vm.prank(other);
        rails.guardianCheckIn(uint64(block.timestamp));
        rails.settle(chargeId);
    }

    function test_checkInByAnyoneElse_doesNotRelease() public {
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.warp(block.timestamp + 1 minutes);
        vm.prank(schoolBiller);
        rails.guardianCheckIn(uint64(block.timestamp)); // anyone may call it, but it only records the caller
        vm.warp(block.timestamp + 10 minutes);
        vm.expectRevert(PocketRails.GuardianSilent.selector);
        rails.settle(chargeId);
    }

    function test_checkIn_coversOnlyWhatWasReviewed() public {
        vm.warp(block.timestamp + 1 minutes);
        uint64 reviewedAt = uint64(block.timestamp); // the guardian reads the chain here...
        vm.warp(block.timestamp + 5);
        (uint256 chargeId,) = _charge(billingId, 3e6); // ...a charge arrives before its check-in lands...
        vm.warp(block.timestamp + 5);
        vm.prank(guardian);
        rails.guardianCheckIn(reviewedAt); // ...so the check-in doesn't cover it
        vm.warp(block.timestamp + 10 minutes);
        vm.expectRevert(PocketRails.GuardianSilent.selector);
        rails.settle(chargeId);
    }

    function test_checkIn_isCappedAtNow_andNeverGoesBack() public {
        vm.prank(guardian);
        rails.guardianCheckIn(type(uint64).max); // can't pre-approve the future
        assertEq(rails.guardianLastSeen(guardian), uint64(block.timestamp));
        uint64 at = uint64(block.timestamp);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(guardian);
        rails.guardianCheckIn(at - 30); // older than what's recorded: ignored
        assertEq(rails.guardianLastSeen(guardian), at);
    }

    function test_holdIsPerVault() public {
        // Hold off by default for a new vault.
        assertFalse(rails.holdIfGuardianSilent(vaultId + 1));
        assertFalse(rails.isHeld(999)); // unknown charge
    }
}
