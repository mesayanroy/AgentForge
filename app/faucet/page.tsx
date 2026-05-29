'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import PageHero from '@/components/PageHero';

const AF_TOKEN_CONTRACT = process.env.NEXT_PUBLIC_AF_TOKEN_CONTRACT_ID || '';
const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const SOROBAN_RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
    ? 'Public Global Stellar Network ; September 2015'
    : 'Test SDF Network ; September 2015';
const FAUCET_AMOUNT = 5000;
const MAX_CLAIMS = 3;

export default function FaucetPage() {
  const [walletAddress, setWalletAddress] = useState('');
  const [claimsRemaining, setClaimsRemaining] = useState<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'checking' | 'claiming' | 'success' | 'error'>('idle');
  const [tokenStatus, setTokenStatus] = useState<'idle' | 'adding' | 'added' | 'error'>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [totalClaimed, setTotalClaimed] = useState(0);

  async function checkClaims() {
    if (!walletAddress.trim() || walletAddress.length < 56) return;
    setStatus('checking');
    setErrorMsg('');
    try {
      const res = await fetch(`/api/faucet/claims?wallet=${encodeURIComponent(walletAddress.trim())}`);
      const data = await res.json() as { claimsRemaining: number; totalClaimed: number; error?: string };
      if (data.error) throw new Error(data.error);
      setClaimsRemaining(data.claimsRemaining);
      setTotalClaimed(data.totalClaimed || 0);
      setStatus('idle');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to check claims');
      setStatus('error');
    }
  }

  async function claimTokens() {
    if (!walletAddress.trim()) return;
    setStatus('claiming');
    setTokenStatus('idle');
    setErrorMsg('');

    if (AF_TOKEN_CONTRACT) {
      try {
        const txHash = await claimAfTokensWithFreighter();
        setTxHash(txHash);
        setClaimsRemaining(null);
        setStatus('success');
        await addTokenToFreighter();
        return;
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'AF$ claim failed');
        setStatus('error');
        return;
      }
    }

    try {
      const res = await fetch('/api/faucet/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: walletAddress.trim() }),
      });
      const data = await res.json() as { txHash?: string; claimsRemaining?: number; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || 'Claim failed');
      setTxHash(data.txHash || null);
      setClaimsRemaining(data.claimsRemaining ?? null);
      setStatus('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Claim failed');
      setStatus('error');
    }
  }

  async function claimAfTokensWithFreighter(): Promise<string> {
    const StellarSdk = await import('stellar-sdk');
    const freighter = await import('@stellar/freighter-api');

    const connection = await freighter.isConnected();
    if (!connection.isConnected) {
      throw new Error('Freighter is not installed or not connected.');
    }

    const accessResult = await freighter.requestAccess();
    if (accessResult && 'error' in accessResult && accessResult.error) {
      throw new Error('Freighter access was denied.');
    }

    const { address: connectedAddress, error: addressError } = await freighter.getAddress();
    if (addressError || !connectedAddress) {
      throw new Error('Could not read the connected Freighter wallet address.');
    }

    const recipient = walletAddress.trim();
    if (recipient !== connectedAddress) {
      throw new Error('Connect Freighter with the same wallet address shown in the form before claiming AF$.');
    }

    const horizonServer = new StellarSdk.Horizon.Server(HORIZON_URL);
    const rpcServer = new StellarSdk.rpc.Server(SOROBAN_RPC_URL, { allowHttp: true });
    const account = await horizonServer.loadAccount(recipient);

    const claimTx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        StellarSdk.Operation.invokeContractFunction({
          contract: AF_TOKEN_CONTRACT,
          function: 'faucet_claim',
          args: [new StellarSdk.Address(recipient).toScVal()],
        })
      )
      .setTimeout(180)
      .build();

    const prepared = await rpcServer.prepareTransaction(claimTx);
    const signedResult = await freighter.signTransaction(prepared.toXDR(), {
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    if (signedResult.error) {
      throw new Error(String(signedResult.error));
    }

    const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedResult.signedTxXdr, NETWORK_PASSPHRASE);
    const sendResult = await rpcServer.sendTransaction(signedTx);
    if (!sendResult.hash) {
      throw new Error('AF$ claim transaction was submitted but no hash was returned.');
    }

    return sendResult.hash;
  }

  async function addTokenToFreighter() {
    if (!AF_TOKEN_CONTRACT) {
      setTokenStatus('error');
      setErrorMsg('AF$ contract is not configured in this environment.');
      return;
    }

    setTokenStatus('adding');
    setErrorMsg('');

    try {
      const freighter = await import('@stellar/freighter-api');
      const connection = await freighter.isConnected();
      if (!connection.isConnected) {
        throw new Error('Freighter is not installed or not connected.');
      }

      await freighter.requestAccess();
      const { contractId, error } = await freighter.addToken({ contractId: AF_TOKEN_CONTRACT });

      if (error || !contractId) {
        throw new Error((error as { message?: string } | null)?.message || 'Freighter could not add the AF$ token.');
      }

      setTokenStatus('added');
    } catch (err) {
      setTokenStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to add AF$ token to Freighter');
    }
  }

  return (
    <main className="page-theme min-h-screen text-white py-20 px-4">
      <PageHero
        eyebrow="Faucet"
        title={<>Claim AF$ tokens for testing and deployment.</>}
        description={<>Use the faucet to fund trading, staking, and agent trials on the platform. Claims are limited and tied to your Stellar wallet.</>}
        actions={[
          { href: '/build', label: 'Build an Agent' },
          { href: '/dashboard', label: 'Open Dashboard', variant: 'secondary' },
        ]}
        stats={[
          { label: 'Per Claim', value: `${FAUCET_AMOUNT} AF$` },
          { label: 'Max Claims', value: `${MAX_CLAIMS}×` },
          { label: 'Supply', value: '100M AF$' },
        ]}
      />

      <div className="page-shell max-w-xl">
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="page-panel p-8">
          <div className="mb-6">
            <label className="block text-sm font-medium text-white/70 mb-2">
              Stellar Wallet Address
            </label>
            <input
              type="text"
              value={walletAddress}
              onChange={(e) => {
                setWalletAddress(e.target.value);
                setClaimsRemaining(null);
                setStatus('idle');
                setTokenStatus('idle');
                setTxHash(null);
              }}
              onBlur={checkClaims}
              placeholder="G... (56 character Stellar address)"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-4 py-3 text-white placeholder-white/30 font-mono text-sm focus:outline-none focus:border-[#00FFE5]/50 transition-colors"
            />
          </div>

          {/* Claims remaining */}
          {claimsRemaining !== null && status !== 'error' && (
            <div className="mb-6 flex items-center gap-2 text-sm">
              <span className="text-white/60">Claims remaining:</span>
              <span className={`font-bold ${claimsRemaining > 0 ? 'text-[#00FFE5]' : 'text-red-400'}`}>
                {claimsRemaining} / {MAX_CLAIMS}
              </span>
              {totalClaimed > 0 && (
                <span className="text-white/40">
                  · Already received {totalClaimed * FAUCET_AMOUNT} AF$
                </span>
              )}
            </div>
          )}

          {/* Action button */}
          <button
            onClick={status === 'idle' || status === 'error' ? claimTokens : undefined}
            disabled={
              status === 'claiming' ||
              status === 'checking' ||
              status === 'success' ||
              !walletAddress.trim() ||
              claimsRemaining === 0
            }
            className="w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-[#00FFE5] text-black hover:bg-[#00FFE5]/90 active:scale-95"
          >
            {status === 'claiming'
              ? 'Claiming...'
              : status === 'checking'
              ? 'Checking...'
              : status === 'success'
              ? '✅ Claimed Successfully!'
              : claimsRemaining === 0
              ? 'Limit Reached'
              : `Claim ${FAUCET_AMOUNT} AF$`}
          </button>

          {/* Success */}
          {status === 'success' && txHash && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 p-4 rounded-xl bg-[rgba(74,222,128,0.08)] border border-[rgba(74,222,128,0.2)]"
            >
              <p className="text-[#4ade80] font-semibold mb-2">🎉 {FAUCET_AMOUNT} AF$ sent to your wallet!</p>
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#00FFE5] underline font-mono break-all"
              >
                {txHash}
              </a>
              {AF_TOKEN_CONTRACT && (
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-white/50">
                    If AF$ does not appear in Freighter yet, add the contract token below.
                  </p>
                  <button
                    type="button"
                    onClick={addTokenToFreighter}
                    disabled={tokenStatus === 'adding' || tokenStatus === 'added'}
                    className="rounded-lg border border-[rgba(0,255,229,0.2)] bg-[rgba(0,255,229,0.08)] px-3 py-2 text-xs font-semibold text-[#00FFE5] transition-colors hover:bg-[rgba(0,255,229,0.12)] disabled:opacity-60"
                  >
                    {tokenStatus === 'adding'
                      ? 'Adding AF$ to Freighter...'
                      : tokenStatus === 'added'
                      ? 'AF$ Added to Freighter'
                      : 'Add AF$ to Freighter'}
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {/* Error */}
          {status === 'error' && errorMsg && (
            <div className="mt-4 p-4 rounded-xl bg-[rgba(248,113,113,0.08)] border border-[rgba(248,113,113,0.2)]">
              <p className="text-red-400 text-sm">{errorMsg}</p>
            </div>
          )}
        </motion.div>

        {/* Info */}
        <div className="mt-8 text-center text-white/40 text-sm space-y-1">
          <p>AF$ tokens are for testnet use only.</p>
          <p>Use them to run agents, trade on the playground, and test the 0x402 payment protocol.</p>
          {AF_TOKEN_CONTRACT && (
            <p className="font-mono text-xs mt-2">
              AF$ contract: <span className="text-white/60">{AF_TOKEN_CONTRACT.slice(0, 16)}...{AF_TOKEN_CONTRACT.slice(-8)}</span>
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
