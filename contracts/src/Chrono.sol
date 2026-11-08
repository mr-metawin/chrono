// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Chrono
 * @notice Time-locked savings vault for native BOT.
 * Tagline: Time-locked. Temptation-proof.
 */
contract Chrono is ReentrancyGuard {
    // --- Enums & Structs ---

    enum Status {
        Active,
        Withdrawn,
        ExitedEarly
    }

    struct Lock {
        uint256 id;
        address owner;
        uint256 amount;
        string label;
        uint64 createdAt;
        uint64 unlockTime;
        bool flexible;
        Status status;
    }

    // --- Constants & Immutables ---

    uint256 public constant MAX_LOCK = 5 * 365 days; // 5 years

    address public immutable penaltyRecipient;
    uint256 public immutable penaltyBps;
    uint64 public immutable minLockSeconds;

    // --- State Variables ---

    uint256 public lockCount;
    uint256 public totalLocked;
    uint256 public penaltyBalance;

    mapping(uint256 => Lock) private _locks;
    mapping(address => uint256[]) private _userLockIds;

    // --- Events ---

    event LockCreated(
        uint256 indexed id,
        address indexed owner,
        uint256 amount,
        uint64 unlockTime,
        bool flexible,
        string label
    );

    event ToppedUp(
        uint256 indexed id,
        address indexed owner,
        uint256 addedAmount,
        uint256 newTotalAmount
    );

    event Extended(
        uint256 indexed id,
        address indexed owner,
        uint64 oldUnlockTime,
        uint64 newUnlockTime
    );

    event Withdrawn(
        uint256 indexed id,
        address indexed owner,
        uint256 amount
    );

    event ExitedEarly(
        uint256 indexed id,
        address indexed owner,
        uint256 payout,
        uint256 penalty
    );

    event PenaltiesClaimed(
        address indexed recipient,
        uint256 amount
    );

    // --- Custom Errors ---

    error ZeroAmount();
    error InvalidUnlockTime();
    error LabelTooLong();
    error LockNotFound();
    error NotLockOwner();
    error LockNotActive();
    error LockAlreadyUnlocked();
    error LockStillActive();
    error InvalidNewUnlockTime();
    error StrictLockCannotExitEarly();
    error NotPenaltyRecipient();
    error ZeroPenaltyBalance();
    error TransferFailed();
    error InvalidPenaltyRecipient();
    error InvalidPenaltyBps();
    error InvalidMinLockSeconds();

    // --- Constructor ---

    constructor(
        address _penaltyRecipient,
        uint256 _penaltyBps,
        uint64 _minLockSeconds
    ) {
        if (_penaltyRecipient == address(0)) revert InvalidPenaltyRecipient();
        if (_penaltyBps < 100 || _penaltyBps > 5000) revert InvalidPenaltyBps();
        if (_minLockSeconds < 60) revert InvalidMinLockSeconds();

        penaltyRecipient = _penaltyRecipient;
        penaltyBps = _penaltyBps;
        minLockSeconds = _minLockSeconds;
    }

    // --- Core Functions ---

    /**
     * @notice Create a new time-locked position.
     * @param unlockTime Timestamp when lock expires.
     * @param label Optional description (up to 50 bytes).
     * @param flexible True allows early exit with penalty, false gives zero early exit.
     */
    function createLock(
        uint64 unlockTime,
        string calldata label,
        bool flexible
    ) external payable nonReentrant returns (uint256 id) {
        if (msg.value == 0) revert ZeroAmount();
        if (
            unlockTime < block.timestamp + minLockSeconds ||
            unlockTime > block.timestamp + MAX_LOCK
        ) {
            revert InvalidUnlockTime();
        }
        if (bytes(label).length > 50) revert LabelTooLong();

        id = ++lockCount;

        _locks[id] = Lock({
            id: id,
            owner: msg.sender,
            amount: msg.value,
            label: label,
            createdAt: uint64(block.timestamp),
            unlockTime: unlockTime,
            flexible: flexible,
            status: Status.Active
        });

        _userLockIds[msg.sender].push(id);
        totalLocked += msg.value;

        emit LockCreated(id, msg.sender, msg.value, unlockTime, flexible, label);
    }

    /**
     * @notice Add more native BOT to an active lock before unlockTime.
     * @param id Lock identifier.
     */
    function topUp(uint256 id) external payable nonReentrant {
        if (id == 0 || id > lockCount) revert LockNotFound();
        Lock storage lock = _locks[id];

        if (msg.sender != lock.owner) revert NotLockOwner();
        if (lock.status != Status.Active) revert LockNotActive();
        if (block.timestamp >= lock.unlockTime) revert LockAlreadyUnlocked();
        if (msg.value == 0) revert ZeroAmount();

        lock.amount += msg.value;
        totalLocked += msg.value;

        emit ToppedUp(id, msg.sender, msg.value, lock.amount);
    }

    /**
     * @notice Extend an active lock further into the future.
     * @param id Lock identifier.
     * @param newUnlockTime The new unlock timestamp (must be > current unlockTime and <= block.timestamp + MAX_LOCK).
     */
    function extendLock(uint256 id, uint64 newUnlockTime) external {
        if (id == 0 || id > lockCount) revert LockNotFound();
        Lock storage lock = _locks[id];

        if (msg.sender != lock.owner) revert NotLockOwner();
        if (lock.status != Status.Active) revert LockNotActive();
        if (block.timestamp >= lock.unlockTime) revert LockAlreadyUnlocked();
        if (
            newUnlockTime <= lock.unlockTime ||
            newUnlockTime > block.timestamp + MAX_LOCK
        ) {
            revert InvalidNewUnlockTime();
        }

        uint64 oldUnlockTime = lock.unlockTime;
        lock.unlockTime = newUnlockTime;

        emit Extended(id, msg.sender, oldUnlockTime, newUnlockTime);
    }

    /**
     * @notice Withdraw full locked funds after unlockTime has passed.
     * @param id Lock identifier.
     */
    function withdraw(uint256 id) external nonReentrant {
        if (id == 0 || id > lockCount) revert LockNotFound();
        Lock storage lock = _locks[id];

        if (msg.sender != lock.owner) revert NotLockOwner();
        if (lock.status != Status.Active) revert LockNotActive();
        if (block.timestamp < lock.unlockTime) revert LockStillActive();

        uint256 payout = lock.amount;
        lock.status = Status.Withdrawn;
        totalLocked -= payout;

        emit Withdrawn(id, msg.sender, payout);

        (bool success, ) = payable(msg.sender).call{value: payout}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @notice Exit early from a flexible lock before unlockTime, paying the penalty.
     * @param id Lock identifier.
     */
    function exitEarly(uint256 id) external nonReentrant {
        if (id == 0 || id > lockCount) revert LockNotFound();
        Lock storage lock = _locks[id];

        if (msg.sender != lock.owner) revert NotLockOwner();
        if (lock.status != Status.Active) revert LockNotActive();
        if (block.timestamp >= lock.unlockTime) revert LockAlreadyUnlocked();
        if (!lock.flexible) revert StrictLockCannotExitEarly();

        uint256 amount = lock.amount;

        // penalty = amount * penaltyBps / 10000 (rounded up)
        uint256 penalty = (amount * penaltyBps + 9999) / 10000;
        if (penalty > amount) {
            penalty = amount;
        }
        uint256 payout = amount - penalty;

        lock.status = Status.ExitedEarly;
        totalLocked -= amount;
        penaltyBalance += penalty;

        emit ExitedEarly(id, msg.sender, payout, penalty);

        if (payout > 0) {
            (bool success, ) = payable(msg.sender).call{value: payout}("");
            if (!success) revert TransferFailed();
        }
    }

    /**
     * @notice Claim accumulated penalties by the designated penaltyRecipient.
     */
    function claimPenalties() external nonReentrant {
        if (msg.sender != penaltyRecipient) revert NotPenaltyRecipient();
        uint256 amount = penaltyBalance;
        if (amount == 0) revert ZeroPenaltyBalance();

        penaltyBalance = 0;

        emit PenaltiesClaimed(penaltyRecipient, amount);

        (bool success, ) = payable(penaltyRecipient).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    // --- Views ---

    /**
     * @notice Get single lock details by id.
     */
    function getLock(uint256 id) external view returns (Lock memory) {
        if (id == 0 || id > lockCount) revert LockNotFound();
        return _locks[id];
    }

    /**
     * @notice Get user lock ids, sorted newest first with pagination.
     */
    function getUserLockIds(
        address user,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory) {
        uint256 total = _userLockIds[user].length;
        if (offset >= total || limit == 0) {
            return new uint256[](0);
        }

        uint256 count = limit;
        if (offset + count > total) {
            count = total - offset;
        }

        uint256[] memory ids = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            ids[i] = _userLockIds[user][total - 1 - offset - i];
        }

        return ids;
    }

    /**
     * @notice Get all locks, sorted newest first with pagination.
     */
    function getLocks(
        uint256 offset,
        uint256 limit
    ) external view returns (Lock[] memory) {
        if (offset >= lockCount || limit == 0) {
            return new Lock[](0);
        }

        uint256 count = limit;
        if (offset + count > lockCount) {
            count = lockCount - offset;
        }

        Lock[] memory items = new Lock[](count);
        for (uint256 i = 0; i < count; i++) {
            items[i] = _locks[lockCount - offset - i];
        }

        return items;
    }

    /**
     * @notice Get remaining seconds until unlock for a given lock.
     */
    function timeLeft(uint256 id) external view returns (uint256) {
        if (id == 0 || id > lockCount) revert LockNotFound();
        Lock storage lock = _locks[id];
        if (lock.status != Status.Active || block.timestamp >= lock.unlockTime) {
            return 0;
        }
        return lock.unlockTime - block.timestamp;
    }
}
