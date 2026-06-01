import { NextRequest, NextResponse } from 'next/server';
import * as StellarSdk from 'stellar-sdk';

const AF_TOKEN_CONTRACT = process.env.NEXT_PUBLIC_AF_TOKEN_CONTRACT_ID || 'CDCW72YVMAE34IQSED3AQ7UHLKOWXLOMN2UQ2J5H4CKY357G2CHMOARL';
const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || 'https://horizon.stellar.org';
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 'https://mainnet.sorobanrpc.com';

const IS_MAINNET = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet';
const NETWORK_PASSPHRASE = IS_MAINNET ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET;

const EXCHANGE_RATE = 100; // 1 XLM = 100 AF$

function isValidStellarAddress(address: string): boolean {
  try {
    StellarSdk.Keypair.fromPublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { walletAddress?: string; txHash?: string };
    const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress.trim() : '';
    const txHash = typeof body.txHash === 'string' ? body.txHash.trim() : '';

    if (!walletAddress || !isValidStellarAddress(walletAddress)) {
      return NextResponse.json({ error: 'Invalid recipient wallet address.' }, { status: 400 });
    }
    if (!txHash || txHash.length !== 64) {
      return NextResponse.json({ error: 'Invalid Stellar transaction hash.' }, { status: 400 });
    }

    const faucetSecret = process.env.STELLAR_AGENT_SECRET;
    if (!faucetSecret) {
      return NextResponse.json({ error: 'Faucet not configured. STELLAR_AGENT_SECRET is missing.' }, { status: 503 });
    }

    const faucetKeypair = StellarSdk.Keypair.fromSecret(faucetSecret);
    const faucetAdminAddress = faucetKeypair.publicKey();

    // 1. Fetch and verify the XLM payment from Horizon
    const horizonServer = new StellarSdk.Horizon.Server(HORIZON_URL);
    let tx: StellarSdk.Horizon.ServerApi.TransactionRecord;
    
    try {
      tx = await horizonServer.transactions().transaction(txHash).call();
    } catch (err) {
      return NextResponse.json({ error: `Transaction ${txHash.slice(0, 10)}... not found on network. Please wait a few seconds and try again.` }, { status: 404 });
    }

    // Load transaction operations to calculate total paid XLM
    const ops = await horizonServer.operations().forTransaction(txHash).call();
    let totalPaidXlm = 0;

    for (const op of ops.records) {
      if (
        op.type === 'payment' &&
        (op as StellarSdk.Horizon.ServerApi.PaymentOperationRecord).asset_type === 'native' &&
        (op as StellarSdk.Horizon.ServerApi.PaymentOperationRecord).to === faucetAdminAddress
      ) {
        totalPaidXlm += parseFloat((op as StellarSdk.Horizon.ServerApi.PaymentOperationRecord).amount);
      }
    }

    if (totalPaidXlm <= 0) {
      return NextResponse.json({ 
        error: `No XLM payment operation to the faucet admin (${faucetAdminAddress.slice(0, 8)}...${faucetAdminAddress.slice(-6)}) was found in this transaction.` 
      }, { status: 400 });
    }

    // 2. Calculate AF$ tokens earned
    const afEarned = totalPaidXlm * EXCHANGE_RATE;
    const amountInStroops = BigInt(Math.round(afEarned * 10_000_000)); // 7 decimals

    // 3. Build & submit the Soroban transfer from admin wallet to user
    const rpcServer = new StellarSdk.rpc.Server(SOROBAN_RPC_URL, { allowHttp: true });
    
    // Load admin account sequence number
    let adminAccount: StellarSdk.Horizon.AccountResponse;
    try {
      adminAccount = await horizonServer.loadAccount(faucetAdminAddress);
    } catch (err) {
      return NextResponse.json({ error: `Failed to load faucet admin account: ${String(err)}` }, { status: 500 });
    }

    const transferOp = StellarSdk.Operation.invokeContractFunction({
      contract: AF_TOKEN_CONTRACT,
      function: 'transfer',
      args: [
        new StellarSdk.Address(faucetAdminAddress).toScVal(),
        new StellarSdk.Address(walletAddress).toScVal(),
        StellarSdk.nativeToScVal(amountInStroops, { type: 'i128' }),
      ],
    });

    const transferTx = new StellarSdk.TransactionBuilder(adminAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(transferOp)
      .setTimeout(180)
      .build();

    // Prepare transaction on Soroban (simulates & sets fees automatically)
    const preparedTx = await rpcServer.prepareTransaction(transferTx);
    preparedTx.sign(faucetKeypair);

    const sendResult = await rpcServer.sendTransaction(preparedTx);
    if (!sendResult.hash) {
      throw new Error('Soroban transfer transaction submitted but no transaction hash returned.');
    }

    // Check transaction status and poll until completed/failed
    let status: any = sendResult.status;
    let txResult;
    let attempts = 0;
    
    while (status === 'PENDING' && attempts < 10) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      txResult = await rpcServer.getTransaction(sendResult.hash);
      status = txResult.status;
      attempts++;
    }

    if (status !== 'SUCCESS') {
      return NextResponse.json({ 
        error: `Soroban contract execution failed with status: ${status}. Make sure the admin wallet has enough AF$ tokens.`,
        hash: sendResult.hash
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      xlmPaid: totalPaidXlm,
      afEarned,
      txHash: sendResult.hash,
      explorerUrl: `https://stellar.expert/explorer/${IS_MAINNET ? 'public' : 'testnet'}/tx/${sendResult.hash}`
    });

  } catch (err) {
    console.error('[faucet/buy] Swap error:', err);
    return NextResponse.json({ error: `Failed to complete XLM to AF$ swap: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
