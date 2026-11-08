export enum LockStatus {
  Active = 0,
  Withdrawn = 1,
  ExitedEarly = 2,
}

export interface LockItem {
  id: bigint;
  owner: string;
  amount: bigint;
  label: string;
  createdAt: bigint;
  unlockTime: bigint;
  flexible: boolean;
  status: LockStatus;
}

export interface TxStatus {
  state: 'idle' | 'pending' | 'success' | 'error';
  message?: string;
  hash?: `0x${string}`;
}

export interface VaultConstants {
  penaltyRecipient: string;
  penaltyBps: bigint;
  minLockSeconds: bigint;
  maxLockSeconds: bigint;
}

export interface VaultStats {
  totalLocked: bigint;
  userLocked: bigint;
  userActiveCount: number;
  nextUnlockTime: bigint | null;
  totalVaultLocks: bigint;
}
