// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Chrono} from "../src/Chrono.sol";

// --- Malicious contracts for Reentrancy & Reject tests ---

contract ReentrantAttacker {
    Chrono public chrono;
    enum AttackType { Withdraw, ExitEarly, ClaimPenalties }
    AttackType public attackType;
    uint256 public lockId;
    bool public hasAttacked;

    constructor(address _chrono) {
        chrono = Chrono(_chrono);
    }

    function createAndAttack(
        uint64 unlockTime,
        bool flexible,
        AttackType _type
    ) external payable returns (uint256) {
        attackType = _type;
        lockId = chrono.createLock{value: msg.value}(unlockTime, "reenter", flexible);
        return lockId;
    }

    function triggerWithdraw() external {
        chrono.withdraw(lockId);
    }

    function triggerExitEarly() external {
        chrono.exitEarly(lockId);
    }

    function triggerClaimPenalties() external {
        attackType = AttackType.ClaimPenalties;
        chrono.claimPenalties();
    }

    receive() external payable {
        if (!hasAttacked) {
            hasAttacked = true;
            if (attackType == AttackType.Withdraw) {
                chrono.withdraw(lockId);
            } else if (attackType == AttackType.ExitEarly) {
                chrono.exitEarly(lockId);
            } else if (attackType == AttackType.ClaimPenalties) {
                chrono.claimPenalties();
            }
        }
    }
}

contract RejectingReceiver {
    Chrono public chrono;

    constructor(address _chrono) {
        chrono = Chrono(_chrono);
    }

    function createLock(uint64 unlockTime, bool flexible) external payable returns (uint256) {
        return chrono.createLock{value: msg.value}(unlockTime, "reject", flexible);
    }

    function withdraw(uint256 id) external {
        chrono.withdraw(id);
    }

    // Explicitly reject plain transfers
    receive() external payable {
        revert("Rejecting payment");
    }
}

// --- Main Unit & Fuzz Test Suite ---

