// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/AgetBazarEscrow.sol";

contract Deploy is Script {
    function run() external {
        address usdc = vm.envAddress("ARC_USDC_ADDRESS");
        uint64  reviewPeriod = uint64(vm.envUint("REVIEW_PERIOD_SECONDS"));

        vm.startBroadcast();
        AgetBazarEscrow escrow = new AgetBazarEscrow(usdc, reviewPeriod);
        vm.stopBroadcast();

        console.log("AgetBazarEscrow deployed at:", address(escrow));
        console.log("  usdc()        =", address(escrow.usdc()));
        console.log("  reviewPeriod()=", escrow.reviewPeriod());
    }
}
