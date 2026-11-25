// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PocketRails} from "../src/PocketRails.sol";
import {PocketRailsBase} from "./PocketRailsBase.sol";

/// @notice Earmarked school funds: money the parent sets aside that the child's spending can't touch,
///         but school charges can.
contract PocketRailsReserveTest is PocketRailsBase {
    function _reserve(uint256 amount) internal {
        vm.prank(parent);
        rails.setSchoolReserve(vaultId, amount);
    }

    function test_setReserve_onlyParent_bumpsVersion_cannotExceedBalance() public {
        uint64 before = rails.getVault(vaultId).version;
        _reserve(60e6);
        assertEq(rails.getVault(vaultId).schoolReserve, 60e6);
        assertEq(rails.getVault(vaultId).version, before + 1);

        vm.prank(child);
        vm.expectRevert(PocketRails.NotParent.selector);
        rails.setSchoolReserve(vaultId, 0);

        vm.prank(parent);
        vm.expectRevert(PocketRails.NotEnoughBalance.selector);
        rails.setSchoolReserve(vaultId, DEPOSIT + 1);
    }

    function test_childCantSpendTheReserve() public {
        // 100 in the vault, 97 set aside: the child can spend only 3.
        _reserve(97e6);
        assertEq(uint8(_pay(canteen, 3e6)), 0);
        assertEq(uint8(_pay(canteen, 1)), uint8(PocketRails.Reason.EarmarkedForSchool));
        assertEq(rails.getVault(vaultId).balance, 97e6, "the reserve is untouched");
    }

    function test_previewShowsTheEarmark() public {
        _reserve(99e6);
        assertEq(uint8(rails.previewPayment(vaultId, canteen, 2e6, 0, 0)), uint8(PocketRails.Reason.EarmarkedForSchool));
        assertEq(uint8(rails.previewPayment(vaultId, canteen, 1e6, 0, 0)), 0);
    }

    function test_insufficientBalanceStillReportedFirst() public {
        vm.prank(parent);
        rails.withdraw(vaultId, DEPOSIT - 1e6, parent);
        _reserve(1e6);
        // More than the whole balance: the plain "not enough money" reason, not the earmark.
        assertEq(uint8(_pay(canteen, 2e6)), uint8(PocketRails.Reason.InsufficientBalance));
    }

    function test_exceptionsCantSpendTheReserveEither() public {
        uint256 id = _request(stranger, 15e6, keccak256("trip"));
        vm.prank(parent);
        rails.allowOnce(id, uint64(block.timestamp + 1 days));
        _reserve(90e6); // leaves 10 spendable, less than the 15 exception
        assertEq(uint8(_payWith(stranger, 15e6, keccak256("trip"), id)), uint8(PocketRails.Reason.EarmarkedForSchool));
        _reserve(85e6); // the parent lowers the reserve: now it fits
        assertEq(uint8(_payWith(stranger, 15e6, keccak256("trip"), id)), 0);
    }

    function test_schoolChargesUseTheReserve() public {
        vm.prank(parent);
        uint256 billingId = rails.grantBilling(vaultId, _terms(3e6, 15e6, 7 days, 10 minutes, false), "Bus pass");
        _reserve(100e6); // everything set aside for school: the child can't spend anything
        assertEq(uint8(_pay(canteen, 1e6)), uint8(PocketRails.Reason.EarmarkedForSchool));

        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.warp(block.timestamp + 10 minutes);
        rails.settle(chargeId);
        assertEq(token.balanceOf(schoolTreasury), 3e6, "the school is paid from the reserve");
        assertEq(rails.getVault(vaultId).schoolReserve, 97e6, "the reserve goes down by the charge");
        assertEq(rails.getVault(vaultId).balance, 97e6);
    }

    function test_schoolChargeLargerThanReserve_zeroesIt() public {
        vm.prank(parent);
        uint256 billingId = rails.grantBilling(vaultId, _terms(3e6, 15e6, 7 days, 10 minutes, false), "Bus pass");
        _reserve(2e6);
        (uint256 chargeId,) = _charge(billingId, 3e6);
        vm.warp(block.timestamp + 10 minutes);
        rails.settle(chargeId);
        assertEq(rails.getVault(vaultId).schoolReserve, 0);
        assertEq(rails.getVault(vaultId).balance, DEPOSIT - 3e6);
    }

    function test_withdrawShrinksTheReserveToFit() public {
        _reserve(80e6);
        vm.prank(parent);
        rails.withdraw(vaultId, 50e6, parent); // the parent can always take money out
        PocketRails.Vault memory v = rails.getVault(vaultId);
        assertEq(v.balance, 50e6);
        assertEq(v.schoolReserve, 50e6);
    }

    function test_depositKeepsReserve_andRaisesWhatTheChildCanSpend() public {
        _reserve(DEPOSIT);
        assertEq(uint8(_pay(canteen, 1e6)), uint8(PocketRails.Reason.EarmarkedForSchool));
        vm.prank(parent);
        rails.deposit(vaultId, 5e6);
        assertEq(rails.getVault(vaultId).schoolReserve, DEPOSIT);
        assertEq(uint8(_pay(canteen, 5e6)), 0);
    }

    /// @notice However the child splits payments, the reserve is never spent by the child.
    function testFuzz_childNeverSpendsReserve(uint256 reserve, uint256[6] memory amounts) public {
        reserve = bound(reserve, 0, DEPOSIT);
        _reserve(reserve);
        for (uint256 i; i < amounts.length; ++i) {
            _pay(canteen, bound(amounts[i], 1, 5e6));
        }
        assertGe(rails.getVault(vaultId).balance, reserve);
        assertEq(rails.getVault(vaultId).schoolReserve, reserve);
    }
}
