import { formatEther } from 'viem';
import { LockStatus } from './types';

export function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatBOT(amountWei: bigint | undefined | null): string {
  if (amountWei === undefined || amountWei === null) return '0 BOT';
  const str = formatEther(amountWei);
  const num = parseFloat(str);
  if (num === 0) return '0 BOT';
  if (num < 0.0001) return '<0.0001 BOT';
  return `${num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  })} BOT`;
}

export function formatExactBOT(amountWei: bigint | undefined | null): string {
  if (amountWei === undefined || amountWei === null) return '0';
  return formatEther(amountWei);
}

export function formatDate(timestampSec: bigint | number): string {
  const ts = typeof timestampSec === 'bigint' ? Number(timestampSec) : timestampSec;
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatCountdown(secondsLeft: number): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  formatted: string;
} {
  if (secondsLeft <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, formatted: 'Unlocked' };
  }
  const days = Math.floor(secondsLeft / 86400);
  const hours = Math.floor((secondsLeft % 86400) / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  const seconds = secondsLeft % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return {
    days,
    hours,
    minutes,
    seconds,
    formatted: parts.join(' '),
  };
}

export function getStatusDetails(status: LockStatus, isUnlockedNow: boolean): {
  text: string;
  badgeClass: string;
} {
  if (status === LockStatus.Withdrawn) {
    return { text: 'Withdrawn', badgeClass: 'badge-withdrawn' };
  }
  if (status === LockStatus.ExitedEarly) {
    return { text: 'Exited Early', badgeClass: 'badge-exited' };
  }
  if (isUnlockedNow) {
    return { text: 'Unlocked', badgeClass: 'badge-unlocked' };
  }
  return { text: 'Locked', badgeClass: 'badge-locked' };
}

export function parseContractError(err: any): string {
  if (!err) return 'An unknown error occurred.';

  const str = (err.message || '') + ' ' + (err.shortMessage || '') + ' ' + (err.data?.message || '') + ' ' + (err.details || '');

  if (str.includes('User rejected') || str.includes('User denied')) {
    return 'Transaction rejected by user.';
  }
  if (str.includes('StrictLockCannotExitEarly')) {
    return 'Strict lock: early exit is mathematically impossible.';
  }
  if (str.includes('LockStillActive')) {
    return 'Lock is still active. Please wait until the exact unlock time.';
  }
  if (str.includes('LockAlreadyUnlocked')) {
    return 'Lock has already reached its unlock time.';
  }
  if (str.includes('LockNotActive')) {
    return 'Lock is no longer active (already settled).';
  }
  if (str.includes('InvalidNewUnlockTime')) {
    return 'Extension time must be further in the future and within the 5-year maximum.';
  }
  if (str.includes('InvalidUnlockTime')) {
    return 'Unlock date must be at least 2 minutes in the future and no more than 5 years.';
  }
  if (str.includes('ZeroAmount')) {
    return 'Amount must be greater than 0.';
  }
  if (str.includes('LabelTooLong')) {
    return 'Label cannot exceed 50 characters.';
  }
  if (str.includes('NotLockOwner')) {
    return 'Only the owner of this lock can perform this action.';
  }
  if (str.includes('NotPenaltyRecipient')) {
    return 'Only the designated penalty recipient can claim collected penalties.';
  }
  if (str.includes('ZeroPenaltyBalance')) {
    return 'No penalty balance is currently available to claim.';
  }
  if (str.includes('LockNotFound')) {
    return 'Lock ID was not found onchain.';
  }
  if (str.includes('insufficient funds')) {
    return 'Insufficient BOT in wallet to complete this transaction.';
  }

  return err.shortMessage || err.message || 'Transaction failed onchain.';
}
