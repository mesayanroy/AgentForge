import { NextRequest, NextResponse } from 'next/server';
import { Keypair, Networks, Asset, Memo, TransactionBuilder, Operation, Horizon } from '@stellar/stellar-sdk';
import Ably from 'ably';

const FAUCET_MAX_CLAIMS = 3;
const FAUCET_AMOUNT_XLM = 5; // 5 XLM placeholder until AF$ token is on-chain (see contracts/af_token)
const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;

async function pushFaucetActivity(wallet: string, amount: number): Promise<void> {
  const key = process.env.ABLY_API_KEY;
  if (!key) return;
  try {
    const ably = new Ably.Rest({ key });
    await ably.channels.get('marketplace').publish('new_agent', {
      eventType: 'new_agent',
      agentId: 'faucet',
      agentName: 'AF$ Faucet',
      ownerWallet: wallet,
      callerWallet: wallet,
      priceXlm: amount,
      timestamp: new Date().toISOString(),
    });
  } catch { /* ignore */ }
}

function isValidStellarAddress(address: string): boolean {
  try {
    Keypair.fromPublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function isValidStellarSecret(secret: string): boolean {
  try {
    Keypair.fromSecret(secret);
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { walletAddress?: string };
  const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress.trim() : '';

  if (!walletAddress || !isValidStellarAddress(walletAddress)) {
    return NextResponse.json({ error: 'Invalid Stellar wallet address. Connect Freighter and use a public key that starts with G.' }, { status: 400 });
  }

  const faucetSecret = process.env.STELLAR_AGENT_SECRET;
  if (!faucetSecret || !isValidStellarSecret(faucetSecret)) {
    return NextResponse.json({ error: 'Faucet not configured. Set a valid STELLAR_AGENT_SECRET on testnet.' }, { status: 503 });
  }

  // Check & update claims in Supabase
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let currentClaims = 0;

  if (supabaseUrl && supabaseKey) {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data } = await supabase
      .from('faucet_claims')
      .select('claims_count')
      .eq('wallet_address', walletAddress)
      .single();

    currentClaims = data?.claims_count ?? 0;
    if (currentClaims >= FAUCET_MAX_CLAIMS) {
      return NextResponse.json({ error: 'Faucet claim limit reached (max 3 claims per wallet)' }, { status: 429 });
    }
  }

  // Send XLM via Stellar
  try {
    const keypair = Keypair.fromSecret(faucetSecret);
    const server = new Horizon.Server(HORIZON_URL);
    const account = await server.loadAccount(keypair.publicKey());

    const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(Operation.payment({
        destination: walletAddress,
        asset: Asset.native(),
        amount: FAUCET_AMOUNT_XLM.toFixed(7),
      }))
      .addMemo(Memo.text('AF$ Faucet Claim'))
      .setTimeout(30)
      .build();

    tx.sign(keypair);
    const result = await server.submitTransaction(tx);
    const txHash = result.hash;

    // Update claims in Supabase
    if (supabaseUrl && supabaseKey) {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(supabaseUrl, supabaseKey);
      await supabase.from('faucet_claims').upsert({
        wallet_address: walletAddress,
        claims_count: currentClaims + 1,
        last_claim_at: new Date().toISOString(),
        total_received_xlm: (currentClaims + 1) * FAUCET_AMOUNT_XLM,
      }, { onConflict: 'wallet_address' });
    }

    await pushFaucetActivity(walletAddress, FAUCET_AMOUNT_XLM);

    return NextResponse.json({
      txHash,
      claimsRemaining: Math.max(0, FAUCET_MAX_CLAIMS - (currentClaims + 1)),
      amountXlm: FAUCET_AMOUNT_XLM,
      tokenContractId: process.env.NEXT_PUBLIC_AF_TOKEN_CONTRACT_ID || '',
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txHash}`,
    });
  } catch (err) {
    console.error('[faucet/claim] Error:', err);
    return NextResponse.json({ error: `Faucet transaction failed: ${String(err)}` }, { status: 500 });
  }
}
