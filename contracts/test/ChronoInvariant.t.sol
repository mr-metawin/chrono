// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Chrono} from "../src/Chrono.sol";

contract ChronoHandler is Test {
    Chrono public chrono;
    address public penaltyRecipient;
    address[] public actors;
    uint256[] public activeLockIds;

    constructor(Chrono _chrono, address _penaltyRecipient) {
        chrono = _chrono;
        penaltyRecipient = _penaltyRecipient;

        actors.push(makeAddr("actor1"));
        actors.push(makeAddr("actor2"));
        actors.push(makeAddr("actor3"));

        for (uint256 i = 0; i < actors.length; i++) {
            vm.deal(actors[i], 1_000_000 ether);
        }
    }

    function createLock(
        uint256 actorSeed,
        uint256 amountSeed,
        uint256 durationSeed,
        bool flexible
    ) external {
        address actor = actors[actorSeed % actors.length];
        uint256 amount = bound(amountSeed, 1, 100 ether);
        uint256 duration = bound(durationSeed, chrono.minLockSeconds(), 365 days);
        uint64 unlockTime = uint64(block.timestamp + duration);

        vm.prank(actor);
        uint256 id = chrono.createLock{value: amount}(unlockTime, "HandlerLock", flexible);
        activeLockIds.push(id);
    }

    function topUp(
        uint256 lockIndexSeed,
        uint256 amountSeed
    ) external {
        if (activeLockIds.length == 0) return;
        uint256 id = activeLockIds[lockIndexSeed % activeLockIds.length];

        Chrono.Lock memory lock = chrono.getLock(id);
        if (lock.status != Chrono.Status.Active || block.timestamp >= lock.unlockTime) {
            return;
        }

        uint256 amount = bound(amountSeed, 1, 10 ether);
        vm.prank(lock.owner);
        chrono.topUp{value: amount}(id);
    }

    function extendLock(
        uint256 lockIndexSeed,
        uint256 extraDurationSeed
    ) external {
        if (activeLockIds.length == 0) return;
        uint256 id = activeLockIds[lockIndexSeed % activeLockIds.length];

        Chrono.Lock memory lock = chrono.getLock(id);
        if (lock.status != Chrono.Status.Active || block.timestamp >= lock.unlockTime) {
            return;
        }

        uint256 extra = bound(extraDurationSeed, 10, 30 days);
        uint64 newUnlock = lock.unlockTime + uint64(extra);
        if (newUnlock > block.timestamp + chrono.MAX_LOCK()) {
            return;
        }

        vm.prank(lock.owner);
        chrono.extendLock(id, newUnlock);
    }

    function withdraw(uint256 lockIndexSeed) external {
        if (activeLockIds.length == 0) return;
        uint256 id = activeLockIds[lockIndexSeed % activeLockIds.length];

        Chrono.Lock memory lock = chrono.getLock(id);
        if (lock.status != Chrono.Status.Active || block.timestamp < lock.unlockTime) {
            return;
        }

        vm.prank(lock.owner);
        chrono.withdraw(id);
    }

    function exitEarly(uint256 lockIndexSeed) external {
        if (activeLockIds.length == 0) return;
        uint256 id = activeLockIds[lockIndexSeed % activeLockIds.length];

        Chrono.Lock memory lock = chrono.getLock(id);
        if (lock.status != Chrono.Status.Active || block.timestamp >= lock.unlockTime || !lock.flexible) {
            return;
        }

        vm.prank(lock.owner);
        chrono.exitEarly(id);
    }

    function claimPenalties() external {
        if (chrono.penaltyBalance() == 0) return;
        vm.prank(penaltyRecipient);
        chrono.claimPenalties();
    }

    function warp(uint256 timeSeed) external {
        uint256 secondsToWarp = bound(timeSeed, 1, 30 days);
        vm.warp(block.timestamp + secondsToWarp);
    }
}

contract ChronoInvariantTest is StdInvariant, Test {
    Chrono public chrono;
    ChronoHandler public handler;
    address public penaltyRecipient = makeAddr("penaltyRecipient");

    function setUp() public {
        chrono = new Chrono(penaltyRecipient, 1000, 120);
        handler = new ChronoHandler(chrono, penaltyRecipient);

        targetContract(address(handler));
    }

    function invariant_SolvencyAndConservation() public view {
        // Contract balance must always equal totalLocked + penaltyBalance
        assertEq(
            address(chrono).balance,
            chrono.totalLocked() + chrono.penaltyBalance(),
            "Solvency invariant broken: balance != totalLocked + penaltyBalance"
        );
    }
}
