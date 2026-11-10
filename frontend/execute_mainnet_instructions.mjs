import { createWalletClient, createPublicClient, http, parseEther, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs';

const chronoAbi = JSON.parse(fs.readFileSync('./src/contracts/chronoAbi.json', 'utf8'));

const botMainnet = defineChain({
  id: 677,
  name: 'BOT Mainnet',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.botchain.ai'] },
  },
  blockExplorers: {
    default: { name: 'BOTScan', url: 'https://scan.botchain.ai' },
  },
});

const contractAddress = '0x0EA3c89F9f9A1dCdE0e5966D2e596E5985f8de3b';

const publicClient = createPublicClient({
  chain: botMainnet,
  transport: http('https://rpc.botchain.ai'),
});

// Read .env
const envContent = fs.readFileSync('./.env', 'utf8');
const lines = envContent.split('\n');
const env = {};
for (const line of lines) {
  const match = line.match(/^\s*([\w]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    env[match[1]] = match[2]?.trim();
  }
}

const pk1 = env.WALLET_ADDRESS_1_PK;
const pk2 = env.WALLET_ADDRESS_2_PK;
const pk3 = env.WALLET_ADDRESS_3_PK;

if (!pk1 || !pk2 || !pk3) {
  console.error('Could not find all 3 private keys in .env');
  process.exit(1);
}

const account1 = privateKeyToAccount(pk1);
const account2 = privateKeyToAccount(pk2);
const account3 = privateKeyToAccount(pk3);

console.log('Wallet 1:', account1.address);
console.log('Wallet 2:', account2.address);
console.log('Wallet 3:', account3.address);

const client1 = createWalletClient({ account: account1, chain: botMainnet, transport: http('https://rpc.botchain.ai') });
const client2 = createWalletClient({ account: account2, chain: botMainnet, transport: http('https://rpc.botchain.ai') });
const client3 = createWalletClient({ account: account3, chain: botMainnet, transport: http('https://rpc.botchain.ai') });

const summary = {
  contractAddress,
  chainId: 677,
  network: 'BOT Mainnet',
  wallet1: [],
  wallet2: [],
  wallet3: [],
};

async function getNow() {
  const block = await publicClient.getBlock();
  return Number(block.timestamp);
}

async function execTx(client, fnName, args = [], value = 0n, label = '') {
  console.log(`[${client.account.address}] Calling ${fnName}(${args.map(a => typeof a === 'bigint' ? a.toString() : JSON.stringify(a)).join(', ')}) ${value > 0n ? `val: ${value}` : ''} - ${label}`);
  const hash = await client.writeContract({
    address: contractAddress,
    abi: chronoAbi,
    functionName: fnName,
    args,
    value,
  });
  console.log(`  Tx sent: ${hash}. Waiting for confirmation on BOT Mainnet...`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  Confirmed in block ${receipt.blockNumber}, status: ${receipt.status}`);
  return {
    fnName,
    args: args.map(a => a.toString()),
    value: value.toString(),
    label,
    hash,
    blockNumber: receipt.blockNumber.toString(),
    status: receipt.status,
    explorer: `https://scan.botchain.ai/tx/${hash}`,
  };
}

async function runWalletFlow(client, walletKey, prefix, topics) {
  console.log(`\n========================================`);
  console.log(`Executing 8 Transactions for ${walletKey} (${client.account.address}) on BOT Mainnet`);
  console.log(`========================================`);

  // Tx 1: createLock (Flexible, ~3 mins)
  let now = await getNow();
  let unlock1 = BigInt(now + 200);
  const tx1 = await execTx(
    client,
    'createLock',
    [unlock1, `${prefix}: ${topics[0]}`, true],
    parseEther('0.005'),
    `Tx 1: Create Flexible Lock (3m)`
  );
  summary[walletKey].push(tx1);

  // Read current lock ID
  const lockId1 = await publicClient.readContract({
    address: contractAddress,
    abi: chronoAbi,
    functionName: 'lockCount',
  });
  console.log(`  Created Lock ID: ${lockId1}`);

  // Tx 2: topUp lockId1
  const tx2 = await execTx(
    client,
    'topUp',
    [lockId1],
    parseEther('0.002'),
    `Tx 2: Top Up Lock #${lockId1} (+0.002 BOT)`
  );
  summary[walletKey].push(tx2);

  // Tx 3: extendLock lockId1 forward
  now = await getNow();
  let extendUnlock1 = BigInt(now + 400);
  const tx3 = await execTx(
    client,
    'extendLock',
    [lockId1, extendUnlock1],
    0n,
    `Tx 3: Extend Lock #${lockId1} forward`
  );
  summary[walletKey].push(tx3);

  // Tx 4: createLock (Strict, 1 day)
  now = await getNow();
  let unlock2 = BigInt(now + 86400);
  const tx4 = await execTx(
    client,
    'createLock',
    [unlock2, `${prefix}: ${topics[1]}`, false],
    parseEther('0.005'),
    `Tx 4: Create Strict Lock (24h)`
  );
  summary[walletKey].push(tx4);

  const lockId2 = await publicClient.readContract({
    address: contractAddress,
    abi: chronoAbi,
    functionName: 'lockCount',
  });
  console.log(`  Created Strict Lock ID: ${lockId2}`);

  // Tx 5: topUp lockId2
  const tx5 = await execTx(
    client,
    'topUp',
    [lockId2],
    parseEther('0.002'),
    `Tx 5: Top Up Strict Lock #${lockId2} (+0.002 BOT)`
  );
  summary[walletKey].push(tx5);

  // Tx 6: extendLock lockId2 forward
  now = await getNow();
  let extendUnlock2 = BigInt(now + 172800);
  const tx6 = await execTx(
    client,
    'extendLock',
    [lockId2, extendUnlock2],
    0n,
    `Tx 6: Extend Strict Lock #${lockId2} forward`
  );
  summary[walletKey].push(tx6);

  // Tx 7: createLock (Flexible, 5m for early exit test)
  now = await getNow();
  let unlock3 = BigInt(now + 300);
  const tx7 = await execTx(
    client,
    'createLock',
    [unlock3, `${prefix}: ${topics[2]}`, true],
    parseEther('0.004'),
    `Tx 7: Create Flexible Lock for early exit`
  );
  summary[walletKey].push(tx7);

  const lockId3 = await publicClient.readContract({
    address: contractAddress,
    abi: chronoAbi,
    functionName: 'lockCount',
  });
  console.log(`  Created Flexible Lock ID: ${lockId3}`);

  // Tx 8: exitEarly lockId3
  const tx8 = await execTx(
    client,
    'exitEarly',
    [lockId3],
    0n,
    `Tx 8: Early Exit from Lock #${lockId3} (penalty collected)`
  );
  summary[walletKey].push(tx8);

  console.log(`Completed 8/8 transactions for ${walletKey}!`);
}

async function main() {
  console.log('=== Starting Chrono Instructions Execution on BOT Mainnet (Chain 677) ===');
  console.log('Contract Address:', contractAddress);

  await runWalletFlow(client1, 'wallet1', 'Alpha', [
    'Treasury Reserve Lock',
    'Strict Protocol Vault',
    'Liquid Alpha Cushion'
  ]);

  await runWalletFlow(client2, 'wallet2', 'Beta', [
    'Infrastructure Staking Reserve',
    'HODL Vault Discipline',
    'Validator Buffer Position'
  ]);

  await runWalletFlow(client3, 'wallet3', 'Gamma', [
    'Ecosystem Liquidity Shield',
    'Strict Node Expansion Fund',
    'Short-Term Emergency Buffer'
  ]);

  console.log('\n======================================================');
  console.log('=== All 24 Transactions Executed Successfully on BOT Mainnet! ===');
  console.log('======================================================');

  fs.writeFileSync('chrono_mainnet_transactions_summary.json', JSON.stringify(summary, null, 2));
  console.log('Saved transaction proofs to chrono_mainnet_transactions_summary.json');
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
