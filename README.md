# Chrono - Time-locked. Temptation-proof.

> A time-locked savings vault for native BOT on the BOT Testnet. Commit your BOT until a chosen date with zero early unlocks in Strict mode, or flexibility with a safety penalty in Flexible mode. No admin overrides, no pauses, no upgrades.

---

## Overview

Chrono is an onchain time-locked savings vault for the native BOT currency on the BOT Testnet (Chain ID 968). Users deposit BOT into isolated savings positions with their own custom unlock date, label, and mode. Everything is recorded and executed purely onchain with zero offchain dependencies.

### Modes
- **Strict Mode (Recommended / Default)**: Absolute mathematical commitment. Once locked, nobody—neither the user, nor the contract deployer, nor any admin—can release or withdraw the funds prior to the exact target block timestamp. There is no emergency exit function.
- **Flexible Mode**: Provides flexibility in case of true emergencies. The owner can call `exitEarly(id)` before the unlock date, which automatically deducts a 10% penalty (`1000` bps) credited to protocol penalties, and immediately returns the remaining 90% net funds to the owner.
- **Post-Unlock (Both Modes)**: Once the target unlock timestamp has arrived or passed, 100% of the locked funds can be withdrawn by the owner with zero fees or deductions.

### Position States
- **Active (Locked)**: The funds are held in the contract.
  - Owner can `topUp(id)` to add more BOT.
  - Owner can `extendLock(id, newUnlockTime)` to postpone unlock further (up to 5 years).
  - If Flexible, owner can `exitEarly(id)` to withdraw `amount - penalty`.
- **Active (Unlocked)**: Current block timestamp $\ge$ `unlockTime`.
  - Owner can call `withdraw(id)` to receive 100% of funds with 0% penalty fee.
- **Withdrawn**: Position has been fully settled and closed by the owner post-unlock.
- **ExitedEarly**: Position was settled prior to unlock via early exit (Flexible mode only).

---

## Network & Deployment Information

- **Network**: BOT Testnet
- **Chain ID**: `968`
- **RPC URL**: `https://rpc.bohr.life`
- **Native Currency**: BOT (18 decimals)
- **Explorer**: `https://scan.bohr.life`
- **Deployed Contract Address**: [`0x0EA3c89F9f9A1dCdE0e5966D2e596E5985f8de3b`](https://scan.bohr.life/address/0x0EA3c89F9f9A1dCdE0e5966D2e596E5985f8de3b)
- **Deployment Transaction**: [`0xd36006e94a5b1b80e1a933e662ad87c17176c11e5951716a51ed9ddf930b728c`](https://scan.bohr.life/tx/0xd36006e94a5b1b80e1a933e662ad87c17176c11e5951716a51ed9ddf930b728c)
- **Penalty Recipient**: `0x44c0B36FA1a67eec472fF0AB032eC066847AAE1d`
- **Penalty Rate**: `1000` bps (10%)
- **Min Lock Duration**: `120` seconds (2 minutes)
- **Max Lock Duration**: `157680000` seconds (5 years)

---

## Trust and Security Notes

- **A Strict lock cannot be opened early by anyone**: There are no admin keys, no emergency withdraw functions, no pause mechanisms, and no proxy or upgradeability patterns. Funds are strictly governed by mathematical EVM timestamp checks.
- **Penalties go to the penaltyRecipient set at deploy time**: Penalties from Flexible early exits are credited strictly to `penaltyBalance` and claimable solely by the immutable `penaltyRecipient` address.
- **Strict release paths**: Locked funds are only released through the defined, audited paths (`withdraw` or `exitEarly`).
- **Checks-Effects-Interactions & ReentrancyGuard**: All functions handling native value utilize OpenZeppelin v5.x `ReentrancyGuard` and strictly apply state changes and event emissions before executing external value transfers.
- **No Double Settlement**: Locks in `Withdrawn` or `ExitedEarly` status are permanently closed and reject any further actions.
- **Plain Transfers Rejected**: No `receive()` or `fallback()` function is declared; plain transfers to the contract automatically revert.
- **Testnet Demo**: Chrono is deployed on the BOT Testnet for demonstration and testing purposes and has not been audited by a formal third-party security firm.

---

## Project Structure

```
chrono/
├── contracts/                  # Foundry smart contract project
│   ├── src/
│   │   └── Chrono.sol          # Main vault contract (ReentrancyGuard)
│   ├── test/
│   │   ├── Chrono.t.sol        # Unit, boundary, fuzz, reentrancy tests (37 tests)
│   │   └── ChronoInvariant.t.sol # Invariant tests (128,000 calls across 256 runs)
│   ├── script/
│   │   └── Deploy.s.sol        # Foundry deployment script
│   ├── foundry.toml            # Foundry configuration with BOT testnet RPC
│   └── remappings.txt          # OpenZeppelin & forge-std mappings
├── frontend/                   # Vite + React + TypeScript + viem frontend
│   ├── src/
│   │   ├── contracts/          # Deployed address, ABI, and viem chain definition
│   │   ├── types.ts            # LockItem, LockStatus, TxStatus, VaultConstants
│   │   ├── utils.ts            # Formatting (BOT, address, dates, countdowns)
│   │   ├── App.tsx             # Sleek dark-theme vault UI
│   │   └── App.css             # Vault & Time aesthetic styling
│   ├── index.html              # HTML shell with tagline
│   └── package.json
└── README.md
```

---

## Setup, Test & Run Instructions

### 1. Smart Contracts

#### Run Tests
```bash
cd contracts
forge test -vvv
```

#### Run Invariant Test Suite
```bash
cd contracts
forge test --match-test invariant -vvv
```

#### Deploy to BOT Testnet
```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url https://rpc.bohr.life --account chrono --password-file <path-to-password> --broadcast
```

### 2. Frontend

#### Install & Build
```bash
cd frontend
npm run build
```

#### Run Development Server
```bash
cd frontend
npm run dev
```

The frontend will run at `http://localhost:5174/` (or `http://localhost:5173/`).
