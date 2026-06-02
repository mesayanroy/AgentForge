const fs = require('fs');
const path = require('path');
const {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Horizon,
  rpc,
  xdr,
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

const keypair = Keypair.fromSecret(secretKey);
const publicKey = keypair.publicKey();

const horizonUrl = network === 'mainnet' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(horizonUrl);
const rpcServer = new rpc.Server(sorobanRpcUrl);

async function main() {
  const account = await server.loadAccount(publicKey);
  const nativeBal = account.balances.find(b => b.asset_type === 'native');
  console.log('Deployer Wallet:', publicKey);
  console.log('Native balance:', nativeBal ? nativeBal.balance : 'none');

  const wasmPath = path.join(process.cwd(), 'contracts/target/wasm32-unknown-unknown/release/agent_wallet.stripped.wasm');
  const wasmBytes = fs.readFileSync(wasmPath);

  const hostFunction = xdr.HostFunction.hostFunctionTypeUploadContractWasm(wasmBytes);
  const opInstall = Operation.invokeHostFunction({
    func: hostFunction,
    auth: [],
  });

  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: passphrase,
  })
    .addOperation(opInstall)
    .setTimeout(60)
    .build();

  console.log('Simulating WASM install transaction...');
  const simRes = await rpcServer.simulateTransaction(tx);
  console.log('Simulation Success:', rpc.Api.isSimulationSuccess(simRes));
  
  if (rpc.Api.isSimulationSuccess(simRes)) {
    console.log('minResourceFee (stroops):', simRes.minResourceFee);
    const data = simRes.transactionData.build();
    console.log('resourceFee (stroops):', data.resources().fee().toString());
    const xlmCost = Number(data.resources().fee().toString()) / 10_000_000;
    console.log('Total simulated cost in XLM:', xlmCost);
  } else {
    console.log('Simulation error details:', simRes.error);
  }
}

main().catch(console.error);
