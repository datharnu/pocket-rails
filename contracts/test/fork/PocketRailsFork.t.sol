// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PocketRails} from "../../src/PocketRails.sol";
import {Signing} from "../Signing.sol";

interface ITUSD8Fork is IERC20 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// @notice The whole Pocket Rails flow against the REAL tUSD8 on a local fork of Aevum testnet.
///         No funds needed: `deal` writes balances into the fork only.
///         Run with: make test-fork
contract PocketRailsForkTest is Test {
    ITUSD8Fork constant TUSD8 = ITUSD8Fork(0x456569838f1d43009A91ebA4263147Afd7233483);

    PocketRails rails;
    address parent;
    uint256 parentKey;
    address child;
    uint256 childKey;
    address canteen = makeAddr("canteen");
    address school = makeAddr("school");
    uint256 vaultId;

    function setUp() public {
        require(block.chainid == 44005, "run with --fork-url aevum");
        (parent, parentKey) = makeAddrAndKey("parent");
        (child, childKey) = makeAddrAndKey("child");
        rails = new PocketRails(TUSD8);

        address[] memory payees = new address[](1);
        payees[0] = canteen;
        string[] memory labels = new string[](1);
        labels[0] = "School canteen";
        vm.prank(parent);
        vaultId = rails.createVault(
            child,
            PocketRails.Rules({perPaymentLimit: 5e6, weeklyLimit: 20e6, expiresAt: uint64(block.timestamp + 30 days)}),
            payees,
            labels
        );
        deal(address(TUSD8), parent, 50e6);
    }

    /// @dev Gasless top-up with the real tUSD8's EIP-3009, bound to this vault by the nonce.
    function test_realTusd8_gaslessDeposit_thenChildPays_thenRefusal() public {
        bytes32 salt = keccak256("topup-1");
        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = Signing.signReceive(
            vm,
            parentKey,
            TUSD8.DOMAIN_SEPARATOR(),
            Signing.Auth({
                from: parent,
                to: address(rails),
                value: 30e6,
                validAfter: 0,
                validBefore: validBefore,
                nonce: rails.depositNonce(vaultId, salt)
            })
        );
        vm.prank(makeAddr("relayer"));
        rails.depositWithAuthorization(vaultId, parent, 30e6, 0, validBefore, salt, PocketRails.Sig(v, r, s));
        assertEq(TUSD8.balanceOf(address(rails)), 30e6);
        assertEq(rails.getVault(vaultId).balance, 30e6);

        assertEq(uint8(_childPays(canteen, 4e6, 1)), uint8(PocketRails.Reason.None));
        assertEq(TUSD8.balanceOf(canteen), 4e6);

        assertEq(uint8(_childPays(canteen, 8e6, 2)), uint8(PocketRails.Reason.OverPaymentLimit));
        assertEq(TUSD8.balanceOf(canteen), 4e6);
    }

    function test_realTusd8_schoolChargeSettles() public {
        vm.startPrank(parent);
        TUSD8.approve(address(rails), 20e6);
        rails.deposit(vaultId, 20e6);
        uint256 billingId = rails.grantBilling(
            vaultId,
            PocketRails.BillingTerms({
                biller: school,
                payTo: school,
                maxPerCharge: 3e6,
                maxPerPeriod: 15e6,
                period: 7 days,
                expiresAt: uint64(block.timestamp + 90 days),
                vetoWindow: 2 minutes,
                firstChargeNeedsApproval: false
            }),
            "Meal plan"
        );
        vm.stopPrank();

        vm.prank(school);
        (uint256 chargeId,) = rails.requestCharge(billingId, 3e6, keccak256("meal"));
        vm.warp(block.timestamp + 2 minutes);
        rails.settle(chargeId);
        assertEq(TUSD8.balanceOf(school), 3e6);
    }

    function _childPays(address payee, uint256 amount, uint256 nonce) internal returns (PocketRails.Reason) {
        PocketRails.Payment memory p = PocketRails.Payment({
            vaultId: vaultId,
            payee: payee,
            amount: amount,
            memoHash: 0,
            exceptionId: 0,
            nonce: nonce,
            epoch: 1,
            deadline: uint64(block.timestamp + 10 minutes)
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
        return rails.pay(p, abi.encodePacked(r, s, v));
    }
}
