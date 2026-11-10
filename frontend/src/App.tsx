import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseEther,
} from 'viem';
import {
  contractAddress,
  chronoAbi,
  botMainnet,
} from './contracts';
import { LockItem, LockStatus, TxStatus, VaultConstants } from './types';
import {
  shortenAddress,
  formatBOT,
  formatExactBOT,
  formatDate,
  formatCountdown,
  getStatusDetails,
  parseContractError,
} from './utils';
import chronoLogo from './assets/chrono.jpeg';
import botLogo from './assets/botchainlogo_transparent.png';

// Public client connected to BOT Mainnet
const publicClient = createPublicClient({
  chain: botMainnet,
  transport: http('https://rpc.botchain.ai'),
});

// Circular Progress Component
const CircularProgress: React.FC<{ progress: number; size?: number; strokeWidth?: number }> = ({
  progress,
  size = 76,
  strokeWidth = 6,
}) => {
  const clampedProgress = Math.max(0, Math.min(100, progress));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clampedProgress / 100) * circumference;

  return (
    <div className="progress-ring-container" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="progress-ring-svg">
        <defs>
          <linearGradient id="chronoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="url(#chronoGradient)"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="transparent"
          style={{
            transform: `rotate(-90deg)`,
            transformOrigin: '50% 50%',
            transition: 'stroke-dashoffset 0.8s ease-in-out',
          }}
        />
      </svg>
      <div className="progress-ring-text">
        <span>{Math.round(clampedProgress)}%</span>
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  // Wallet & network state
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [userBalance, setUserBalance] = useState<bigint | null>(null);

  // Contract constants & stats
  const [constants, setConstants] = useState<VaultConstants>({
    penaltyRecipient: '',
    penaltyBps: 1000n,
    minLockSeconds: 120n,
    maxLockSeconds: 157680000n,
  });
  const [totalLockedVault, setTotalLockedVault] = useState<bigint>(0n);
  const [penaltyBalance, setPenaltyBalance] = useState<bigint>(0n);
  const [totalVaultLocks, setTotalVaultLocks] = useState<bigint>(0n);

  // Locks state
  const [userLocks, setUserLocks] = useState<LockItem[]>([]);
  const [loadingLocks, setLoadingLocks] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');

  // Time & sync state
  const [nowSec, setNowSec] = useState<number>(Math.floor(Date.now() / 1000));
  const [chainTimestampOffset, setChainTimestampOffset] = useState<number>(0);

  // Transaction banner
  const [txStatus, setTxStatus] = useState<TxStatus>({ state: 'idle' });

  // "New Lock" form state
  const [lockAmount, setLockAmount] = useState<string>('0.5');
  const [lockDurationMode, setLockDurationMode] = useState<string>('2m');
  const [customUnlockDateTime, setCustomUnlockDateTime] = useState<string>('');
  const [lockLabel, setLockLabel] = useState<string>('');
  const [isFlexible, setIsFlexible] = useState<boolean>(false); // Strict by default!
  const [creatingLock, setCreatingLock] = useState<boolean>(false);

  // Card action states
  const [topUpInputs, setTopUpInputs] = useState<Record<string, string>>({});
  const [extendInputs, setExtendInputs] = useState<Record<string, string>>({});
  const [actionPendingId, setActionPendingId] = useState<string | null>(null);

  // Exit Early confirmation modal state
  const [earlyExitLock, setEarlyExitLock] = useState<LockItem | null>(null);

  // Lock lookup / Hash routing
  const [inspectedLockId, setInspectedLockId] = useState<string>('');
  const [inspectedLock, setInspectedLock] = useState<LockItem | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState<boolean>(false);

  // Collapsible FAQ
  const [faqOpen, setFaqOpen] = useState<boolean>(false);

  const isCorrectChain = chainId === botMainnet.id;
  const explorerBaseUrl = 'https://scan.botchain.ai';

  // Effective current blockchain time (combines browser clock with calibrated offset)
  const effectiveChainNow = useMemo(() => {
    return nowSec + chainTimestampOffset;
  }, [nowSec, chainTimestampOffset]);

  // Calibrate time with latest block
  const syncChainTimestamp = useCallback(async () => {
    try {
      const block = await publicClient.getBlock({ blockTag: 'latest' });
      const blockTime = Number(block.timestamp);
      const local = Math.floor(Date.now() / 1000);
      setChainTimestampOffset(blockTime - local);
    } catch (err) {
      // Graceful fallback to local time
    }
  }, []);

  // Timer loop: tick every second
  useEffect(() => {
    const timer = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch initial constants from contract
  const fetchConstants = useCallback(async () => {
    try {
      const [pRecipient, pBps, mLock, totalL, pBal, lCount] = await Promise.all([
        publicClient.readContract({
          address: contractAddress,
          abi: chronoAbi,
          functionName: 'penaltyRecipient',
        }),
        publicClient.readContract({
          address: contractAddress,
          abi: chronoAbi,
          functionName: 'penaltyBps',
        }),
        publicClient.readContract({
          address: contractAddress,
          abi: chronoAbi,
          functionName: 'minLockSeconds',
        }),
        publicClient.readContract({
          address: contractAddress,
          abi: chronoAbi,
          functionName: 'totalLocked',
        }),
        publicClient.readContract({
          address: contractAddress,
          abi: chronoAbi,
          functionName: 'penaltyBalance',
        }),
        publicClient.readContract({
          address: contractAddress,
          abi: chronoAbi,
          functionName: 'lockCount',
        }),
      ]);

      setConstants({
        penaltyRecipient: (pRecipient as string).toLowerCase(),
        penaltyBps: BigInt(pBps as any),
        minLockSeconds: BigInt(mLock as any),
        maxLockSeconds: 157680000n, // 5 years constant
      });
      setTotalLockedVault(BigInt(totalL as any));
      setPenaltyBalance(BigInt(pBal as any));
      setTotalVaultLocks(BigInt(lCount as any));
    } catch (err) {
      console.error('Failed reading vault constants:', err);
    }
  }, []);

  // Switch or Add network action
  const switchToBotMainnet = async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x2a5' }], // 677 in hex
      });
      setChainId(677);
    } catch (switchError: any) {
      if (switchError.code === 4902 || switchError?.data?.originalError?.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: '0x2a5',
                chainName: 'BOT Mainnet',
                nativeCurrency: {
                  name: 'BOT',
                  symbol: 'BOT',
                  decimals: 18,
                },
                rpcUrls: ['https://rpc.botchain.ai'],
                blockExplorerUrls: ['https://scan.botchain.ai'],
              },
            ],
          });
          setChainId(677);
        } catch (addError) {
          console.error('Failed to add BOT Mainnet:', addError);
        }
      } else {
        console.error('Failed to switch network:', switchError);
      }
    }
  };

  // Get authorized wallet client
  const getAuthorizedWalletClient = async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('Please install MetaMask or another Web3 browser wallet.');
    }

    const accounts: string[] = await window.ethereum.request({
      method: 'eth_requestAccounts',
    });

    if (!accounts || accounts.length === 0) {
      throw new Error('No account found in your wallet.');
    }

    const activeAccount = accounts[0] as `0x${string}`;
    setAccount(activeAccount);

    const currentChainHex = await window.ethereum.request({ method: 'eth_chainId' });
    const currentChain = parseInt(currentChainHex, 16);
    setChainId(currentChain);

    if (currentChain !== botMainnet.id) {
      await switchToBotMainnet();
    }

    const client = createWalletClient({
      account: activeAccount,
      chain: botMainnet,
      transport: custom(window.ethereum),
    });

    return { client, account: activeAccount };
  };

  // Connect wallet
  const connectWallet = async () => {
    try {
      const { account: activeAccount } = await getAuthorizedWalletClient();
      setAccount(activeAccount);
      setTxStatus({ state: 'idle' });
    } catch (err: any) {
      setTxStatus({
        state: 'error',
        message: parseContractError(err),
      });
    }
  };

  // Fetch user balance
  const fetchUserBalance = useCallback(async () => {
    if (!account) return;
    try {
      const balance = await publicClient.getBalance({ address: account });
      setUserBalance(balance);
    } catch (err) {
      console.error('Failed to fetch user balance:', err);
    }
  }, [account]);

  // Fetch locks for user
  const fetchUserLocks = useCallback(async () => {
    if (!account) {
      setUserLocks([]);
      setLoadingLocks(false);
      return;
    }

    try {
      // Fetch up to 100 lock IDs for user newest-first
      const ids = (await publicClient.readContract({
        address: contractAddress,
        abi: chronoAbi,
        functionName: 'getUserLockIds',
        args: [account, 0n, 100n],
      })) as bigint[];

      if (!ids || ids.length === 0) {
        setUserLocks([]);
        setLoadingLocks(false);
        return;
      }

      // Fetch lock details in parallel
      const lockDetails = await Promise.all(
        ids.map(async (id) => {
          const l = (await publicClient.readContract({
            address: contractAddress,
            abi: chronoAbi,
            functionName: 'getLock',
            args: [id],
          })) as any;

          return {
            id: BigInt(l.id),
            owner: (l.owner as string).toLowerCase(),
            amount: BigInt(l.amount),
            label: l.label as string,
            createdAt: BigInt(l.createdAt),
            unlockTime: BigInt(l.unlockTime),
            flexible: Boolean(l.flexible),
            status: Number(l.status) as LockStatus,
          } as LockItem;
        })
      );

      setUserLocks(lockDetails);
    } catch (err) {
      console.error('Error fetching user locks:', err);
    } finally {
      setLoadingLocks(false);
    }
  }, [account]);

  // General refresh
  const refreshAll = useCallback(async () => {
    await Promise.all([
      fetchConstants(),
      syncChainTimestamp(),
      fetchUserBalance(),
      fetchUserLocks(),
    ]);
  }, [fetchConstants, syncChainTimestamp, fetchUserBalance, fetchUserLocks]);

  // Initial load and periodic polling (every 4 seconds)
  useEffect(() => {
    refreshAll();
    const interval = setInterval(refreshAll, 4000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  // Listen to account/chain changes
  useEffect(() => {
    if (!window.ethereum) return;
    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length > 0) {
        setAccount(accounts[0] as `0x${string}`);
      } else {
        setAccount(null);
      }
    };
    const handleChainChanged = (hexId: string) => {
      setChainId(parseInt(hexId, 16));
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      window.ethereum?.removeListener?.('accountsChanged', handleAccountsChanged);
      window.ethereum?.removeListener?.('chainChanged', handleChainChanged);
    };
  }, []);

  // Compute calculated target unlock timestamp for the "New Lock" form
  const computedUnlockTimestamp = useMemo(() => {
    const base = effectiveChainNow;
    if (lockDurationMode === '2m') {
      return base + Number(constants.minLockSeconds); // 120s
    }
    if (lockDurationMode === '1d') {
      return base + 86400;
    }
    if (lockDurationMode === '1w') {
      return base + 7 * 86400;
    }
    if (lockDurationMode === '1m') {
      return base + 30 * 86400;
    }
    if (lockDurationMode === '3m') {
      return base + 90 * 86400;
    }
    if (lockDurationMode === '1y') {
      return base + 365 * 86400;
    }
    if (lockDurationMode === 'custom' && customUnlockDateTime) {
      const parsed = Math.floor(new Date(customUnlockDateTime).getTime() / 1000);
      return isNaN(parsed) ? base + 120 : parsed;
    }
    return base + 120;
  }, [lockDurationMode, customUnlockDateTime, effectiveChainNow, constants.minLockSeconds]);

  // Validations for "New Lock"
  const isUnlockTimeValid = useMemo(() => {
    const minTime = effectiveChainNow + Number(constants.minLockSeconds);
    const maxTime = effectiveChainNow + Number(constants.maxLockSeconds);
    return computedUnlockTimestamp >= minTime && computedUnlockTimestamp <= maxTime;
  }, [computedUnlockTimestamp, effectiveChainNow, constants.minLockSeconds, constants.maxLockSeconds]);

  const parsedAmountWei = useMemo(() => {
    try {
      if (!lockAmount || isNaN(Number(lockAmount)) || Number(lockAmount) <= 0) return 0n;
      return parseEther(lockAmount);
    } catch {
      return 0n;
    }
  }, [lockAmount]);

  const canCreateLock =
    parsedAmountWei > 0n &&
    isUnlockTimeValid &&
    lockLabel.length <= 50 &&
    !creatingLock;

  // Handle Create Lock submission
  const handleCreateLock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateLock) return;

    try {
      setCreatingLock(true);
      setTxStatus({ state: 'pending', message: 'Creating time-locked savings position...' });

      const { client, account: sender } = await getAuthorizedWalletClient();

      const hash = await client.writeContract({
        address: contractAddress,
        abi: chronoAbi,
        functionName: 'createLock',
        args: [BigInt(computedUnlockTimestamp), lockLabel.trim(), isFlexible],
        value: parsedAmountWei,
        account: sender,
      });

      setTxStatus({
        state: 'pending',
        message: 'Transaction submitted. Waiting for onchain confirmation...',
        hash,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setTxStatus({
        state: 'success',
        message: `Successfully locked ${formatBOT(parsedAmountWei)} until ${formatDate(computedUnlockTimestamp)}!`,
        hash,
      });

      // Reset form
      setLockAmount('0.5');
      setLockLabel('');
      await refreshAll();
    } catch (err: any) {
      console.error('Error creating lock:', err);
      setTxStatus({
        state: 'error',
        message: parseContractError(err),
      });
    } finally {
      setCreatingLock(false);
    }
  };

  // Handle Withdraw
  const handleWithdraw = async (lock: LockItem) => {
    try {
      setActionPendingId(`withdraw-${lock.id}`);
      setTxStatus({ state: 'pending', message: `Withdrawing ${formatBOT(lock.amount)}...` });

      const { client, account: sender } = await getAuthorizedWalletClient();

      const hash = await client.writeContract({
        address: contractAddress,
        abi: chronoAbi,
        functionName: 'withdraw',
        args: [lock.id],
        account: sender,
      });

      setTxStatus({
        state: 'pending',
        message: 'Withdrawing locked funds. Awaiting confirmation...',
        hash,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setTxStatus({
        state: 'success',
        message: `Successfully withdrawn ${formatBOT(lock.amount)} with 0% fee!`,
        hash,
      });

      await refreshAll();
    } catch (err: any) {
      setTxStatus({
        state: 'error',
        message: parseContractError(err),
      });
    } finally {
      setActionPendingId(null);
    }
  };

  // Handle Top-Up
  const handleTopUp = async (lock: LockItem) => {
    const valStr = topUpInputs[lock.id.toString()] || '';
    if (!valStr || isNaN(Number(valStr)) || Number(valStr) <= 0) {
      setTxStatus({ state: 'error', message: 'Please enter a valid top-up amount.' });
      return;
    }

    try {
      const topUpWei = parseEther(valStr);
      setActionPendingId(`topup-${lock.id}`);
      setTxStatus({ state: 'pending', message: `Adding ${formatBOT(topUpWei)} to lock #${lock.id}...` });

      const { client, account: sender } = await getAuthorizedWalletClient();

      const hash = await client.writeContract({
        address: contractAddress,
        abi: chronoAbi,
        functionName: 'topUp',
        args: [lock.id],
        value: topUpWei,
        account: sender,
      });

      setTxStatus({
        state: 'pending',
        message: 'Top-up transaction submitted. Awaiting block...',
        hash,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setTxStatus({
        state: 'success',
        message: `Successfully topped up lock #${lock.id} with ${formatBOT(topUpWei)}!`,
        hash,
      });

      setTopUpInputs((prev) => ({ ...prev, [lock.id.toString()]: '' }));
      await refreshAll();
    } catch (err: any) {
      setTxStatus({
        state: 'error',
        message: parseContractError(err),
      });
    } finally {
      setActionPendingId(null);
    }
  };

  // Handle Extend Lock
  const handleExtendLock = async (lock: LockItem) => {
    const dateStr = extendInputs[lock.id.toString()];
    if (!dateStr) {
      setTxStatus({ state: 'error', message: 'Please select a later unlock date & time.' });
      return;
    }

    const newUnlockSec = Math.floor(new Date(dateStr).getTime() / 1000);
    if (newUnlockSec <= Number(lock.unlockTime)) {
      setTxStatus({ state: 'error', message: 'New unlock date must be further in the future than the current unlock date.' });
      return;
    }
    if (newUnlockSec > effectiveChainNow + Number(constants.maxLockSeconds)) {
      setTxStatus({ state: 'error', message: 'New unlock date exceeds 5-year maximum duration.' });
      return;
    }

    try {
      setActionPendingId(`extend-${lock.id}`);
      setTxStatus({ state: 'pending', message: `Extending lock #${lock.id} to ${formatDate(newUnlockSec)}...` });

      const { client, account: sender } = await getAuthorizedWalletClient();

      const hash = await client.writeContract({
        address: contractAddress,
        abi: chronoAbi,
        functionName: 'extendLock',
        args: [lock.id, BigInt(newUnlockSec)],
        account: sender,
      });

      setTxStatus({
        state: 'pending',
        message: 'Lock extension submitted. Awaiting block...',
        hash,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setTxStatus({
        state: 'success',
        message: `Lock #${lock.id} extended to ${formatDate(newUnlockSec)}!`,
        hash,
      });

      setExtendInputs((prev) => ({ ...prev, [lock.id.toString()]: '' }));
      await refreshAll();
    } catch (err: any) {
      setTxStatus({
        state: 'error',
        message: parseContractError(err),
      });
    } finally {
      setActionPendingId(null);
    }
  };

  // Handle Exit Early
  const handleExitEarly = async (lock: LockItem) => {
    try {
      setActionPendingId(`exit-${lock.id}`);
      setTxStatus({ state: 'pending', message: `Executing early exit for lock #${lock.id}...` });

      const { client, account: sender } = await getAuthorizedWalletClient();

      const hash = await client.writeContract({
        address: contractAddress,
        abi: chronoAbi,
        functionName: 'exitEarly',
        args: [lock.id],
        account: sender,
      });

      setTxStatus({
        state: 'pending',
        message: 'Early exit transaction submitted. Awaiting block...',
        hash,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setTxStatus({
        state: 'success',
        message: `Early exit completed for lock #${lock.id}. Net funds received.`,
        hash,
      });

      setEarlyExitLock(null);
      await refreshAll();
    } catch (err: any) {
      setTxStatus({
        state: 'error',
        message: parseContractError(err),
      });
    } finally {
      setActionPendingId(null);
    }
  };

  // Handle Claim Penalties
  const handleClaimPenalties = async () => {
    try {
      setActionPendingId('claim-penalties');
      setTxStatus({ state: 'pending', message: 'Claiming accumulated early-exit penalties...' });

      const { client, account: sender } = await getAuthorizedWalletClient();

      const hash = await client.writeContract({
        address: contractAddress,
        abi: chronoAbi,
        functionName: 'claimPenalties',
        account: sender,
      });

      setTxStatus({
        state: 'pending',
        message: 'Claim transaction submitted. Awaiting block...',
        hash,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setTxStatus({
        state: 'success',
        message: `Successfully claimed ${formatBOT(penaltyBalance)} in penalties!`,
        hash,
      });

      await refreshAll();
    } catch (err: any) {
      setTxStatus({
        state: 'error',
        message: parseContractError(err),
      });
    } finally {
      setActionPendingId(null);
    }
  };

  // Lookup lock by ID
  const lookupLockById = async (idToLook: string) => {
    const numericId = parseInt(idToLook.trim(), 10);
    if (isNaN(numericId) || numericId <= 0) {
      setLookupError('Please enter a valid numeric Lock ID.');
      setInspectedLock(null);
      return;
    }

    try {
      setLookingUp(true);
      setLookupError(null);

      const l = (await publicClient.readContract({
        address: contractAddress,
        abi: chronoAbi,
        functionName: 'getLock',
        args: [BigInt(numericId)],
      })) as any;

      setInspectedLock({
        id: BigInt(l.id),
        owner: (l.owner as string).toLowerCase(),
        amount: BigInt(l.amount),
        label: l.label as string,
        createdAt: BigInt(l.createdAt),
        unlockTime: BigInt(l.unlockTime),
        flexible: Boolean(l.flexible),
        status: Number(l.status) as LockStatus,
      });
    } catch (err) {
      setLookupError(`Lock #${numericId} not found onchain.`);
      setInspectedLock(null);
    } finally {
      setLookingUp(false);
    }
  };

  // Hash routing listener for #/lock/:id
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      const match = hash.match(/#\/lock\/(\d+)/);
      if (match && match[1]) {
        setInspectedLockId(match[1]);
        lookupLockById(match[1]);
      }
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  // Summary strip statistics
  const userStats = useMemo(() => {
    let userLocked = 0n;
    let userActiveCount = 0;
    let nextUnlock: bigint | null = null;

    for (const lock of userLocks) {
      if (lock.status === LockStatus.Active) {
        userLocked += lock.amount;
        userActiveCount++;
        if (Number(lock.unlockTime) > effectiveChainNow) {
          if (nextUnlock === null || lock.unlockTime < nextUnlock) {
            nextUnlock = lock.unlockTime;
          }
        }
      }
    }

    return {
      userLocked,
      userActiveCount,
      nextUnlockTime: nextUnlock,
    };
  }, [userLocks, effectiveChainNow]);

  // Filtered & sorted locks
  const activeLocksSorted = useMemo(() => {
    return userLocks
      .filter((l) => l.status === LockStatus.Active)
      .sort((a, b) => Number(a.unlockTime - b.unlockTime)); // Nearest unlock first
  }, [userLocks]);

  const historyLocks = useMemo(() => {
    return userLocks
      .filter((l) => l.status !== LockStatus.Active)
      .sort((a, b) => Number(b.id - a.id)); // Newest first
  }, [userLocks]);

  const displayedLocks = activeTab === 'active' ? activeLocksSorted : historyLocks;

  // Connected wallet is penalty recipient?
  const isPenaltyRecipient =
    Boolean(account) &&
    Boolean(constants.penaltyRecipient) &&
    account?.toLowerCase() === constants.penaltyRecipient.toLowerCase();

  return (
    <div className="chrono-app">
      {/* Background Ambient Glows */}
      <div className="ambient-orb orb-primary" />
      <div className="ambient-orb orb-secondary" />

      {/* Top Navigation / Header */}
      <header className="chrono-header">
        <div className="brand-group">
          <div className="vault-emblem">
            <img src={chronoLogo} alt="Chrono Logo" className="app-logo-img" />
          </div>
          <div className="brand-titles">
            <h1 className="brand-name">CHRONO</h1>
            <p className="brand-tagline">Time-locked. Temptation-proof.</p>
          </div>
        </div>

        <div className="header-meta">
          <div className="network-indicator">
            <span className={`pulse-dot ${isCorrectChain ? 'active' : 'warn'}`} />
            <span className="network-name">BOT Mainnet (677)</span>
          </div>

          {account ? (
            <div className="wallet-pill">
              <span className="wallet-address" title={account}>
                {shortenAddress(account)}
              </span>
              {userBalance !== null && (
                <span className="wallet-balance">{formatBOT(userBalance)}</span>
              )}
            </div>
          ) : (
            <button className="btn btn-connect" onClick={connectWallet}>
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      {/* Network Warning Banner */}
      {account && !isCorrectChain && (
        <div className="warning-banner">
          <div className="warning-text">
            <span>⚠️ Wallet is connected to the wrong network. Chrono operates on BOT Mainnet (Chain ID 677).</span>
          </div>
          <button className="btn btn-sm btn-warn" onClick={switchToBotMainnet}>
            Switch to BOT Mainnet
          </button>
        </div>
      )}

      {/* Toast Transaction Status */}
      {txStatus.state !== 'idle' && (
        <div className={`tx-toast tx-${txStatus.state}`}>
          <div className="tx-icon">
            {txStatus.state === 'pending' && <span className="spin-icon">⏳</span>}
            {txStatus.state === 'success' && <span>✅</span>}
            {txStatus.state === 'error' && <span>❌</span>}
          </div>
          <div className="tx-body">
            <span className="tx-msg">{txStatus.message}</span>
            {txStatus.hash && (
              <a
                href={`${explorerBaseUrl}/tx/${txStatus.hash}`}
                target="_blank"
                rel="noreferrer"
                className="tx-explorer-link"
              >
                View on BOTScan ↗
              </a>
            )}
          </div>
          <button
            className="tx-dismiss"
            onClick={() => setTxStatus({ state: 'idle' })}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}

      <main className="chrono-main">
        {/* Summary Statistics Strip */}
        <section className="summary-strip">
          <div className="stat-card">
            <span className="stat-label">Your Locked BOT</span>
            <div className="stat-value text-gradient">{formatBOT(userStats.userLocked)}</div>
            <span className="stat-sub">Across {userStats.userActiveCount} active locks</span>
          </div>

          <div className="stat-card">
            <span className="stat-label">Active Positions</span>
            <div className="stat-value">{userStats.userActiveCount}</div>
            <span className="stat-sub">Total vault locks: {totalVaultLocks.toString()}</span>
          </div>

          <div className="stat-card">
            <span className="stat-label">Next Unlock</span>
            <div className="stat-value stat-countdown">
              {userStats.nextUnlockTime ? (
                formatCountdown(Math.max(0, Number(userStats.nextUnlockTime) - effectiveChainNow)).formatted
              ) : (
                'None Active'
              )}
            </div>
            <span className="stat-sub">
              {userStats.nextUnlockTime ? formatDate(userStats.nextUnlockTime) : 'Create a lock below'}
            </span>
          </div>

          <div className="stat-card">
            <span className="stat-label">Total Vault TVL</span>
            <div className="stat-value text-accent">{formatBOT(totalLockedVault)}</div>
            <span className="stat-sub">Locked permanently until unlock</span>
          </div>
        </section>

        {/* Penalty Recipient Admin Panel (Shown ONLY if connected wallet is penaltyRecipient) */}
        {isPenaltyRecipient && (
          <section className="penalty-panel card-glass">
            <div className="panel-header">
              <div className="badge-admin">Penalty Vault Operator</div>
              <h3>Collected Early-Exit Penalties</h3>
            </div>
            <div className="panel-content">
              <div className="penalty-balance-box">
                <span className="penalty-num">{formatBOT(penaltyBalance)}</span>
                <span className="penalty-sub">Available claimable penalty pool</span>
              </div>
              <button
                className="btn btn-accent"
                onClick={handleClaimPenalties}
                disabled={penaltyBalance === 0n || actionPendingId === 'claim-penalties'}
              >
                {actionPendingId === 'claim-penalties' ? 'Claiming...' : 'Claim Penalties'}
              </button>
            </div>
          </section>
        )}

        {/* Core Content Grid */}
        <div className="content-grid">
          {/* Column 1: Create New Lock Card */}
          <section className="create-lock-card card-glass">
            <div className="card-header">
              <div className="header-icon">🔒</div>
              <div>
                <h2>Create Time-Lock</h2>
                <p className="card-subtitle">Lock your native BOT. No early temptations.</p>
              </div>
            </div>

            <form onSubmit={handleCreateLock} className="lock-form">
              {/* Amount Input */}
              <div className="form-group">
                <div className="form-label-row">
                  <label htmlFor="lock-amount">Amount to Lock (BOT)</label>
                  {userBalance !== null && (
                    <button
                      type="button"
                      className="btn-text-max"
                      onClick={() => {
                        // Leave small reserve for gas
                        const maxVal = userBalance > parseEther('0.05') ? userBalance - parseEther('0.05') : 0n;
                        setLockAmount(formatExactBOT(maxVal));
                      }}
                    >
                      Balance: {formatBOT(userBalance)} (Max)
                    </button>
                  )}
                </div>
                <div className="input-with-adornment">
                  <input
                    id="lock-amount"
                    type="number"
                    step="any"
                    min="0"
                    placeholder="0.0"
                    value={lockAmount}
                    onChange={(e) => setLockAmount(e.target.value)}
                    required
                    className="chrono-input"
                  />
                  <span className="input-adornment">BOT</span>
                </div>
              </div>

              {/* Duration Picker */}
              <div className="form-group">
                <label>Lock Duration</label>
                <div className="quick-buttons-row">
                  {[
                    { label: '2 Min (Demo)', val: '2m' },
                    { label: '1 Day', val: '1d' },
                    { label: '1 Week', val: '1w' },
                    { label: '1 Month', val: '1m' },
                    { label: '3 Months', val: '3m' },
                    { label: '1 Year', val: '1y' },
                    { label: 'Custom', val: 'custom' },
                  ].map((btn) => (
                    <button
                      type="button"
                      key={btn.val}
                      className={`btn-quick ${lockDurationMode === btn.val ? 'active' : ''}`}
                      onClick={() => setLockDurationMode(btn.val)}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>

                {lockDurationMode === 'custom' && (
                  <div className="custom-datetime-container">
                    <input
                      type="datetime-local"
                      value={customUnlockDateTime}
                      onChange={(e) => setCustomUnlockDateTime(e.target.value)}
                      min={new Date(Date.now() + 130 * 1000).toISOString().slice(0, 16)}
                      className="chrono-input custom-date-input"
                      required
                    />
                  </div>
                )}

                <div className="date-preview-badge">
                  <span>Unlocks on:</span>
                  <strong>{formatDate(computedUnlockTimestamp)}</strong>
                </div>
              </div>

              {/* Optional Label with live counter */}
              <div className="form-group">
                <div className="form-label-row">
                  <label htmlFor="lock-label">Label (Optional)</label>
                  <span className={`char-counter ${lockLabel.length > 50 ? 'over' : ''}`}>
                    {lockLabel.length}/50
                  </span>
                </div>
                <input
                  id="lock-label"
                  type="text"
                  maxLength={50}
                  placeholder="e.g. Vacation Fund, Long-term Savings, Q4 Tax"
                  value={lockLabel}
                  onChange={(e) => setLockLabel(e.target.value)}
                  className="chrono-input"
                />
              </div>

              {/* Lock Mode Selector (Strict vs Flexible) */}
              <div className="form-group">
                <label>Lock Mode</label>
                <div className="mode-toggle-group">
                  <div
                    className={`mode-option ${!isFlexible ? 'selected' : ''}`}
                    onClick={() => setIsFlexible(false)}
                  >
                    <div className="mode-radio-header">
                      <span className="mode-radio-circle" />
                      <strong>Strict Mode</strong>
                      <span className="badge-recommended">Default</span>
                    </div>
                    <p className="mode-description">
                      Zero early exit under any condition. Mathematically un-unlockable until date.
                    </p>
                  </div>

                  <div
                    className={`mode-option ${isFlexible ? 'selected' : ''}`}
                    onClick={() => setIsFlexible(true)}
                  >
                    <div className="mode-radio-header">
                      <span className="mode-radio-circle" />
                      <strong>Flexible Mode</strong>
                      <span className="badge-penalty">
                        {Number(constants.penaltyBps) / 100}% Penalty
                      </span>
                    </div>
                    <p className="mode-description">
                      Early exit is allowed, but incurs a strictly deducted {Number(constants.penaltyBps) / 100}% penalty.
                    </p>
                  </div>
                </div>
              </div>

              {/* Summary Box before confirming */}
              <div className="confirmation-summary-box">
                <div className="summary-headline">
                  You lock <strong>{lockAmount ? `${lockAmount} BOT` : '0 BOT'}</strong> until{' '}
                  <strong>{formatDate(computedUnlockTimestamp)}</strong>.
                </div>
                <div className="summary-footnote">
                  {!isFlexible ? (
                    <span className="strict-note">
                      🔒 <strong>Strict:</strong> Nobody can unlock it before then, not even you. No admin override exists.
                    </span>
                  ) : (
                    <span className="flex-note">
                      ⚡ <strong>Flexible:</strong> Leaving early will cost you {Number(constants.penaltyBps) / 100}% (
                      {lockAmount && !isNaN(Number(lockAmount))
                        ? (Number(lockAmount) * (Number(constants.penaltyBps) / 10000)).toFixed(4)
                        : '0'}{' '}
                      BOT).
                    </span>
                  )}
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-submit-lock"
                disabled={!canCreateLock}
              >
                {creatingLock ? 'Creating Onchain Lock...' : 'Lock BOT'}
              </button>
            </form>
          </section>

          {/* Column 2: My Locks & Lock Inspector */}
          <section className="my-locks-section">
            {/* Tab navigation: Active vs History */}
            <div className="locks-tab-bar">
              <div className="tabs-left">
                <button
                  className={`tab-btn ${activeTab === 'active' ? 'active' : ''}`}
                  onClick={() => setActiveTab('active')}
                >
                  Active Locks ({activeLocksSorted.length})
                </button>
                <button
                  className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
                  onClick={() => setActiveTab('history')}
                >
                  History ({historyLocks.length})
                </button>
              </div>

              <div className="lookup-bar">
                <input
                  type="text"
                  placeholder="Lookup Lock #ID"
                  value={inspectedLockId}
                  onChange={(e) => setInspectedLockId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') lookupLockById(inspectedLockId);
                  }}
                  className="chrono-input input-compact"
                />
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => lookupLockById(inspectedLockId)}
                  disabled={lookingUp}
                >
                  {lookingUp ? '...' : 'Search'}
                </button>
              </div>
            </div>

            {/* Standalone Inspected Lock View (if searched or hash-routed) */}
            {inspectedLock && (
              <div className="inspected-lock-banner card-glass">
                <div className="inspected-header">
                  <div>
                    <span className="badge-inspect">Inspect Onchain Lock #{inspectedLock.id.toString()}</span>
                    <h4>{inspectedLock.label ? String(inspectedLock.label) : `Position #${inspectedLock.id}`}</h4>
                  </div>
                  <div className="inspected-actions">
                    <button
                      className="btn-copy-link"
                      onClick={() => {
                        const url = `${window.location.origin}${window.location.pathname}#/lock/${inspectedLock.id}`;
                        navigator.clipboard.writeText(url);
                        alert(`Copied link to clipboard: ${url}`);
                      }}
                    >
                      🔗 Share Link
                    </button>
                    <button className="btn-close-inspect" onClick={() => setInspectedLock(null)}>
                      ×
                    </button>
                  </div>
                </div>

                <div className="inspected-grid">
                  <div>
                    <span className="inspect-label">Owner</span>
                    <span className="inspect-val" title={inspectedLock.owner}>
                      {shortenAddress(inspectedLock.owner)}
                      {account && inspectedLock.owner === account.toLowerCase() && ' (You)'}
                    </span>
                  </div>
                  <div>
                    <span className="inspect-label">Amount</span>
                    <span className="inspect-val text-gradient">{formatBOT(inspectedLock.amount)}</span>
                  </div>
                  <div>
                    <span className="inspect-label">Mode</span>
                    <span className="inspect-val">
                      {inspectedLock.flexible ? 'Flexible (10% Penalty)' : 'Strict (No Early Exit)'}
                    </span>
                  </div>
                  <div>
                    <span className="inspect-label">Unlock Time</span>
                    <span className="inspect-val">{formatDate(inspectedLock.unlockTime)}</span>
                  </div>
                </div>
              </div>
            )}

            {lookupError && <div className="lookup-error-msg">⚠️ {lookupError}</div>}

            {/* Locks Cards List */}
            {loadingLocks ? (
              <div className="empty-locks-state card-glass">
                <div className="loader-spinner" />
                <p>Loading your time-locked positions from BOT Mainnet...</p>
              </div>
            ) : displayedLocks.length === 0 ? (
              <div className="empty-locks-state card-glass">
                <div className="empty-icon">⏳</div>
                <h3>No {activeTab === 'active' ? 'Active' : 'Past'} Locks Found</h3>
                <p>
                  {activeTab === 'active'
                    ? 'Create your first time-lock using the vault card on the left to start saving BOT.'
                    : 'Withdrawn and early-exited locks will be preserved in this history log.'}
                </p>
              </div>
            ) : (
              <div className="locks-card-list">
                {displayedLocks.map((lock) => {
                  const isUnlocked = effectiveChainNow >= Number(lock.unlockTime);
                  const isLocked = lock.status === LockStatus.Active && !isUnlocked;
                  const isWithdrawn = lock.status === LockStatus.Withdrawn;
                  const isExited = lock.status === LockStatus.ExitedEarly;

                  // Elapsed percentage calculation
                  const totalDuration = Number(lock.unlockTime) - Number(lock.createdAt);
                  const elapsedSeconds = effectiveChainNow - Number(lock.createdAt);
                  const progressPct =
                    totalDuration > 0
                      ? Math.min(100, Math.max(0, (elapsedSeconds / totalDuration) * 100))
                      : 100;

                  const remainingSec = Math.max(0, Number(lock.unlockTime) - effectiveChainNow);
                  const countdown = formatCountdown(remainingSec);
                  const statusInfo = getStatusDetails(lock.status, isUnlocked);

                  return (
                    <div
                      key={lock.id.toString()}
                      className={`lock-card card-glass ${isUnlocked && lock.status === LockStatus.Active ? 'unlocked-card' : ''}`}
                    >
                      {/* Top Bar of Lock Card */}
                      <div className="lock-card-top">
                        <div className="lock-card-title-group">
                          <span className="lock-id-badge">#{lock.id.toString()}</span>
                          <h3 className="lock-title">
                            {/* Plain text render only: No HTML/markdown injection */}
                            {lock.label ? String(lock.label) : 'Untitled Vault Lock'}
                          </h3>
                        </div>

                        <div className="lock-badges-group">
                          <span className={`badge-mode ${lock.flexible ? 'badge-flexible' : 'badge-strict'}`}>
                            {lock.flexible ? 'Flexible' : 'Strict'}
                          </span>
                          <span className={`badge-status ${statusInfo.badgeClass}`}>
                            {statusInfo.text}
                          </span>
                        </div>
                      </div>

                      {/* Middle Body: Progress Ring + Countdown + Financials */}
                      <div className="lock-card-body">
                        <div className="ring-col">
                          <CircularProgress
                            progress={
                              isWithdrawn || isExited
                                ? 100
                                : isUnlocked
                                ? 100
                                : progressPct
                            }
                          />
                        </div>

                        <div className="meta-col">
                          <div className="meta-row">
                            <span className="meta-title">Locked Amount</span>
                            <span className="meta-val amount-val">{formatBOT(lock.amount)}</span>
                          </div>

                          <div className="meta-row">
                            <span className="meta-title">
                              {isLocked ? 'Time Remaining' : 'Unlock Date'}
                            </span>
                            <span className="meta-val countdown-val">
                              {isLocked
                                ? countdown.formatted
                                : formatDate(lock.unlockTime)}
                            </span>
                          </div>

                          <div className="meta-row-sub">
                            <span>Locked on: {formatDate(lock.createdAt)}</span>
                            {isLocked && <span>Exact unlock: {formatDate(lock.unlockTime)}</span>}
                          </div>
                        </div>
                      </div>

                      {/* Role-Aware Actions Section */}
                      <div className="lock-card-actions">
                        {/* 1. Unlocked & Active -> Prominent Withdraw button */}
                        {lock.status === LockStatus.Active && isUnlocked && (
                          <div className="action-withdraw-full">
                            <button
                              className="btn btn-success btn-withdraw"
                              onClick={() => handleWithdraw(lock)}
                              disabled={actionPendingId === `withdraw-${lock.id}`}
                            >
                              {actionPendingId === `withdraw-${lock.id}`
                                ? 'Withdrawing...'
                                : `Withdraw ${formatBOT(lock.amount)}`}
                            </button>
                            <span className="withdraw-helper">0% penalty fee applied</span>
                          </div>
                        )}

                        {/* 2. Locked & Active -> Top Up, Extend, Exit Early / Strict Notice */}
                        {lock.status === LockStatus.Active && !isUnlocked && (
                          <div className="active-actions-wrapper">
                            {/* Top Up inline control */}
                            <div className="action-inline-form">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                placeholder="+ Add BOT"
                                value={topUpInputs[lock.id.toString()] || ''}
                                onChange={(e) =>
                                  setTopUpInputs({
                                    ...topUpInputs,
                                    [lock.id.toString()]: e.target.value,
                                  })
                                }
                                className="chrono-input input-xs"
                              />
                              <button
                                className="btn btn-sm btn-secondary"
                                onClick={() => handleTopUp(lock)}
                                disabled={actionPendingId === `topup-${lock.id}`}
                              >
                                {actionPendingId === `topup-${lock.id}` ? '...' : 'Top Up'}
                              </button>
                            </div>

                            {/* Extend Lock inline control */}
                            <div className="action-inline-form">
                              <input
                                type="datetime-local"
                                min={new Date(Number(lock.unlockTime) * 1000 + 60 * 1000)
                                  .toISOString()
                                  .slice(0, 16)}
                                value={extendInputs[lock.id.toString()] || ''}
                                onChange={(e) =>
                                  setExtendInputs({
                                    ...extendInputs,
                                    [lock.id.toString()]: e.target.value,
                                  })
                                }
                                className="chrono-input input-xs"
                              />
                              <button
                                className="btn btn-sm btn-secondary"
                                onClick={() => handleExtendLock(lock)}
                                disabled={actionPendingId === `extend-${lock.id}`}
                              >
                                {actionPendingId === `extend-${lock.id}` ? '...' : 'Extend'}
                              </button>
                            </div>

                            {/* Early Exit (Flexible) OR Strict Disabled Notice */}
                            <div className="action-exit-wrapper">
                              {lock.flexible ? (
                                <button
                                  className="btn btn-sm btn-danger-outline"
                                  onClick={() => setEarlyExitLock(lock)}
                                  disabled={actionPendingId === `exit-${lock.id}`}
                                >
                                  Exit Early ({Number(constants.penaltyBps) / 100}%)
                                </button>
                              ) : (
                                <div className="strict-disabled-badge">
                                  <span>🔒 Strict lock: no early exit</span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* 3. Settled positions (Withdrawn or ExitedEarly) */}
                        {isWithdrawn && (
                          <div className="settled-notice text-muted">
                            Position fully withdrawn. Funds sent to owner.
                          </div>
                        )}
                        {isExited && (
                          <div className="settled-notice text-muted">
                            Position closed via early exit. Penalty paid to protocol.
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Early Exit Confirmation Modal */}
        {earlyExitLock && (
          <div className="modal-backdrop">
            <div className="modal-card card-glass">
              <div className="modal-header">
                <h3>Confirm Early Exit (Lock #{earlyExitLock.id.toString()})</h3>
                <button className="btn-modal-close" onClick={() => setEarlyExitLock(null)}>
                  ×
                </button>
              </div>

              <div className="modal-body">
                <p>
                  You are exiting this flexible lock before its scheduled unlock time (
                  {formatDate(earlyExitLock.unlockTime)}).
                </p>

                {(() => {
                  const penaltyBps = Number(constants.penaltyBps);
                  const amount = earlyExitLock.amount;
                  const penalty = (amount * BigInt(penaltyBps) + 9999n) / 10000n;
                  const payout = amount > penalty ? amount - penalty : 0n;

                  return (
                    <div className="exit-breakdown-box">
                      <div className="breakdown-row">
                        <span>Original Locked Amount:</span>
                        <strong>{formatBOT(amount)}</strong>
                      </div>
                      <div className="breakdown-row text-danger">
                        <span>Penalty Deducted ({penaltyBps / 100}%):</span>
                        <strong>- {formatBOT(penalty)}</strong>
                      </div>
                      <hr className="breakdown-divider" />
                      <div className="breakdown-row text-success">
                        <span>You Receive Now:</span>
                        <strong className="payout-highlight">{formatBOT(payout)}</strong>
                      </div>
                    </div>
                  );
                })()}

                <p className="modal-caution">
                  ⚠️ This action cannot be reversed. Penalties are credited immediately to the vault penalty pool.
                </p>
              </div>

              <div className="modal-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setEarlyExitLock(null)}
                  disabled={actionPendingId === `exit-${earlyExitLock.id}`}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => handleExitEarly(earlyExitLock)}
                  disabled={actionPendingId === `exit-${earlyExitLock.id}`}
                >
                  {actionPendingId === `exit-${earlyExitLock.id}`
                    ? 'Processing...'
                    : 'Confirm & Exit Early'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Collapsible "How Chrono Works" Section */}
        <section className="faq-section card-glass">
          <div className="faq-header" onClick={() => setFaqOpen(!faqOpen)}>
            <div className="faq-title-row">
              <span className="faq-icon">💡</span>
              <h3>How Chrono Works & Trust Architecture</h3>
            </div>
            <span className="faq-toggle-arrow">{faqOpen ? '▲' : '▼'}</span>
          </div>

          {faqOpen && (
            <div className="faq-content">
              <div className="faq-grid">
                <div className="faq-item">
                  <h4>Strict Mode vs Flexible Mode</h4>
                  <p>
                    <strong>Strict Mode:</strong> No early withdrawal exists under any circumstances. Funds are mathematically locked in the smart contract until the target timestamp.
                    <br />
                    <strong>Flexible Mode:</strong> Allows early exit by deducting a {Number(constants.penaltyBps) / 100}% penalty fee. After the unlock time, both modes allow full 0% fee withdrawals.
                  </p>
                </div>

                <div className="faq-item">
                  <h4>Extending & Topping Up</h4>
                  <p>
                    You can add more BOT to an active lock at any point prior to unlock. You can also extend your lock duration further into the future (up to 5 years maximum). Locks can never be shortened or reduced.
                  </p>
                </div>

                <div className="faq-item">
                  <h4>Where Do Penalties Go?</h4>
                  <p>
                    Penalties from Flexible early exits accumulate onchain in the contract's penalty balance and are claimable exclusively by the designated protocol penalty recipient set at deployment.
                  </p>
                </div>

                <div className="faq-item">
                  <h4>Zero Backdoors & Auditing Notice</h4>
                  <p>
                    Chrono has no owner keys, no pause switches, and no proxy upgradeability. Even the contract deployer cannot unlock your Strict savings early.
                    <br />
                    <em>Notice: Chrono is deployed on the BOT Mainnet (Chain ID 677) as a trustless, time-locked savings vault.</em>
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="chrono-footer">
        {/* Section 1: Proof on bot mainnet */}
        <div className="footer-proof-section">
          <div className="footer-proof-badge">
            <span className="proof-status-dot">●</span>
            <span className="proof-heading">Proof on bot mainnet</span>
          </div>

          <div className="proof-info-grid">
            <div className="proof-info-item">
              <span className="proof-label">Chain id:</span>
              <span className="proof-value">677</span>
            </div>
            <div className="proof-info-sep">•</div>
            <div className="proof-info-item">
              <span className="proof-label">Contract:</span>
              <a
                href={`https://scan.botchain.ai/address/${contractAddress}`}
                target="_blank"
                rel="noreferrer"
                className="proof-contract-link"
              >
                {contractAddress}
              </a>
            </div>
          </div>

          <div className="footer-links-row">
            <a
              href="https://www.botchain.ai/en/"
              target="_blank"
              rel="noreferrer"
              className="footer-external-link"
            >
              BOT Chain Website
            </a>
            <span className="footer-links-sep">•</span>
            <a
              href="https://scan.botchain.ai/"
              target="_blank"
              rel="noreferrer"
              className="footer-external-link"
            >
              BOTScan explorer
            </a>
          </div>
        </div>

        {/* Section 2: Part of the Ecosystem */}
        <div className="ecosystem-section">
          <div className="ecosystem-header-label">PART OF THE ECOSYSTEM</div>

          <div className="ecosystem-logo-circle">
            <img src={botLogo} alt="BOT Chain Logo" className="ecosystem-logo" />
          </div>

          <h3 className="ecosystem-title">
            <span className="ecosystem-title-bot">BOT</span>
            <span className="ecosystem-title-chain"> Chain</span>
          </h3>

          <p className="ecosystem-tagline">
            Time-locked. Temptation-proof.
          </p>

          <div className="ecosystem-divider">
            <span className="ecosystem-divider-line" />
            <span className="ecosystem-divider-diamond">◆</span>
            <span className="ecosystem-divider-line" />
          </div>

          <div className="ecosystem-links">
            <a
              href="https://www.botchain.ai/en/"
              target="_blank"
              rel="noreferrer"
              className="ecosystem-link"
            >
              <svg className="ecosystem-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span>botchain.ai</span>
            </a>

            <a
              href="https://scan.botchain.ai/"
              target="_blank"
              rel="noreferrer"
              className="ecosystem-link"
            >
              <svg className="ecosystem-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span>Explorer</span>
            </a>
          </div>

          <div className="ecosystem-copyright">
            © 2026 <strong>BOT Chain</strong> · Mainnet · Chain ID <strong>677</strong>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
