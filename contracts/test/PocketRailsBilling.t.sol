// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PocketRails} from "../src/PocketRails.sol";
import {PocketRailsBase} from "./PocketRailsBase.sol";

function _s(PocketRails.ChargeStatus s) pure returns (uint8) {
    return uint8(s);
}

/// @notice School billing permissions: pull charges with caps, expiry, a veto window,
///         a guardian that can only say no, and a parent who is the only one who can say yes.
contract PocketRailsBillingTest is PocketRailsBase {
    using {_s} for PocketRails.ChargeStatus;

    function setUp() public override {
        super.setUp();
        vm.prank(parent);
        rails.setGuardian(vaultId, guardian);
    }

    // ---------------------------------------------------------------- granting

    function test_grant_validatesTerms() public {
        vm.startPrank(parent);
        vm.expectRevert(PocketRails.BadTerms.selector); // veto window too short
        rails.grantBilling(vaultId, _terms(3e6, 15e6, 7 days, 10, false), "");
        vm.expectRevert(PocketRails.BadTerms.selector); // period cap below charge cap
        rails.grantBilling(vaultId, _terms(3e6, 2e6, 7 days, 10 minutes, false), "");
        vm.expectRevert(PocketRails.BadTerms.selector); // zero period
        rails.grantBilling(vaultId, _terms(3e6, 15e6, 0, 10 minutes, false), "");
        vm.stopPrank();

        vm.prank(stranger);
        vm.expectRevert(PocketRails.NotParent.selector);
        rails.grantBilling(vaultId, _terms(3e6, 15e6, 7 days, 10 minutes, false), "");
    }

    function test_grant_bumpsVersion() public {
        uint64 before = rails.getVault(vaultId).version;
        _grantMeals();
        assertEq(rails.getVault(vaultId).version, before + 1);
    }

    // ---------------------------------------------------------------- happy path: silence settles

    function test_charge_settlesAfterVetoWindow() public {
        uint256 billingId = _grantMeals();
        (uint256 chargeId, PocketRails.Reason r) = _charge(billingId, 3e6);
        assertEq(uint8(r), 0);
        assertEq(rails.getCharge(chargeId).status._s(), PocketRails.ChargeStatus.Pending._s());

        vm.expectRevert(PocketRails.VetoWindowOpen.selector);
        rails.settle(chargeId);

        vm.warp(block.timestamp + 10 minutes);
        rails.settle(chargeId); // anyone can settle
        assertEq(rails.getCharge(chargeId).status._s(), PocketRails.ChargeStatus.Settled._s());
        assertEq(token.balanceOf(schoolTreasury), 3e6);
        assertEq(rails.getVault(vaultId).balance, DEPOSIT - 3e6);

        vm.expectRevert(PocketRails.BadState.selector);
        rails.settle(chargeId);
    }

    function test_onlyBillerCanCharge() public {
        uint256 billingId = _grantMeals();
        vm.prank(schoolTreasury);
        vm.expectRevert(PocketRails.NotBiller.selector);
        rails.requestCharge(billingId, 1e6, 0);
        vm.prank(child);
        vm.expectRevert(PocketRails.NotBiller.selector);
        rails.requestCharge(billingId, 1e6, 0);
    }

    // ---------------------------------------------------------------- caps (recorded refusals)

    function test_charge_overPerChargeCap_refused() public {
        uint256 billingId = _grantMeals();
        vm.expectEmit(true, false, false, true, address(rails));
        emit PocketRails.ChargeRefused(billingId, 50e6, keccak256("meal"), PocketRails.Reason.OverChargeLimit);
        (uint256 chargeId, PocketRails.Reason r) = _charge(billingId, 50e6);
        assertEq(chargeId, 0);
        assertEq(uint8(r), uint8(PocketRails.Reason.OverChargeLimit));
    }

    function test_charge_overPeriodCap_refused_thenResets() public {
        uint256 billingId = _grantMeals(); // $15 a week
        for (uint256 i; i < 5; ++i) {
            (, PocketRails.Reason ok) = _charge(billingId, 3e6);
            assertEq(uint8(ok), 0);
        }
        (, PocketRails.Reason r) = _charge(billingId, 1e6);
        assertEq(uint8(r), uint8(PocketRails.Reason.OverPeriodLimit));

        vm.warp(block.timestamp + 7 days);
        (, r) = _charge(billingId, 3e6);
        assertEq(uint8(r), 0);
    }

    function test_charge_afterExpiry_refused() public {
        uint256 billingId = _grantMeals();
        vm.warp(block.timestamp + 180 days);
        (, PocketRails.Reason r) = _charge(billingId, 1e6);
        assertEq(uint8(r), uint8(PocketRails.Reason.BillingExpired));
    }

    // ---------------------------------------------------------------- veto: AI can say no

    function test_guardianVetoes_amountReturnsToAllowance() public {
        uint256 billingId = _grantMeals();
        (uint256 chargeId,) = _charge(billingId, 3e6);
        uint256 usedBefore = rails.getBilling(billingId).periodUsed;

        vm.expectEmit(true, true, false, true, address(rails));
        emit PocketRails.ChargeVetoed(billingId, chargeId, guardian, "Duplicate of today's meal");
        vm.prank(guardian);
        rails.vetoCharge(chargeId, "Duplicate of today's meal");

        assertEq(rails.getCharge(chargeId).status._s(), PocketRails.ChargeStatus.Vetoed._s());
        assertEq(rails.getBilling(billingId).periodUsed, usedBefore - 3e6);
        vm.warp(block.timestamp + 10 minutes);
        vm.expectRevert(PocketRails.BadState.selector);
        rails.settle(chargeId);
        assertEq(token.balanceOf(schoolTreasury), 0);
    }

    function test_vetoOnlyInsideWindow() public {
        uint256 billingId = _grantMeals();
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.warp(block.timestamp + 10 minutes);
        vm.prank(guardian);
        vm.expectRevert(PocketRails.VetoWindowClosed.selector);
        rails.vetoCharge(chargeId, "too late");
    }

    function test_strangersCannotVeto() public {
        uint256 billingId = _grantMeals();
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.prank(stranger);
        vm.expectRevert(PocketRails.NotParentOrGuardian.selector);
        rails.vetoCharge(chargeId, "");
        vm.prank(schoolBiller);
        vm.expectRevert(PocketRails.NotParentOrGuardian.selector);
        rails.vetoCharge(chargeId, "");
    }

    function test_removedGuardianCannotVeto() public {
        uint256 billingId = _grantMeals();
        vm.prank(parent);
        rails.setGuardian(vaultId, address(0));
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.prank(guardian);
        vm.expectRevert(PocketRails.NotParentOrGuardian.selector);
        rails.vetoCharge(chargeId, "");
    }

    // ---------------------------------------------------------------- only a parent can say yes

    function test_guardianCanNeverApprove() public {
        uint256 billingId = _grantMeals();
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.prank(guardian);
        vm.expectRevert(PocketRails.NotParent.selector);
        rails.approveCharge(chargeId);
    }

    function test_parentOverridesWrongVeto() public {
        uint256 billingId = _grantMeals();
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.prank(guardian);
        rails.vetoCharge(chargeId, "looks unusual");

        vm.prank(parent);
        rails.approveCharge(chargeId);
        assertEq(rails.getCharge(chargeId).status._s(), PocketRails.ChargeStatus.Settled._s());
        assertEq(token.balanceOf(schoolTreasury), 3e6);
        assertEq(rails.getBilling(billingId).periodUsed, 3e6, "override counts toward the period");
    }

    function test_parentCanApproveEarly() public {
        uint256 billingId = _grantMeals();
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.prank(parent);
        rails.approveCharge(chargeId);
        assertEq(token.balanceOf(schoolTreasury), 3e6);
    }

    function test_firstChargeNeedsParentApproval() public {
        vm.prank(parent);
        uint256 billingId = rails.grantBilling(vaultId, _terms(3e6, 15e6, 7 days, 10 minutes, true), "Meal plan");

        (uint256 first,) = _charge(billingId, 3e6);
        assertEq(rails.getCharge(first).status._s(), PocketRails.ChargeStatus.AwaitingParent._s());
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(PocketRails.BadState.selector);
        rails.settle(first); // silence does NOT settle the first charge

        vm.prank(parent);
        rails.approveCharge(first);

        (uint256 second,) = _charge(billingId, 3e6);
        assertEq(rails.getCharge(second).status._s(), PocketRails.ChargeStatus.Pending._s());
    }

    function test_firstCharge_canBeDeclinedAnyTime() public {
        vm.prank(parent);
        uint256 billingId = rails.grantBilling(vaultId, _terms(3e6, 15e6, 7 days, 10 minutes, true), "Meal plan");
        (uint256 first,) = _charge(billingId, 3e6);
        vm.warp(block.timestamp + 1 days);
        vm.prank(parent);
        rails.vetoCharge(first, "I didn't sign up for this");
        assertEq(rails.getCharge(first).status._s(), PocketRails.ChargeStatus.Vetoed._s());
    }

    // ---------------------------------------------------------------- revocation kills pending charges

    function test_revokeBilling_pendingChargesFail() public {
        uint256 billingId = _grantMeals();
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.prank(parent);
        rails.revokeBilling(billingId);

        vm.warp(block.timestamp + 10 minutes);
        vm.expectEmit(true, true, false, true, address(rails));
        emit PocketRails.ChargeFailed(billingId, chargeId, PocketRails.Reason.BillingRevoked);
        rails.settle(chargeId);
        assertEq(token.balanceOf(schoolTreasury), 0);

        (, PocketRails.Reason r) = _charge(billingId, 1e6);
        assertEq(uint8(r), uint8(PocketRails.Reason.BillingRevoked));
    }

    function test_approveAfterRevoke_cannotPay() public {
        uint256 billingId = _grantMeals();
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.startPrank(parent);
        rails.revokeBilling(billingId);
        rails.approveCharge(chargeId); // even the parent's own "yes" can't revive a revoked permission
        vm.stopPrank();
        assertEq(rails.getCharge(chargeId).status._s(), PocketRails.ChargeStatus.Failed._s());
        assertEq(token.balanceOf(schoolTreasury), 0);
    }

    function test_revokeAll_stopsEverything() public {
        uint256 billingId = _grantMeals();
        (uint256 chargeId,) = _charge(billingId, 3e6);

        vm.prank(parent);
        rails.revokeAll(vaultId);

        vm.warp(block.timestamp + 10 minutes);
        rails.settle(chargeId);
        assertEq(rails.getCharge(chargeId).status._s(), PocketRails.ChargeStatus.Failed._s());
        (, PocketRails.Reason r) = _charge(billingId, 1e6);
        assertEq(uint8(r), uint8(PocketRails.Reason.BillingRevoked));
        assertEq(uint8(_pay(canteen, 1e6)), uint8(PocketRails.Reason.AccessRevoked));
        assertEq(token.balanceOf(schoolTreasury), 0);
        assertEq(rails.getVault(vaultId).balance, DEPOSIT, "funds stay for the parent");
    }

    function test_settle_insufficientBalance_fails() public {
        uint256 billingId = _grantMeals();
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.prank(parent);
        rails.withdraw(vaultId, DEPOSIT, parent);
        vm.warp(block.timestamp + 10 minutes);
        rails.settle(chargeId);
        assertEq(rails.getCharge(chargeId).status._s(), PocketRails.ChargeStatus.Failed._s());
        assertEq(rails.getBilling(billingId).periodUsed, 0, "failed charge frees the allowance");
    }

    function test_unknownCharge_reverts() public {
        vm.expectRevert(PocketRails.BadState.selector);
        rails.settle(42);
        vm.prank(parent);
        vm.expectRevert(abi.encodeWithSelector(PocketRails.UnknownVault.selector, 0));
        rails.approveCharge(42);
    }

    // ---------------------------------------------------------------- fuzz

    /// @notice However the biller splits its requests, settled money in one period never passes the cap.
    function testFuzz_periodCapHolds(uint256[10] memory amounts) public {
        uint256 billingId = _grantMeals();
        for (uint256 i; i < amounts.length; ++i) {
            (uint256 chargeId, PocketRails.Reason r) = _charge(billingId, bound(amounts[i], 1, 5e6));
            if (r == PocketRails.Reason.None) {
                vm.prank(parent);
                rails.approveCharge(chargeId);
            }
        }
        assertLe(token.balanceOf(schoolTreasury), 15e6);
    }
}
