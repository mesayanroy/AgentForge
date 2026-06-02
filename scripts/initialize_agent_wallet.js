const fs = require('fs');
const path = require('path');
const {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Horizon,
  rpc,
  Address,
} = require('@stellar/stellar-sdk');

function loadEnvFile(filePath = path.join(process.cwd(), '.env.local')) {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (key && (process.env[key] === undefined || process.env[key] === '')) {
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.error('Env load err:', err);
  }
}

loadEnvFile();

const secretKey = process.env.STELLAR_AGENT_SECRET;
const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'mainnet';
const passphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
const sorobanRpcUrl = network === 'mainnet' ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org';
const horizonUrl = network === 'mainnet' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org';

const keypair = Keypair.fromSecret(secretKey);
const publicKey = keypair.publicKey();

const server = new Horizon.Server(horizonUrl);
const rpcServer = new rpc.Server(sorobanRpcUrl);

// Deployed contract ID from task-2127
const contractId = 'CBEDEV6LHEXBZRP37H46HYXXWOYXSQVAUY6KG66SIYYUKFMEZCV3MEXF';

async function main() {
  console.log('Loading account:', publicKey);
  const account = await server.loadAccount(publicKey);
  
  console.log('Building transaction to initialize contract:', contractId);
  const op = Operation.invokeContractFunction({
    contract: contractId,
    function: 'initialize',
    args: [new Address(publicKey).toScVal()],
  });

  const tx = new TransactionBuilder(account, {
    fee: '500000', // mainnet priority fee
    networkPassphrase: passphrase,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();

  console.log('Simulating transaction...');
  const preparedTx = await rpcServer.prepareTransaction(tx);
  
  console.log('Signing transaction...');
  preparedTx.sign(keypair);
  
  console.log('Submitting to network...');
  const sendRes = await rpcServer.sendTransaction(preparedTx);
  if (sendRes.status === 'ERROR') {
    throw new Error(`Send failed: ${JSON.stringify(sendRes)}`);
  }
  
  const hash = sendRes.hash;
  console.log('Transaction hash:', hash);
  console.log('Polling for transaction status...');
  
  let status = sendRes.status;
  const deadline = Date.now() + 60_000;
  while ((status === 'PENDING' || status === 'NOT_FOUND') && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const txRes = await rpcServer.getTransaction(hash);
    status = txRes.status;
    if (status === 'SUCCESS') {
      console.log('SUCCESS: Agent Wallet Contract Initialized!');
      return;
    }
    if (status === 'FAILED') {
      throw new Error(`Transaction failed: ${JSON.stringify(txRes)}`);
    }
  }
  
  throw new Error(`Timeout: transaction status is ${status}`);
}

main().catch(console.error);
