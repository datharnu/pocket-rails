// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {VetoOnlySessionValidator} from "../src/VetoOnlySessionValidator.sol";

interface IKernelFactoryScript {
    function createAccount(bytes calldata data, bytes32 salt) external payable returns (address);
    function getAddress(bytes calldata data, bytes32 salt) external view returns (address);
}

/// @notice Deploys VetoOnlySessionValidator and creates the guardian's Kernel v3.1 smart account with Aevum's
///         deployed Kernel factory. The owner key becomes the account's root (ECDSA) validator; the session key
///         is installed in the veto-only validator. The account is then funded with a little tQDAY for gas.
///
///   Env: GUARDIAN_OWNER_PK (the guardian's owner key; used only to broadcast), SESSION_ADDRESS (the agent's
///        session key address), RAILS_ADDRESS, optional SESSION_DAYS (default 30), FUND_WEI (default 0.01 tQDAY).
///   forge script script/DeployGuardianAccount.s.sol --rpc-url https://rpc-test.qday.info --broadcast --legacy
contract DeployGuardianAccount is Script {
    address constant KERNEL_FACTORY = 0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419; // Kernel v3.1 on Aevum
    address constant ECDSA_VALIDATOR = 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57; // Kernel ECDSA validator on Aevum

    function run() external returns (address validator, address account) {
        uint256 ownerPk = vm.envUint("GUARDIAN_OWNER_PK");
        address owner = vm.addr(ownerPk);
        address session = vm.envAddress("SESSION_ADDRESS");
        address rails = vm.envAddress("RAILS_ADDRESS");
        uint256 days_ = vm.envOr("SESSION_DAYS", uint256(30));
        uint256 fund = vm.envOr("FUND_WEI", uint256(0.01 ether));
        require(KERNEL_FACTORY.code.length > 0 && ECDSA_VALIDATOR.code.length > 0, "Kernel contracts not found on this chain");
        uint48 validUntil = uint48(block.timestamp + days_ * 1 days);

        vm.startBroadcast(ownerPk);
        VetoOnlySessionValidator v = new VetoOnlySessionValidator();
        bytes memory moduleInit = abi.encodePacked(
            address(1), // no hook
            abi.encode(abi.encode(session, rails, validUntil), bytes(""), abi.encodePacked(v.EXECUTE_SELECTOR()))
        );
        bytes[] memory initConfig = new bytes[](1);
        initConfig[0] = abi.encodeWithSignature("installModule(uint256,address,bytes)", uint256(1), address(v), moduleInit);
        bytes memory data = abi.encodeWithSignature(
            "initialize(bytes21,address,bytes,bytes,bytes[])",
            bytes21(abi.encodePacked(bytes1(0x01), ECDSA_VALIDATOR)),
            address(1),
            abi.encodePacked(owner),
            bytes(""),
            initConfig
        );
        account = IKernelFactoryScript(KERNEL_FACTORY).createAccount(data, bytes32(0));
        if (fund > 0) {
            // A plain call, not transfer(): the account is a proxy and needs more than 2,300 gas to receive.
            (bool ok,) = payable(account).call{value: fund}("");
            require(ok, "funding the account failed");
        }
        vm.stopBroadcast();
        validator = address(v);

        console.log("owner (root)       ", owner);
        console.log("session key        ", session);
        console.log("validator          ", validator);
        console.log("guardian account   ", account);
        console.log("session valid until", uint256(validUntil));
    }
}
