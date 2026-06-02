const { rpc, TransactionBuilder, Horizon, Networks, Operation, Address, Keypair, nativeToScVal } = require('@stellar/stellar-sdk');
const fs = require('fs');
const path = require('path');

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
const afTokenId = 'CDCW72YVMAE34IQSED3AQ7UHLKOWXLOMN2UQ2J5H4CKY357G2CHMOARL';
const sorobanRpcUrl = 'https://mainnet.sorobanrpc.com';
const horizonUrl = 'https://horizon.stellar.org';

async function main() {
  if (!secretKey) {
    console.error('STELLAR_AGENT_SECRET not set');
    process.exit(1);
  }
  const keypair = Keypair.fromSecret(secretKey);
  const userAddress = keypair.publicKey();
  const payeeAddress = 'GARN7A6OJKPR3HAPVIKM6GRUD7KMEHYQ76VJJCO4AAKQ6ETEKFQPQ24T';
  const amountStroops = 100000; // 0.01 AF$

  console.log('User Wallet:', userAddress);
  console.log('Token Contract:', afTokenId);

  const server = new Horizon.Server(horizonUrl);
  const rpcServer = new rpc.Server(sorobanRpcUrl);

  const account = await server.loadAccount(userAddress);

  const args = [
    new Address(userAddress).toScVal(),
    new Address(payeeAddress).toScVal(),
    nativeToScVal(BigInt(amountStroops), { type: 'i128' }),
  ];

  const tx = new TransactionBuilder(account, {
    fee: '500000', // priority fee
    networkPassphrase: Networks.PUBLIC,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: afTokenId,
        function: 'transfer',
        args,
      })
    )
    .setTimeout(60)
    .build();

  console.log('Preparing transaction...');
  const preparedTx = await rpcServer.prepareTransaction(tx);
  console.log('Signing...');
  preparedTx.sign(keypair);

  console.log('Submitting to Soroban RPC...');
  const sendResponse = await rpcServer.sendTransaction(preparedTx);
  console.log('Send response status:', sendResponse.status);
  console.log('Tx Hash:', sendResponse.hash);

  if (sendResponse.status === 'ERROR') {
    console.error('RPC Error:', sendResponse.errorResult);
    process.exit(1);
  }

  let status = sendResponse.status;
  const hash = sendResponse.hash;
  const deadline = Date.now() + 60_000;
  while ((status === 'PENDING' || status === 'NOT_FOUND') && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    console.log('Polling status...');
    const txRes = await rpcServer.getTransaction(hash);
    status = txRes.status;
    console.log('Status is:', status);
    if (status === 'SUCCESS') {
      console.log('Live transfer SUCCESS! Hash:', hash);
      return;
    }
    if (status === 'FAILED') {
      console.error('Transaction FAILED:', txRes);
      process.exit(1);
    }
  }
}

main().catch(console.error);