contract ChronoTest is Test {
    Chrono public chrono;
    address public penaltyRecipient = makeAddr("penaltyRecipient");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public charlie = makeAddr("charlie");

    uint256 public constant DEFAULT_PENALTY_BPS = 1000; // 10%
    uint64 public constant DEFAULT_MIN_LOCK = 120; // 2 minutes

    function setUp() public {
        chrono = new Chrono(penaltyRecipient, DEFAULT_PENALTY_BPS, DEFAULT_MIN_LOCK);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);
    }

    // --- Constructor Tests ---

    function test_Constructor_Success() public view {
        assertEq(chrono.penaltyRecipient(), penaltyRecipient);
        assertEq(chrono.penaltyBps(), DEFAULT_PENALTY_BPS);
        assertEq(chrono.minLockSeconds(), DEFAULT_MIN_LOCK);
        assertEq(chrono.MAX_LOCK(), 5 * 365 days);
        assertEq(chrono.lockCount(), 0);
        assertEq(chrono.totalLocked(), 0);
        assertEq(chrono.penaltyBalance(), 0);
    }

    function test_Constructor_RevertZeroRecipient() public {
        vm.expectRevert(Chrono.InvalidPenaltyRecipient.selector);
        new Chrono(address(0), 1000, 120);
    }

    function test_Constructor_RevertPenaltyBpsTooLow() public {
        vm.expectRevert(Chrono.InvalidPenaltyBps.selector);
        new Chrono(penaltyRecipient, 99, 120);
    }

    function test_Constructor_RevertPenaltyBpsTooHigh() public {
        vm.expectRevert(Chrono.InvalidPenaltyBps.selector);
        new Chrono(penaltyRecipient, 5001, 120);
    }

    function test_Constructor_RevertMinLockTooShort() public {
        vm.expectRevert(Chrono.InvalidMinLockSeconds.selector);
        new Chrono(penaltyRecipient, 1000, 59);
    }

    // --- createLock Tests ---

    function test_CreateLock_Success() public {
        vm.startPrank(alice);
        uint64 unlockTime = uint64(block.timestamp + 300);
        uint256 id = chrono.createLock{value: 5 ether}(unlockTime, "Savings", false);
        vm.stopPrank();

        assertEq(id, 1);
        assertEq(chrono.lockCount(), 1);
        assertEq(chrono.totalLocked(), 5 ether);
        assertEq(address(chrono).balance, 5 ether);

        Chrono.Lock memory lock = chrono.getLock(1);
        assertEq(lock.id, 1);
        assertEq(lock.owner, alice);
        assertEq(lock.amount, 5 ether);
        assertEq(lock.label, "Savings");
        assertEq(lock.createdAt, uint64(block.timestamp));
        assertEq(lock.unlockTime, unlockTime);
        assertFalse(lock.flexible);
        assertTrue(lock.status == Chrono.Status.Active);
    }

    function test_CreateLock_RevertZeroValue() public {
        vm.startPrank(alice);
        vm.expectRevert(Chrono.ZeroAmount.selector);
        chrono.createLock{value: 0}(uint64(block.timestamp + 300), "Zero", false);
        vm.stopPrank();
    }

    function test_CreateLock_RevertUnlockTooSoon() public {
        vm.startPrank(alice);
        // Minimum is block.timestamp + 120
        vm.expectRevert(Chrono.InvalidUnlockTime.selector);
        chrono.createLock{value: 1 ether}(uint64(block.timestamp + 119), "Too Soon", false);
        vm.stopPrank();
    }

    function test_CreateLock_RevertUnlockBeyondMax() public {
        vm.startPrank(alice);
        // Max is block.timestamp + 5 * 365 days
        uint64 tooLate = uint64(block.timestamp + 5 * 365 days + 1);
        vm.expectRevert(Chrono.InvalidUnlockTime.selector);
        chrono.createLock{value: 1 ether}(tooLate, "Too Late", false);
        vm.stopPrank();
    }

    function test_CreateLock_LabelLengths() public {
        vm.startPrank(alice);
        // Empty label is allowed
        uint256 id1 = chrono.createLock{value: 1 ether}(uint64(block.timestamp + 200), "", true);
        assertEq(chrono.getLock(id1).label, "");

        // 50 bytes label is allowed
        string memory maxLabel = "12345678901234567890123456789012345678901234567890";
        assertEq(bytes(maxLabel).length, 50);
        uint256 id2 = chrono.createLock{value: 1 ether}(uint64(block.timestamp + 200), maxLabel, false);
        assertEq(chrono.getLock(id2).label, maxLabel);

        // 51 bytes label reverts
        string memory tooLong = "123456789012345678901234567890123456789012345678901";
        assertEq(bytes(tooLong).length, 51);
        vm.expectRevert(Chrono.LabelTooLong.selector);
        chrono.createLock{value: 1 ether}(uint64(block.timestamp + 200), tooLong, false);
        vm.stopPrank();
    }

    // --- Multi-Lock Per Wallet Tests ---

    function test_MultiLock_SameWallet() public {
        vm.startPrank(alice);
        uint256 id1 = chrono.createLock{value: 1 ether}(uint64(block.timestamp + 200), "Lock 1", false);
        uint256 id2 = chrono.createLock{value: 2 ether}(uint64(block.timestamp + 400), "Lock 2", true);
        uint256 id3 = chrono.createLock{value: 3 ether}(uint64(block.timestamp + 600), "Lock 3", false);
        vm.stopPrank();

        assertEq(chrono.lockCount(), 3);
        assertEq(chrono.totalLocked(), 6 ether);

        uint256[] memory aliceLocks = chrono.getUserLockIds(alice, 0, 10);
        assertEq(aliceLocks.length, 3);
        assertEq(aliceLocks[0], id3); // Newest first
        assertEq(aliceLocks[1], id2);
        assertEq(aliceLocks[2], id1);
    }

    // --- topUp Tests ---

    function test_TopUp_Success() public {
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 2 ether}(uint64(block.timestamp + 300), "TopUpTest", false);

        vm.prank(alice);
        chrono.topUp{value: 1.5 ether}(id);

        Chrono.Lock memory lock = chrono.getLock(id);
        assertEq(lock.amount, 3.5 ether);
        assertEq(chrono.totalLocked(), 3.5 ether);
        assertEq(address(chrono).balance, 3.5 ether);
    }

    function test_TopUp_RevertStranger() public {
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 2 ether}(uint64(block.timestamp + 300), "StrangerTest", false);

        vm.prank(bob);
        vm.expectRevert(Chrono.NotLockOwner.selector);
        chrono.topUp{value: 1 ether}(id);
    }

    function test_TopUp_RevertZeroAmount() public {
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 2 ether}(uint64(block.timestamp + 300), "ZeroTopUp", false);

        vm.prank(alice);
        vm.expectRevert(Chrono.ZeroAmount.selector);
        chrono.topUp{value: 0}(id);
    }

    function test_TopUp_RevertAfterUnlock() public {
        uint64 unlockTime = uint64(block.timestamp + 300);
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 2 ether}(unlockTime, "ExpiredTopUp", false);

        vm.warp(unlockTime);

        vm.prank(alice);
        vm.expectRevert(Chrono.LockAlreadyUnlocked.selector);
        chrono.topUp{value: 1 ether}(id);
    }

    // --- extendLock Tests ---

    function test_ExtendLock_Success() public {
        uint64 unlockTime = uint64(block.timestamp + 300);
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 2 ether}(unlockTime, "ExtendTest", false);

        uint64 newUnlockTime = uint64(block.timestamp + 600);
        vm.prank(alice);
        chrono.extendLock(id, newUnlockTime);

        assertEq(chrono.getLock(id).unlockTime, newUnlockTime);
    }

    function test_ExtendLock_RevertShorteningOrEqual() public {
        uint64 unlockTime = uint64(block.timestamp + 300);
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 2 ether}(unlockTime, "ExtendTest", false);

        // Equal reverts
        vm.prank(alice);
        vm.expectRevert(Chrono.InvalidNewUnlockTime.selector);
        chrono.extendLock(id, unlockTime);

        // Shortening reverts
        vm.prank(alice);
        vm.expectRevert(Chrono.InvalidNewUnlockTime.selector);
        chrono.extendLock(id, unlockTime - 1);
    }

    function test_ExtendLock_RevertBeyondMax() public {
        uint64 unlockTime = uint64(block.timestamp + 300);
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 2 ether}(unlockTime, "ExtendTest", false);

        vm.prank(alice);
        vm.expectRevert(Chrono.InvalidNewUnlockTime.selector);
        chrono.extendLock(id, uint64(block.timestamp + 5 * 365 days + 1));
    }

    function test_ExtendLock_RevertStranger() public {
        uint64 unlockTime = uint64(block.timestamp + 300);
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 2 ether}(unlockTime, "ExtendTest", false);

        vm.prank(bob);
        vm.expectRevert(Chrono.NotLockOwner.selector);
        chrono.extendLock(id, unlockTime + 100);
    }

    function test_ExtendLock_RevertAfterUnlock() public {
        uint64 unlockTime = uint64(block.timestamp + 300);
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 2 ether}(unlockTime, "ExtendTest", false);

        vm.warp(unlockTime);

        vm.prank(alice);
        vm.expectRevert(Chrono.LockAlreadyUnlocked.selector);
        chrono.extendLock(id, unlockTime + 100);
    }

    // --- withdraw Tests (Boundary & Security) ---

    function test_Withdraw_BoundaryExact() public {
        uint64 unlockTime = uint64(block.timestamp + 300);
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 10 ether}(unlockTime, "BoundaryTest", false);

        // 1 second before unlock: MUST revert
        vm.warp(unlockTime - 1);
        vm.prank(alice);
        vm.expectRevert(Chrono.LockStillActive.selector);
        chrono.withdraw(id);

        // At exact unlockTime: MUST succeed
        vm.warp(unlockTime);
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        chrono.withdraw(id);
        uint256 aliceAfter = alice.balance;

        assertEq(aliceAfter - aliceBefore, 10 ether);
        assertEq(chrono.totalLocked(), 0);
        assertTrue(chrono.getLock(id).status == Chrono.Status.Withdrawn);

        // Second call must revert (No double settlement)
        vm.prank(alice);
        vm.expectRevert(Chrono.LockNotActive.selector);
        chrono.withdraw(id);
    }

    function test_Withdraw_RevertStranger() public {
        uint64 unlockTime = uint64(block.timestamp + 300);
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 10 ether}(unlockTime, "StrangerWithdraw", false);

        vm.warp(unlockTime);
        vm.prank(bob);
        vm.expectRevert(Chrono.NotLockOwner.selector);
        chrono.withdraw(id);
    }

    // --- Strict Lock: Absolute Impossibility of Early Exit ---

    function test_StrictLock_CannotExitEarly() public {
        uint64 unlockTime = uint64(block.timestamp + 300);
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 10 ether}(unlockTime, "StrictVault", false);

        // Exit early as owner reverts
        vm.prank(alice);
        vm.expectRevert(Chrono.StrictLockCannotExitEarly.selector);
        chrono.exitEarly(id);

        // Exit early as stranger reverts (NotLockOwner first)
        vm.prank(bob);
        vm.expectRevert(Chrono.NotLockOwner.selector);
        chrono.exitEarly(id);

        // Withdraw before unlock reverts
        vm.prank(alice);
        vm.expectRevert(Chrono.LockStillActive.selector);
        chrono.withdraw(id);

        vm.prank(bob);
        vm.expectRevert(Chrono.NotLockOwner.selector);
        chrono.withdraw(id);

        // Claim penalties does not touch lock funds
        vm.prank(penaltyRecipient);
        vm.expectRevert(Chrono.ZeroPenaltyBalance.selector);
        chrono.claimPenalties();

        assertEq(chrono.totalLocked(), 10 ether);
        assertEq(address(chrono).balance, 10 ether);
    }

    // --- Flexible Lock & Early Exit Tests ---

    function test_FlexibleLock_ExitEarly_MathAndRounding() public {
        uint64 unlockTime = uint64(block.timestamp + 300);
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 10 ether}(unlockTime, "FlexVault", true);

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        chrono.exitEarly(id);
        uint256 aliceAfter = alice.balance;

        // 10 ether * 1000 / 10000 = 1 ether penalty, 9 ether payout
        uint256 expectedPenalty = 1 ether;
        uint256 expectedPayout = 9 ether;

        assertEq(aliceAfter - aliceBefore, expectedPayout);
        assertEq(chrono.penaltyBalance(), expectedPenalty);
        assertEq(chrono.totalLocked(), 0);
        assertEq(address(chrono).balance, expectedPenalty);
        assertTrue(chrono.getLock(id).status == Chrono.Status.ExitedEarly);

        // Second exitEarly reverts
        vm.prank(alice);
        vm.expectRevert(Chrono.LockNotActive.selector);
        chrono.exitEarly(id);
    }

    function test_FlexibleLock_RoundingUp_EdgeCases() public {
        // Case 1: 1 wei -> 10% rounded up is 1 wei penalty, 0 payout
        vm.prank(alice);
        uint256 id1 = chrono.createLock{value: 1}(uint64(block.timestamp + 300), "1wei", true);
        vm.prank(alice);
        chrono.exitEarly(id1);
        assertEq(chrono.penaltyBalance(), 1);

        // Case 2: 11 wei -> 11 * 1000 / 10000 = 1.1 -> rounded up is 2 wei penalty, 9 wei payout
        vm.prank(bob);
        uint256 id2 = chrono.createLock{value: 11}(uint64(block.timestamp + 300), "11wei", true);
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        chrono.exitEarly(id2);
        uint256 bobAfter = bob.balance;

        assertEq(bobAfter - bobBefore, 9);
        assertEq(chrono.penaltyBalance(), 1 + 2); // 1 from id1, 2 from id2
    }

    function test_FlexibleLock_RevertExitAfterUnlock() public {
        uint64 unlockTime = uint64(block.timestamp + 300);
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 5 ether}(unlockTime, "FlexVault", true);

        vm.warp(unlockTime);

        // Calling exitEarly after unlock reverts (should withdraw instead with zero penalty!)
        vm.prank(alice);
        vm.expectRevert(Chrono.LockAlreadyUnlocked.selector);
        chrono.exitEarly(id);

        // Full withdraw succeeds with zero fee
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        chrono.withdraw(id);
        assertEq(alice.balance - aliceBefore, 5 ether);
        assertEq(chrono.penaltyBalance(), 0);
    }

    // --- claimPenalties Tests ---

    function test_ClaimPenalties_Success() public {
        uint64 unlockTime = uint64(block.timestamp + 300);
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 10 ether}(unlockTime, "Flex", true);

        vm.prank(alice);
        chrono.exitEarly(id);

        assertEq(chrono.penaltyBalance(), 1 ether);

        uint256 recipientBefore = penaltyRecipient.balance;
        vm.prank(penaltyRecipient);
        chrono.claimPenalties();
        uint256 recipientAfter = penaltyRecipient.balance;

        assertEq(recipientAfter - recipientBefore, 1 ether);
        assertEq(chrono.penaltyBalance(), 0);
        assertEq(address(chrono).balance, 0);
    }

    function test_ClaimPenalties_Reverts() public {
        // Revert stranger
        vm.prank(alice);
        vm.expectRevert(Chrono.NotPenaltyRecipient.selector);
        chrono.claimPenalties();

        // Revert zero balance
        vm.prank(penaltyRecipient);
        vm.expectRevert(Chrono.ZeroPenaltyBalance.selector);
        chrono.claimPenalties();
    }

    // --- No Double Settlement Tests ---

    function test_NoDoubleSettlement_AfterWithdrawal() public {
        uint64 unlockTime = uint64(block.timestamp + 300);
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 2 ether}(unlockTime, "Settle", true);

        vm.warp(unlockTime);
        vm.prank(alice);
        chrono.withdraw(id);

        // All subsequent actions must revert with LockNotActive
        vm.startPrank(alice);
        vm.expectRevert(Chrono.LockNotActive.selector);
        chrono.topUp{value: 1 ether}(id);

        vm.expectRevert(Chrono.LockNotActive.selector);
        chrono.extendLock(id, unlockTime + 100);

        vm.expectRevert(Chrono.LockNotActive.selector);
        chrono.withdraw(id);

        vm.expectRevert(Chrono.LockNotActive.selector);
        chrono.exitEarly(id);
        vm.stopPrank();
    }

    function test_NoDoubleSettlement_AfterEarlyExit() public {
        uint64 unlockTime = uint64(block.timestamp + 300);
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 2 ether}(unlockTime, "SettleFlex", true);

        vm.prank(alice);
        chrono.exitEarly(id);

        // All subsequent actions must revert with LockNotActive
        vm.startPrank(alice);
        vm.expectRevert(Chrono.LockNotActive.selector);
        chrono.topUp{value: 1 ether}(id);

        vm.expectRevert(Chrono.LockNotActive.selector);
        chrono.extendLock(id, unlockTime + 100);

        vm.expectRevert(Chrono.LockNotActive.selector);
        chrono.withdraw(id);

        vm.expectRevert(Chrono.LockNotActive.selector);
        chrono.exitEarly(id);
        vm.stopPrank();
    }

    // --- Reentrancy Tests ---

    function test_Reentrancy_Withdraw_Blocked() public {
        ReentrantAttacker attacker = new ReentrantAttacker(address(chrono));
        vm.deal(address(attacker), 10 ether);

        uint64 unlockTime = uint64(block.timestamp + 300);
        attacker.createAndAttack{value: 5 ether}(unlockTime, false, ReentrantAttacker.AttackType.Withdraw);

        vm.warp(unlockTime);

        // Reentrant call during withdraw must fail
        vm.expectRevert();
        attacker.triggerWithdraw();
    }

    function test_Reentrancy_ExitEarly_Blocked() public {
        ReentrantAttacker attacker = new ReentrantAttacker(address(chrono));
        vm.deal(address(attacker), 10 ether);

        uint64 unlockTime = uint64(block.timestamp + 300);
        attacker.createAndAttack{value: 5 ether}(unlockTime, true, ReentrantAttacker.AttackType.ExitEarly);

        // Reentrant call during exitEarly must fail
        vm.expectRevert();
        attacker.triggerExitEarly();
    }

    function test_Reentrancy_ClaimPenalties_Blocked() public {
        // Deploy chrono with the attacker contract as penaltyRecipient
        ReentrantAttacker attackerRecipient = new ReentrantAttacker(address(0));
        Chrono customChrono = new Chrono(address(attackerRecipient), 1000, 120);

        // Put customChrono address into attacker
        // Re-deploy attacker with customChrono
        attackerRecipient = new ReentrantAttacker(address(customChrono));
        customChrono = new Chrono(address(attackerRecipient), 1000, 120);
        // Fund and exit early on customChrono to create penaltyBalance
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        uint256 id = customChrono.createLock{value: 5 ether}(uint64(block.timestamp + 300), "flex", true);
        vm.prank(alice);
        customChrono.exitEarly(id);

        // Trigger claimPenalties via attacker
        vm.expectRevert();
        attackerRecipient.triggerClaimPenalties();
    }

    // --- Rejecting Receiver Test ---

    function test_RejectingReceiver_WithdrawRevertsWithoutAffectingOthers() public {
        RejectingReceiver rejecter = new RejectingReceiver(address(chrono));
        vm.deal(address(rejecter), 10 ether);

        uint64 unlockTime = uint64(block.timestamp + 300);
        uint256 rejectId = rejecter.createLock{value: 3 ether}(unlockTime, false);

        // Alice creates a normal lock
        vm.prank(alice);
        uint256 aliceId = chrono.createLock{value: 5 ether}(unlockTime, "Alice", false);

        vm.warp(unlockTime);

        // Rejecter's withdraw fails with TransferFailed
        vm.expectRevert(Chrono.TransferFailed.selector);
        rejecter.withdraw(rejectId);

        // Lock remains active and safe in contract
        assertEq(chrono.getLock(rejectId).amount, 3 ether);
        assertTrue(chrono.getLock(rejectId).status == Chrono.Status.Active);
        assertEq(chrono.totalLocked(), 8 ether);

        // Alice can withdraw her funds without any problem!
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        chrono.withdraw(aliceId);
        assertEq(alice.balance - aliceBefore, 5 ether);
        assertEq(chrono.totalLocked(), 3 ether);
    }

    // --- Pagination Tests ---

    function test_Pagination_GetUserLockIds_And_GetLocks() public {
        vm.startPrank(alice);
        for (uint256 i = 1; i <= 5; i++) {
            chrono.createLock{value: 1 ether}(uint64(block.timestamp + 300 + i), "Test", false);
        }
        vm.stopPrank();

        // 5 locks total: IDs 1, 2, 3, 4, 5. Newest first = [5, 4, 3, 2, 1]
        uint256[] memory page1 = chrono.getUserLockIds(alice, 0, 2);
        assertEq(page1.length, 2);
        assertEq(page1[0], 5);
        assertEq(page1[1], 4);

        uint256[] memory page2 = chrono.getUserLockIds(alice, 2, 2);
        assertEq(page2.length, 2);
        assertEq(page2[0], 3);
        assertEq(page2[1], 2);

        uint256[] memory page3 = chrono.getUserLockIds(alice, 4, 2);
        assertEq(page3.length, 1);
        assertEq(page3[0], 1);

        // Offset beyond length returns empty
        uint256[] memory emptyPage = chrono.getUserLockIds(alice, 5, 2);
        assertEq(emptyPage.length, 0);

        // Limit = 0 returns empty
        uint256[] memory zeroLimit = chrono.getUserLockIds(alice, 0, 0);
        assertEq(zeroLimit.length, 0);

        // Global getLocks
        Chrono.Lock[] memory allLocks = chrono.getLocks(0, 10);
        assertEq(allLocks.length, 5);
        assertEq(allLocks[0].id, 5);
        assertEq(allLocks[4].id, 1);
    }

    // --- timeLeft Test ---

    function test_TimeLeft() public {
        uint64 unlockTime = uint64(block.timestamp + 300);
        vm.prank(alice);
        uint256 id = chrono.createLock{value: 1 ether}(unlockTime, "TimeLeft", false);

        assertEq(chrono.timeLeft(id), 300);

        vm.warp(block.timestamp + 100);
        assertEq(chrono.timeLeft(id), 200);

        vm.warp(unlockTime);
        assertEq(chrono.timeLeft(id), 0);

        vm.warp(unlockTime + 50);
        assertEq(chrono.timeLeft(id), 0);
    }

    // --- Fuzz Test ---

    function testFuzz_LockLifecycle(
        uint96 amount,
        uint32 duration,
        bool flexible,
        bool doExitEarly
    ) public {
        amount = uint96(bound(amount, 1000, 100 ether));
        duration = uint32(bound(duration, DEFAULT_MIN_LOCK, uint32(5 * 365 days)));

        vm.deal(alice, uint256(amount) + 1 ether);

        uint64 unlockTime = uint64(block.timestamp + duration);
        vm.prank(alice);
        uint256 id = chrono.createLock{value: amount}(unlockTime, "Fuzz", flexible);

        if (flexible && doExitEarly) {
            uint256 aliceBefore = alice.balance;
            vm.prank(alice);
            chrono.exitEarly(id);
            uint256 payout = alice.balance - aliceBefore;
            uint256 penalty = chrono.penaltyBalance();

            // Payout + penalty must exactly equal amount
            assertEq(payout + penalty, amount);

            // Claim penalties
            vm.prank(penaltyRecipient);
            chrono.claimPenalties();
            assertEq(address(chrono).balance, 0);
            assertEq(chrono.totalLocked(), 0);
        } else {
            // Warp to unlock and withdraw
            vm.warp(unlockTime);
            uint256 aliceBefore = alice.balance;
            vm.prank(alice);
            chrono.withdraw(id);
            uint256 payout = alice.balance - aliceBefore;

            assertEq(payout, amount);
            assertEq(chrono.totalLocked(), 0);
            assertEq(address(chrono).balance, 0);
        }
    }
}
