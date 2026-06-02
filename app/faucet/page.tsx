'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PageHero from '@/components/PageHero';

const AF_TOKEN_CONTRACT = process.env.NEXT_PUBLIC_AF_TOKEN_CONTRACT_ID || 'CDCW72YVMAE34IQSED3AQ7UHLKOWXLOMN2UQ2J5H4CKY357G2CHMOARL';
const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || 'https://horizon.stellar.org';
const SOROBAN_RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 'https://mainnet.sorobanrpc.com';

const IS_MAINNET = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet';
const NETWORK_PASSPHRASE = IS_MAINNET
  ? 'Public Global Stellar Network ; September 2015'
  : 'Test SDF Network ; September 2015';

const FAUCET_ADMIN_ADDRESS = 'GCK5L4DAV67YSSYKFWRCELY2BDODO5UURWD42QM7HR4ORQWSORMS3JHE';
const FAUCET_AMOUNT = 5000;
const MAX_CLAIMS = 3;
const EXCHANGE_RATE = 100; // 1 XLM = 100 AF$

export default function FaucetPage() {
  const [activeTab, setActiveTab] = useState<'free' | 'swap'>('free');
  const [walletAddress, setWalletAddress] = useState('');
  const [claimsRemaining, setClaimsRemaining] = useState<number | null>(null);
  
  // Free claim state
  const [status, setStatus] = useState<'idle' | 'checking' | 'claiming' | 'success' | 'error'>('idle');
  const [tokenStatus, setTokenStatus] = useState<'idle' | 'adding' | 'added' | 'error'>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [totalClaimed, setTotalClaimed] = useState(0);

  // Swap/Buy state
  const [xlmAmount, setXlmAmount] = useState<string>('5');
  const [swapStatus, setSwapStatus] = useState<'idle' | 'paying' | 'verifying' | 'success' | 'error'>('idle');
  const [swapTxHash, setSwapTxHash] = useState<string | null>(null);
  const [swapErrorMsg, setSwapErrorMsg] = useState('');
  const [afReceived, setAfReceived] = useState<number>(0);

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
    const StellarSdk = await import('@stellar/stellar-sdk');
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

  async function executeXlmToAfSwap() {
    if (!walletAddress.trim()) {
      setSwapErrorMsg('Please enter a valid Stellar wallet address.');
      return;
    }
    const parsedAmount = parseFloat(xlmAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setSwapErrorMsg('Please enter a valid positive XLM amount.');
      return;
    }

    setSwapStatus('paying');
    setSwapErrorMsg('');
    setSwapTxHash(null);

    try {
      const StellarSdk = await import('@stellar/stellar-sdk');
      const freighter = await import('@stellar/freighter-api');

      // 1. Freighter pre-flight
      const connection = await freighter.isConnected();
      if (!connection.isConnected) {
        throw new Error('Freighter wallet not detected.');
      }
      await freighter.requestAccess();
      const { address: connectedAddress } = await freighter.getAddress();
      if (!connectedAddress) {
        throw new Error('Could not fetch connected Freighter address.');
      }
      if (walletAddress.trim() !== connectedAddress) {
        throw new Error('Form address does not match your connected Freighter wallet.');
      }

      // 2. Build the XLM payment transaction
      const horizonServer = new StellarSdk.Horizon.Server(HORIZON_URL);
      const account = await horizonServer.loadAccount(connectedAddress);

      const paymentTx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: FAUCET_ADMIN_ADDRESS,
            asset: StellarSdk.Asset.native(),
            amount: parsedAmount.toFixed(7),
          })
        )
        .addMemo(StellarSdk.Memo.text(`af-swap:${connectedAddress.slice(0, 10)}`))
        .setTimeout(120)
        .build();

      // 3. Sign and submit
      const signedResult = await freighter.signTransaction(paymentTx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });
      if (signedResult.error) {
        throw new Error(String(signedResult.error));
      }

      const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedResult.signedTxXdr, NETWORK_PASSPHRASE);
      const submitResult = await horizonServer.submitTransaction(signedTx);
      const payTxHash = submitResult.hash;

      setSwapStatus('verifying');

      // 4. Verify payment & claim AF$ tokens via API
      const response = await fetch('/api/faucet/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: connectedAddress,
          txHash: payTxHash,
        }),
      });

      const data = await response.json() as { success: boolean; afEarned?: number; txHash?: string; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Backend verification failed.');
      }

      setAfReceived(data.afEarned || (parsedAmount * EXCHANGE_RATE));
      setSwapTxHash(data.txHash || null);
      setSwapStatus('success');
      
      // Auto-trigger add token
      await addTokenToFreighter();

    } catch (err) {
      setSwapErrorMsg(err instanceof Error ? err.message : 'Swap failed');
      setSwapStatus('error');
    }
  }

  async function addTokenToFreighter() {
    if (!AF_TOKEN_CONTRACT) {
      setTokenStatus('error');
      setErrorMsg('AF$ contract is not configured in this environment.');
      return;
    }

    setTokenStatus('adding');
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
          { label: 'Per Free Claim', value: `${FAUCET_AMOUNT} AF$` },
          { label: 'Swap Rate', value: `1 XLM = ${EXCHANGE_RATE} AF$` },
          { label: 'Supply', value: '100M AF$' },
        ]}
      />

      <div className="page-shell max-w-xl">
        {/* Tab selection */}
        <div className="flex bg-white/[0.02] border border-white/[0.06] rounded-xl p-1 mb-6">
          <button
            onClick={() => {
              setActiveTab('free');
              setStatus('idle');
              setTxHash(null);
            }}
            className={`flex-1 py-3 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'free'
                ? 'bg-gradient-to-r from-[#00FFE5]/20 to-[#00FFE5]/5 border border-[#00FFE5]/30 text-[#00FFE5]'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            🎁 Free Faucet Claim
          </button>
          <button
            onClick={() => {
              setActiveTab('swap');
              setSwapStatus('idle');
              setSwapTxHash(null);
            }}
            className={`flex-1 py-3 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'swap'
                ? 'bg-gradient-to-r from-[#FFB800]/20 to-[#FFB800]/5 border border-[#FFB800]/30 text-[#FFB800]'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            ⚡ XLM to AF$ Swap
          </button>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className={`page-panel p-8 border ${
            activeTab === 'swap' ? 'border-[rgba(255,184,0,0.2)]' : 'border-[rgba(0,255,229,0.2)]'
          }`}
        >
          {/* Global Address Field */}
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
                setSwapStatus('idle');
                setTokenStatus('idle');
                setTxHash(null);
                setSwapTxHash(null);
              }}
              onBlur={checkClaims}
              placeholder="G... (56 character Stellar address)"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-4 py-3 text-white placeholder-white/30 font-mono text-sm focus:outline-none focus:border-[#00FFE5]/50 transition-colors"
            />
          </div>

          <AnimatePresence mode="wait">
            {activeTab === 'free' ? (
              <motion.div
                key="free-tab"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                {/* Claims remaining info */}
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

                {/* Success message */}
                {status === 'success' && txHash && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6 p-4 rounded-xl bg-[rgba(74,222,128,0.08)] border border-[rgba(74,222,128,0.2)]"
                  >
                    <p className="text-[#4ade80] font-semibold mb-2">🎉 {FAUCET_AMOUNT} AF$ sent to your wallet!</p>
                    <a
                      href={`https://stellar.expert/explorer/${IS_MAINNET ? 'public' : 'testnet'}/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#00FFE5] underline font-mono break-all hover:text-[#00FFE5]/80"
                    >
                      {txHash}
                    </a>
                  </motion.div>
                )}

                {/* Error */}
                {status === 'error' && errorMsg && (
                  <div className="mt-4 p-4 rounded-xl bg-[rgba(248,113,113,0.08)] border border-[rgba(248,113,113,0.2)]">
                    <p className="text-red-400 text-sm">{errorMsg}</p>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="swap-tab"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                {/* Swap amount inputs */}
                <div className="mb-6 space-y-4">
                  <div>
                    <label className="block text-xs font-mono text-gray-500 mb-1.5">You Spend (XLM)</label>
                    <input
                      type="number"
                      value={xlmAmount}
                      onChange={(e) => {
                        setXlmAmount(e.target.value);
                        setSwapStatus('idle');
                        setSwapTxHash(null);
                      }}
                      placeholder="Amount of XLM"
                      className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-[#FFB800]/50 transition-colors"
                    />
                  </div>
                  <div className="p-3 rounded bg-white/[0.02] border border-white/[0.06] flex justify-between items-center text-sm">
                    <span className="text-gray-500">You Receive</span>
                    <span className="text-[#FFB800] font-bold font-mono">
                      {parseFloat(xlmAmount) > 0 ? (parseFloat(xlmAmount) * EXCHANGE_RATE).toLocaleString() : '0'} AF$
                    </span>
                  </div>
                </div>

                {/* Swap Button */}
                <button
                  onClick={executeXlmToAfSwap}
                  disabled={
                    swapStatus === 'paying' ||
                    swapStatus === 'verifying' ||
                    swapStatus === 'success' ||
                    !walletAddress.trim() ||
                    parseFloat(xlmAmount) <= 0
                  }
                  className="w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-[#FFB800] text-black hover:bg-[#FFB800]/90 active:scale-95"
                >
                  {swapStatus === 'paying'
                    ? 'Confirming XLM Payment...'
                    : swapStatus === 'verifying'
                    ? 'Verifying & Minting AF$...'
                    : swapStatus === 'success'
                    ? '✅ Swap Complete!'
                    : `Swap & Earn ${parseFloat(xlmAmount) > 0 ? (parseFloat(xlmAmount) * EXCHANGE_RATE).toLocaleString() : '0'} AF$`}
                </button>

                {/* Swap Success Box */}
                {swapStatus === 'success' && swapTxHash && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6 p-4 rounded-xl bg-[rgba(74,222,128,0.08)] border border-[rgba(74,222,128,0.2)]"
                  >
                    <p className="text-[#4ade80] font-semibold mb-2">🎉 {afReceived.toLocaleString()} AF$ swapped successfully!</p>
                    <p className="text-xs text-white/50 mb-3">
                      Your mainnet AF$ tokens have been transferred from the faucet.
                    </p>
                    <a
                      href={`https://stellar.expert/explorer/${IS_MAINNET ? 'public' : 'testnet'}/tx/${swapTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#FFB800] underline font-mono break-all hover:text-[#FFB800]/80"
                    >
                      {swapTxHash}
                    </a>
                  </motion.div>
                )}

                {/* Swap Error */}
                {swapStatus === 'error' && swapErrorMsg && (
                  <div className="mt-4 p-4 rounded-xl bg-[rgba(248,113,113,0.08)] border border-[rgba(248,113,113,0.2)]">
                    <p className="text-red-400 text-sm">{swapErrorMsg}</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Add Token utility built-in */}
          {walletAddress.trim() && (status === 'success' || swapStatus === 'success') && (
            <div className="mt-6 border-t border-white/[0.06] pt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

        {/* Footer Info */}
        <div className="mt-8 text-center text-white/40 text-sm space-y-1">
          <p>AF$ tokens are for AgentForge execution, runs, and customized forks.</p>
          <p>Spend them or pay with XLM directly across the marketplace.</p>
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
