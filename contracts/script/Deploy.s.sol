// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Chrono} from "../src/Chrono.sol";

contract DeployScript is Script {
    function run() external returns (Chrono chrono) {
        address penaltyRecipient = vm.envOr("PENALTY_RECIPIENT", msg.sender);
        uint256 penaltyBps = vm.envOr("PENALTY_BPS", uint256(1000));
        uint64 minLockSeconds = uint64(vm.envOr("MIN_LOCK_SECONDS", uint256(120)));

        vm.startBroadcast();

        chrono = new Chrono(penaltyRecipient, penaltyBps, minLockSeconds);

        vm.stopBroadcast();

        console2.log("Chrono deployed at:", address(chrono));
        console2.log("penaltyRecipient:", penaltyRecipient);
        console2.log("penaltyBps:", penaltyBps);
        console2.log("minLockSeconds:", minLockSeconds);
    }
}
