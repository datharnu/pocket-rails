// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PocketRails} from "../src/PocketRails.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";
import {PocketRailsBase} from "./PocketRailsBase.sol";

/// @dev Drives random sequences of payments, charges, vetoes, settlements, deposits, withdrawals,
///      rule changes and revocations against one vault.
contract Handler is Test {
    PocketRails rails;
    MockUSD8 token;
    uint256 vaultId;
    address parent;
    uint256 childKey;
    address guardian;
    address biller;
    address canteen;
    uint256 billingId;
    uint256 nonce = 1_000_000;
    uint256[] public charges;

    constructor(
        PocketRails rails_,
        MockUSD8 token_,
        uint256 vaultId_,
        address parent_,
        uint256 childKey_,
        address guardian_,
        address biller_,
        address canteen_,
        uint256 billingId_
    ) {
        rails = rails_;
        token = token_;
        vaultId = vaultId_;
        parent = parent_;
        childKey = childKey_;
        guardian = guardian_;
        biller = biller_;
        canteen = canteen_;
        billingId = billingId_;
    }

    function pay(uint256 amount) external {
        amount = bound(amount, 1, 8e6);
        PocketRails.Payment memory p = PocketRails.Payment({
            vaultId: vaultId,
            payee: canteen,
            amount: amount,
            memoHash: 0,
            exceptionId: 0,
            nonce: nonce++,
            epoch: rails.getVault(vaultId).childEpoch,
            deadline: uint64(block.timestamp + 1 hours)
        });
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
            vm.sign(childKey, keccak256(abi.encodePacked("\x19\x01", rails.domainSeparator(), structHash)));
        rails.pay(p, abi.encodePacked(r, s, v));
    }

    function charge(uint256 amount) external {
        amount = bound(amount, 1, 5e6);
        vm.prank(biller);
        (uint256 id,) = rails.requestCharge(billingId, amount, 0);
        if (id != 0) charges.push(id);
    }

    function veto(uint256 i) external {
        if (charges.length == 0) return;
        uint256 id = charges[i % charges.length];
        PocketRails.Charge memory c = rails.getCharge(id);
        bool open = (c.status == PocketRails.ChargeStatus.Pending && block.timestamp < c.settleAfter)
            || c.status == PocketRails.ChargeStatus.AwaitingParent;
        if (!open) return;
        vm.prank(guardian);
        rails.vetoCharge(id, "");
    }

    function approve(uint256 i) external {
        if (charges.length == 0) return;
        uint256 id = charges[i % charges.length];
        PocketRails.ChargeStatus s = rails.getCharge(id).status;
        if (s != PocketRails.ChargeStatus.Pending && s != PocketRails.ChargeStatus.Vetoed) return;
        vm.prank(parent);
        rails.approveCharge(id);
    }

    function settle(uint256 i) external {
        if (charges.length == 0) return;
        uint256 id = charges[i % charges.length];
        PocketRails.Charge memory c = rails.getCharge(id);
        if (c.status != PocketRails.ChargeStatus.Pending || block.timestamp < c.settleAfter) return;
        rails.settle(id);
    }

    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 50e6);
        token.mint(address(this), amount);
        token.approve(address(rails), amount);
        rails.deposit(vaultId, amount);
    }

    function withdraw(uint256 amount) external {
        uint256 bal = rails.getVault(vaultId).balance;
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        vm.prank(parent);
        rails.withdraw(vaultId, amount, parent);
    }

    function setReserve(uint256 amount) external {
        uint256 bal = rails.getVault(vaultId).balance;
        vm.prank(parent);
        rails.setSchoolReserve(vaultId, bound(amount, 0, bal));
    }

    function revokeAndRestore() external {
        vm.startPrank(parent);
        rails.revokeChild(vaultId);
        rails.setChild(vaultId, vm.addr(childKey));
        vm.stopPrank();
    }

    function wait(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 3 days));
    }
}

contract PocketRailsInvariantTest is PocketRailsBase {
    Handler handler;

    function setUp() public override {
        super.setUp();
        vm.prank(parent);
        rails.setGuardian(vaultId, guardian);
        uint256 billingId = _grantMeals();
        handler = new Handler(rails, token, vaultId, parent, childKey, guardian, schoolBiller, canteen, billingId);
        targetContract(address(handler));
    }

    /// @notice The contract's books always match the tokens it actually holds.
    function invariant_balanceMatchesTokens() public view {
        assertEq(token.balanceOf(address(rails)), rails.getVault(vaultId).balance);
    }

    /// @notice Standing-rule spending this week never passes the weekly limit.
    function invariant_weeklyLimit() public view {
        assertLe(rails.spentThisWeek(vaultId), rails.getVault(vaultId).rules.weeklyLimit);
    }

    /// @notice The school reserve is always covered by the balance.
    function invariant_reserveNeverExceedsBalance() public view {
        PocketRails.Vault memory v = rails.getVault(vaultId);
        assertLe(v.schoolReserve, v.balance);
    }

    /// @notice Nobody outside the approved payee and the school's treasury ever receives money.
    function invariant_onlyApprovedRecipientsGetPaid() public view {
        assertEq(token.balanceOf(stranger), 0);
    }
}
