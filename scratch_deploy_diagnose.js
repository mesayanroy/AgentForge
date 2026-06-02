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
} = require('stellar-sdk');

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

console.log('Network:', network);
console.log('Passphrase:', passphrase);
console.log('RPC URL:', sorobanRpcUrl);

if (!secretKey) {
  console.error('STELLAR_AGENT_SECRET is not defined!');
  process.exit(1);
}

const keypair = Keypair.fromSecret(secretKey);
const publicKey = keypair.publicKey();
console.log('Deployer Public Key:', publicKey);

const horizonUrl = network === 'mainnet' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(horizonUrl);
const rpcServer = new rpc.Server(sorobanRpcUrl);

async function main() {
  const account = await server.loadAccount(publicKey);
  const nativeBal = account.balances.find(b => b.asset_type === 'native');
  console.log('Native balance:', nativeBal ? nativeBal.balance : 'none');

  const wasmPath = path.join(process.cwd(), 'contracts/target/wasm32-unknown-unknown/release/agent_wallet.optimized.wasm');
  if (!fs.existsSync(wasmPath)) {
    console.error('WASM file not found at:', wasmPath);
    process.exit(1);
  }
  const wasmBytes = fs.readFileSync(wasmPath);
  console.log('WASM bytes size:', wasmBytes.length);

  // Operation to upload WASM (Install contract code)
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
  try {
    const simRes = await rpcServer.simulateTransaction(tx);
    console.log('Simulation response status:', rpc.Api.isSimulationSuccess(simRes) ? 'SUCCESS' : 'FAILED');
    if (!rpc.Api.isSimulationSuccess(simRes)) {
      console.error(JSON.stringify(simRes, null, 2));
      process.exit(1);
    }
    
    console.log('Simulated resource fee (stroops):', simRes.minResourceFee);
    const totalFee = BigInt(simRes.minResourceFee) + 100n; // resource fee + base inclusion fee
    console.log('Total transaction cost in stroops:', totalFee.toString());
    const xlmCost = Number(totalFee) / 10_000_000;
    console.log('Total transaction cost in XLM:', xlmCost);
    
    // Check if the simulation output has storage changes or rent fee
    console.log('Full simulation result:', JSON.stringify(simRes, null, 2));
  } catch (err) {
    console.error('Simulation failed with error:', err);
  }
}

main().catch(console.error);
