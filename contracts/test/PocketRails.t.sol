// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PocketRails} from "../src/PocketRails.sol";
import {PocketRailsBase} from "./PocketRailsBase.sol";

/// @notice Vault setup, child payments, refusals, revocation and one-time exceptions.
contract PocketRailsTest is PocketRailsBase {
    // ---------------------------------------------------------------- setup and funding

    function test_createVault_startsAtVersion1() public view {
        PocketRails.Vault memory v = rails.getVault(vaultId);
        assertEq(v.parent, parent);
        assertEq(v.child, child);
        assertTrue(v.childActive);
        assertEq(v.version, 1);
        assertEq(v.balance, DEPOSIT);
        assertTrue(rails.isApprovedPayee(vaultId, canteen));
        assertTrue(rails.isApprovedPayee(vaultId, bookshop));
        assertFalse(rails.isApprovedPayee(vaultId, stranger));
    }

    function test_createVault_rejectsBadRules() public {
        address[] memory none = new address[](0);
        string[] memory noLabels = new string[](0);
        vm.startPrank(parent);
        vm.expectRevert(PocketRails.BadRules.selector); // weekly below per-payment
        rails.createVault(child, _rules(10e6, 5e6, 1 days), none, noLabels);
        vm.expectRevert(PocketRails.BadRules.selector); // zero limit
        rails.createVault(child, _rules(0, 5e6, 1 days), none, noLabels);
        vm.expectRevert(PocketRails.BadRules.selector); // no expiry in the future
        rails.createVault(child, _rules(1e6, 5e6, 0), none, noLabels);
        vm.stopPrank();
    }

    function test_anyoneCanTopUp_onlyParentWithdraws() public {
        token.mint(stranger, 10e6);
        vm.startPrank(stranger);
        token.approve(address(rails), 10e6);
        rails.deposit(vaultId, 10e6);
        vm.expectRevert(PocketRails.NotParent.selector);
        rails.withdraw(vaultId, 1e6, stranger);
        vm.stopPrank();

        vm.prank(parent);
        rails.withdraw(vaultId, 110e6, parent);
        assertEq(rails.getVault(vaultId).balance, 0);
    }

    function test_withdraw_cannotExceedBalance() public {
        vm.prank(parent);
        vm.expectRevert(PocketRails.NotEnoughBalance.selector);
        rails.withdraw(vaultId, DEPOSIT + 1, parent);
    }

    function test_unknownVault_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(PocketRails.UnknownVault.selector, 999));
        rails.getVault(999);
    }

    // ---------------------------------------------------------------- allowed payments

    function test_pay_insideRules_paysWithoutApproval() public {
        PocketRails.Payment memory p = _payment(canteen, 3e6, keccak256("lunch"), 0);
        bytes memory sig = _signPayment(childKey, p);

        vm.expectEmit(true, true, true, true, address(rails));
        emit PocketRails.Paid(vaultId, canteen, 3e6, keccak256("lunch"), 0, p.nonce);
        vm.prank(relayer);
        PocketRails.Reason r = rails.pay(p, sig);

        assertEq(uint8(r), uint8(PocketRails.Reason.None));
        assertEq(token.balanceOf(canteen), 3e6);
        assertEq(rails.getVault(vaultId).balance, DEPOSIT - 3e6);
        assertEq(rails.spentThisWeek(vaultId), 3e6);
        assertTrue(rails.nonceUsed(vaultId, p.nonce));
    }

    function test_pay_childCanSubmitItself() public {
        PocketRails.Payment memory p = _payment(canteen, 1e6, 0, 0);
        bytes memory sig = _signPayment(childKey, p);
        vm.prank(child);
        rails.pay(p, sig);
        assertEq(token.balanceOf(canteen), 1e6);
    }

    // ---------------------------------------------------------------- refusals are recorded, not reverted

    function _expectRefusal(address payee, uint256 amount, PocketRails.Reason expected) internal {
        uint256 before = rails.getVault(vaultId).balance;
        PocketRails.Payment memory p = _payment(payee, amount, 0, 0);
        bytes memory sig = _signPayment(childKey, p);

        vm.expectEmit(true, true, true, true, address(rails));
        emit PocketRails.Refused(vaultId, payee, amount, 0, 0, p.nonce, expected);
        vm.prank(relayer);
        PocketRails.Reason r = rails.pay(p, sig);

        assertEq(uint8(r), uint8(expected));
        assertEq(rails.getVault(vaultId).balance, before, "no money moves on refusal");
        assertTrue(rails.nonceUsed(vaultId, p.nonce), "a refused intent can't be replayed later");
    }

    function test_refuse_payeeNotApproved() public {
        _expectRefusal(stranger, 1e6, PocketRails.Reason.PayeeNotApproved);
    }

    function test_refuse_overPerPaymentLimit() public {
        _expectRefusal(canteen, PER_PAYMENT + 1, PocketRails.Reason.OverPaymentLimit);
    }

    function test_refuse_overWeeklyLimit() public {
        for (uint256 i; i < 4; ++i) {
            assertEq(uint8(_pay(canteen, 5e6)), 0);
        }
        _expectRefusal(canteen, 1, PocketRails.Reason.OverWeeklyLimit);
    }

    function test_weeklyLimit_resetsOnMonday() public {
        for (uint256 i; i < 4; ++i) {
            _pay(canteen, 5e6);
        }
        _expectRefusal(canteen, 1e6, PocketRails.Reason.OverWeeklyLimit);

        // setUp is Wednesday 12:00 UTC; Monday 00:00 UTC is 4.5 days later.
        vm.warp(block.timestamp + 4 days + 12 hours - 1);
        _expectRefusal(canteen, 1e6, PocketRails.Reason.OverWeeklyLimit);
        vm.warp(block.timestamp + 1);
        assertEq(rails.spentThisWeek(vaultId), 0);
        assertEq(uint8(_pay(canteen, 5e6)), 0);
    }

    function test_refuse_insufficientBalance() public {
        vm.prank(parent);
        rails.withdraw(vaultId, DEPOSIT - 1e6, parent);
        _expectRefusal(canteen, 2e6, PocketRails.Reason.InsufficientBalance);
    }

    function test_refuse_afterAccessExpires() public {
        vm.warp(block.timestamp + 90 days);
        _expectRefusal(canteen, 1e6, PocketRails.Reason.AccessExpired);
    }

    function test_refuse_afterRevoke_andOldIntentsStayDeadAfterRestore() public {
        // Child signs a payment but it isn't submitted yet.
        PocketRails.Payment memory old = _payment(canteen, 1e6, 0, 0);
        bytes memory oldSig = _signPayment(childKey, old);

        vm.prank(parent);
        rails.revokeChild(vaultId);
        _expectRefusal(canteen, 1e6, PocketRails.Reason.AccessRevoked);

        // Parent turns access back on for the same child: a new epoch.
        vm.prank(parent);
        rails.setChild(vaultId, child);
        vm.prank(relayer);
        assertEq(uint8(rails.pay(old, oldSig)), uint8(PocketRails.Reason.AccessRevoked));
        assertEq(uint8(_pay(canteen, 1e6)), 0, "fresh intents work again");
    }

    function test_previewPayment_matchesRules() public view {
        assertEq(uint8(rails.previewPayment(vaultId, canteen, 1e6, 0, 0)), 0);
        assertEq(uint8(rails.previewPayment(vaultId, stranger, 1e6, 0, 0)), uint8(PocketRails.Reason.PayeeNotApproved));
        assertEq(uint8(rails.previewPayment(vaultId, canteen, 6e6, 0, 0)), uint8(PocketRails.Reason.OverPaymentLimit));
    }

    // ---------------------------------------------------------------- signature-level problems revert

    function test_revert_wrongSigner() public {
        (, uint256 otherKey) = makeAddrAndKey("not-the-child");
        PocketRails.Payment memory p = _payment(canteen, 1e6, 0, 0);
        bytes memory sig = _signPayment(otherKey, p);
        vm.expectRevert(PocketRails.BadSignature.selector);
        rails.pay(p, sig);
    }

    function test_revert_tamperedIntent() public {
        PocketRails.Payment memory p = _payment(canteen, 1e6, 0, 0);
        bytes memory sig = _signPayment(childKey, p);
        p.payee = stranger; // a relayer tries to redirect the payment
        vm.expectRevert(PocketRails.BadSignature.selector);
        rails.pay(p, sig);
    }

    function test_revert_replay() public {
        PocketRails.Payment memory p = _payment(canteen, 1e6, 0, 0);
        bytes memory sig = _signPayment(childKey, p);
        rails.pay(p, sig);
        vm.expectRevert(PocketRails.NonceAlreadyUsed.selector);
        rails.pay(p, sig);
    }

    function test_revert_expiredDeadline() public {
        PocketRails.Payment memory p = _payment(canteen, 1e6, 0, 0);
        bytes memory sig = _signPayment(childKey, p);
        vm.warp(p.deadline + 1);
        vm.expectRevert(PocketRails.IntentExpired.selector);
        rails.pay(p, sig);
    }

    function test_revert_signatureForAnotherDeployment() public {
        // Same intent, signed for a different PocketRails contract: the EIP-712 domain differs.
        PocketRails other = new PocketRails(IERC20(address(token)));
        PocketRails.Payment memory p = _payment(canteen, 1e6, 0, 0);
        bytes32 structHash = keccak256(
            abi.encode(
                rails.PAYMENT_TYPEHASH(),
                p.vaultId,
                p.payee,
                p.amount,
                p.memoHash,
                p.exceptionId,
                p.nonce,
                p.epoch,
                p.deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(childKey, keccak256(abi.encodePacked("\x19\x01", other.domainSeparator(), structHash)));
        vm.expectRevert(PocketRails.BadSignature.selector);
        rails.pay(p, abi.encodePacked(r, s, v));
    }

    // ---------------------------------------------------------------- versioned rules

    function test_everyChangeBumpsVersion() public {
        vm.startPrank(parent);
        rails.setRules(vaultId, _rules(6e6, 30e6, 30 days));
        assertEq(rails.getVault(vaultId).version, 2);
        rails.setPayee(vaultId, stranger, true, "Bus company");
        assertEq(rails.getVault(vaultId).version, 3);
        rails.setGuardian(vaultId, guardian);
        assertEq(rails.getVault(vaultId).version, 4);
        rails.revokeChild(vaultId);
        assertEq(rails.getVault(vaultId).version, 5);
        vm.stopPrank();
    }

    function test_onlyParentChangesRules() public {
        vm.startPrank(child);
        vm.expectRevert(PocketRails.NotParent.selector);
        rails.setRules(vaultId, _rules(50e6, 500e6, 30 days));
        vm.expectRevert(PocketRails.NotParent.selector);
        rails.setPayee(vaultId, stranger, true, "");
        vm.expectRevert(PocketRails.NotParent.selector);
        rails.setChild(vaultId, child);
        vm.stopPrank();

        vm.prank(guardian);
        vm.expectRevert(PocketRails.NotParent.selector);
        rails.setRules(vaultId, _rules(50e6, 500e6, 30 days));
    }

    function test_removedPayee_isRefused() public {
        vm.prank(parent);
        rails.setPayee(vaultId, canteen, false, "School canteen");
        _expectRefusal(canteen, 1e6, PocketRails.Reason.PayeeNotApproved);
    }

    // ---------------------------------------------------------------- one-time exceptions

    bytes32 constant TRIP = keccak256("museum trip");

    function _allowedTrip() internal returns (uint256 id) {
        id = _request(stranger, 15e6, TRIP);
        vm.prank(parent);
        rails.allowOnce(id, uint64(block.timestamp + 1 days));
    }

    function test_exception_fullFlow() public {
        uint256 id = _request(stranger, 15e6, TRIP);
        assertEq(uint8(rails.getException(id).status), uint8(PocketRails.ExceptionStatus.Pending));

        // Not usable while pending.
        assertEq(uint8(_payWith(stranger, 15e6, TRIP, id)), uint8(PocketRails.Reason.ExceptionNotApproved));

        vm.prank(parent);
        rails.allowOnce(id, uint64(block.timestamp + 1 days));
        assertEq(uint8(_payWith(stranger, 15e6, TRIP, id)), 0);
        assertEq(token.balanceOf(stranger), 15e6);
        assertEq(uint8(rails.getException(id).status), uint8(PocketRails.ExceptionStatus.Used));
    }

    function test_exception_worksOnlyOnce() public {
        uint256 id = _allowedTrip();
        assertEq(uint8(_payWith(stranger, 15e6, TRIP, id)), 0);
        assertEq(uint8(_payWith(stranger, 15e6, TRIP, id)), uint8(PocketRails.Reason.ExceptionNotApproved));
    }

    function test_exception_mustMatchExactly() public {
        uint256 id = _allowedTrip();
        assertEq(uint8(_payWith(stranger, 15e6 + 1, TRIP, id)), uint8(PocketRails.Reason.ExceptionMismatch));
        assertEq(uint8(_payWith(bookshop, 15e6, TRIP, id)), uint8(PocketRails.Reason.ExceptionMismatch));
        assertEq(uint8(_payWith(stranger, 15e6, keccak256("arcade"), id)), uint8(PocketRails.Reason.ExceptionMismatch));
        // The mismatches didn't burn it: the exact payment still works once.
        assertEq(uint8(_payWith(stranger, 15e6, TRIP, id)), 0);
    }

    function test_exception_doesNotChangeRulesOrWeeklyAllowance() public {
        uint64 versionBefore = rails.getVault(vaultId).version;
        uint256 id = _allowedTrip();
        _payWith(stranger, 15e6, TRIP, id);
        assertEq(rails.getVault(vaultId).version, versionBefore, "rules unchanged");
        assertFalse(rails.isApprovedPayee(vaultId, stranger), "payee not added");
        assertEq(rails.spentThisWeek(vaultId), 0, "weekly allowance untouched");
        assertEq(uint8(_pay(stranger, 1e6)), uint8(PocketRails.Reason.PayeeNotApproved));
    }

    function test_exception_declined() public {
        uint256 id = _request(stranger, 15e6, TRIP);
        vm.prank(parent);
        rails.declineException(id);
        assertEq(uint8(_payWith(stranger, 15e6, TRIP, id)), uint8(PocketRails.Reason.ExceptionNotApproved));
        vm.prank(parent);
        vm.expectRevert(PocketRails.BadState.selector);
        rails.allowOnce(id, uint64(block.timestamp + 1 days));
    }

    function test_exception_parentCanCancelAfterAllowing() public {
        uint256 id = _allowedTrip();
        vm.prank(parent);
        rails.declineException(id);
        assertEq(uint8(_payWith(stranger, 15e6, TRIP, id)), uint8(PocketRails.Reason.ExceptionNotApproved));
    }

    function test_exception_expires() public {
        uint256 id = _allowedTrip();
        vm.warp(block.timestamp + 1 days + 1);
        assertEq(uint8(_payWith(stranger, 15e6, TRIP, id)), uint8(PocketRails.Reason.ExceptionNotApproved));
    }

    function test_exception_diesOnRevoke() public {
        uint256 id = _allowedTrip();
        vm.startPrank(parent);
        rails.revokeChild(vaultId);
        rails.setChild(vaultId, child);
        vm.stopPrank();
        assertEq(uint8(_payWith(stranger, 15e6, TRIP, id)), uint8(PocketRails.Reason.ExceptionNotApproved));
    }

    function test_exception_onlyParentDecides() public {
        uint256 id = _request(stranger, 15e6, TRIP);
        vm.prank(child);
        vm.expectRevert(PocketRails.NotParent.selector);
        rails.allowOnce(id, uint64(block.timestamp + 1 days));
        vm.prank(guardian);
        vm.expectRevert(PocketRails.NotParent.selector);
        rails.allowOnce(id, uint64(block.timestamp + 1 days));
    }

    function test_exception_cannotBeUsedFromAnotherVault() public {
        uint256 id = _allowedTrip();
        // A second family with the same child key.
        address[] memory none = new address[](0);
        string[] memory noLabels = new string[](0);
        vm.prank(stranger);
        uint256 otherVault = rails.createVault(child, _rules(5e6, 20e6, 30 days), none, noLabels);

        PocketRails.Payment memory p = _payment(stranger, 15e6, TRIP, id);
        p.vaultId = otherVault;
        p.epoch = 1;
        bytes memory sig = _signPayment(childKey, p);
        assertEq(uint8(rails.pay(p, sig)), uint8(PocketRails.Reason.ExceptionNotApproved));
    }

    function test_requestException_refusedWhenRevoked() public {
        vm.prank(parent);
        rails.revokeChild(vaultId);
        vm.expectRevert(PocketRails.ChildInactive.selector);
        this.requestAsChild(stranger, 1e6, TRIP);
    }

    /// @dev External wrapper so vm.expectRevert sees the revert from one call.
    function requestAsChild(address payee, uint256 amount, bytes32 memo) external returns (uint256) {
        return _request(payee, amount, memo);
    }

    // ---------------------------------------------------------------- fuzz

    /// @notice Whatever the child tries, standing-rule spending in one week never passes the weekly limit,
    ///         and no single payment passes the per-payment limit.
    function testFuzz_weeklyLimitHolds(uint256[8] memory amounts) public {
        uint256 paid;
        for (uint256 i; i < amounts.length; ++i) {
            uint256 amount = bound(amounts[i], 1, 10e6);
            uint256 before = token.balanceOf(canteen);
            _pay(canteen, amount);
            uint256 moved = token.balanceOf(canteen) - before;
            assertLe(moved, PER_PAYMENT);
            paid += moved;
        }
        assertLe(paid, WEEKLY);
        assertEq(rails.spentThisWeek(vaultId), paid);
    }
}
