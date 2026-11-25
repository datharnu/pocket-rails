// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PocketRails} from "../src/PocketRails.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";

/// @dev Shared setup: one family vault with a canteen and a bookshop approved,
///      $5 per payment, $20 a week, access for 90 days, $100 deposited.
abstract contract PocketRailsBase is Test {
    MockUSD8 token;
    PocketRails rails;

    address parent = makeAddr("parent");
    address child;
    uint256 childKey;
    address guardian = makeAddr("guardian");
    address canteen = makeAddr("canteen");
    address bookshop = makeAddr("bookshop");
    address stranger = makeAddr("stranger");
    address schoolBiller = makeAddr("schoolBiller"); // the school's billing agent key
    address schoolTreasury = makeAddr("schoolTreasury");
    address relayer = makeAddr("relayer");

    uint256 vaultId;
    uint256 nextNonce = 1;

    uint128 constant PER_PAYMENT = 5e6;
    uint128 constant WEEKLY = 20e6;
    uint256 constant DEPOSIT = 100e6;

    function setUp() public virtual {
        // A fixed Wednesday noon UTC, so week boundaries are predictable.
        vm.warp(1_795_608_000); // 2026-11-25 12:00:00 UTC (Wednesday)
        (child, childKey) = makeAddrAndKey("child");
        token = new MockUSD8();
        rails = new PocketRails(IERC20(address(token)));

        address[] memory payees = new address[](2);
        payees[0] = canteen;
        payees[1] = bookshop;
        string[] memory labels = new string[](2);
        labels[0] = "School canteen";
        labels[1] = "Bookshop";

        vm.prank(parent);
        vaultId = rails.createVault(child, _rules(PER_PAYMENT, WEEKLY, 90 days), payees, labels);

        token.mint(parent, 1_000e6);
        vm.startPrank(parent);
        token.approve(address(rails), type(uint256).max);
        rails.deposit(vaultId, DEPOSIT);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- helpers

    function _rules(uint128 perPayment, uint128 weekly, uint64 ttl) internal view returns (PocketRails.Rules memory) {
        return PocketRails.Rules({perPaymentLimit: perPayment, weeklyLimit: weekly, expiresAt: uint64(block.timestamp) + ttl});
    }

    function _epoch() internal view returns (uint64) {
        return rails.getVault(vaultId).childEpoch;
    }

    function _payment(address payee, uint256 amount, bytes32 memoHash, uint256 exceptionId)
        internal
        returns (PocketRails.Payment memory p)
    {
        p = PocketRails.Payment({
            vaultId: vaultId,
            payee: payee,
            amount: amount,
            memoHash: memoHash,
            exceptionId: exceptionId,
            nonce: nextNonce++,
            epoch: _epoch(),
            deadline: uint64(block.timestamp + 10 minutes)
        });
    }

    function _signPayment(uint256 key, PocketRails.Payment memory p) internal view returns (bytes memory) {
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
            vm.sign(key, keccak256(abi.encodePacked("\x19\x01", rails.domainSeparator(), structHash)));
        return abi.encodePacked(r, s, v);
    }

    /// @dev Child signs, relayer submits: the normal gasless path.
    function _pay(address payee, uint256 amount) internal returns (PocketRails.Reason) {
        return _payWith(payee, amount, bytes32(0), 0);
    }

    function _payWith(address payee, uint256 amount, bytes32 memoHash, uint256 exceptionId)
        internal
        returns (PocketRails.Reason)
    {
        PocketRails.Payment memory p = _payment(payee, amount, memoHash, exceptionId);
        bytes memory sig = _signPayment(childKey, p);
        vm.prank(relayer);
        return rails.pay(p, sig);
    }

    function _request(address payee, uint256 amount, bytes32 memoHash) internal returns (uint256) {
        PocketRails.ExceptionRequest memory r = PocketRails.ExceptionRequest({
            vaultId: vaultId,
            payee: payee,
            amount: amount,
            memoHash: memoHash,
            nonce: nextNonce++,
            epoch: _epoch(),
            deadline: uint64(block.timestamp + 10 minutes)
        });
        bytes32 structHash = keccak256(
            abi.encode(
                rails.EXCEPTION_REQUEST_TYPEHASH(),
                r.vaultId,
                r.payee,
                r.amount,
                r.memoHash,
                r.nonce,
                r.epoch,
                r.deadline
            )
        );
        (uint8 v, bytes32 rr, bytes32 s) =
            vm.sign(childKey, keccak256(abi.encodePacked("\x19\x01", rails.domainSeparator(), structHash)));
        vm.prank(relayer);
        return rails.requestException(r, abi.encodePacked(rr, s, v));
    }

    function _terms(uint128 perCharge, uint128 perPeriod, uint64 period, uint64 vetoWindow, bool firstApproval)
        internal
        view
        returns (PocketRails.BillingTerms memory)
    {
        return PocketRails.BillingTerms({
            biller: schoolBiller,
            payTo: schoolTreasury,
            maxPerCharge: perCharge,
            maxPerPeriod: perPeriod,
            period: period,
            expiresAt: uint64(block.timestamp + 180 days),
            vetoWindow: vetoWindow,
            firstChargeNeedsApproval: firstApproval
        });
    }

    /// @dev Meals: max $3 a charge, $15 a week, 10-minute veto window, no first-charge approval.
    function _grantMeals() internal returns (uint256 billingId) {
        vm.prank(parent);
        billingId = rails.grantBilling(vaultId, _terms(3e6, 15e6, 7 days, 10 minutes, false), "Meal plan");
    }

    function _charge(uint256 billingId, uint256 amount) internal returns (uint256 chargeId, PocketRails.Reason r) {
        vm.prank(schoolBiller);
        return rails.requestCharge(billingId, amount, keccak256("meal"));
    }
}
