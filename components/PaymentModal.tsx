'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
  agentName: string;
  priceXlm: number;
  ownerAddress: string;
  paymentMemo: string;
  onPaymentSuccess: (txHash: string, signerWallet: string) => void;
}

type PaymentStep = 'idle' | 'checking_wallet' | 'building_tx' | 'signing' | 'submitting' | 'confirming' | 'done' | 'error';

const STEP_LABELS: Record<PaymentStep, string> = {
  idle: 'Sign & Pay',
  checking_wallet: 'Checking wallet...',
  building_tx: 'Building transaction...',
  signing: 'Sign in Freighter...',
  submitting: 'Submitting to Stellar...',
  confirming: 'Confirming on ledger...',
  done: 'Done!',
  error: 'Retry',
};

/** Extract the most useful human-readable message from a Stellar SDK error. */
function extractStellarError(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>;
    try {
      const resultCodes = (
        (e.response as Record<string, unknown>)?.data as Record<string, unknown>
      )?.extras as Record<string, unknown>;
      if (resultCodes?.result_codes) {
        const rc = resultCodes.result_codes as Record<string, unknown>;
        return `Transaction failed: ${rc.transaction || ''} ops: ${JSON.stringify(rc.operations || [])}`;
      }
    } catch {
      // fall through
    }
  }
  const msg = String(err);
  if (msg.includes('Resource Missing') || msg.includes('404')) {
    return 'Account not found on this Stellar network. Make sure your Freighter wallet is funded and connected to the correct network.';
  }
  if (msg.includes('403') || msg.includes('Forbidden')) {
    return 'Access denied. Please unlock your Freighter wallet and try again.';
  }
  return msg.startsWith('Error:') ? msg.slice(7).trim() : msg;
}

/** Poll Horizon until the transaction appears on the ledger (up to 30 s). */
async function waitForLedgerConfirmation(
  horizonServer: import('stellar-sdk').Horizon.Server,
  txHash: string,
  timeoutMs = 30_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await horizonServer.transactions().transaction(txHash).call();
      return; // confirmed
    } catch {
      // Not yet on ledger, wait and retry
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

export default function PaymentModal({
  isOpen,
  onClose,
  agentId,
  agentName,
  priceXlm,
  ownerAddress,
  paymentMemo,
  onPaymentSuccess,
}: PaymentModalProps) {
  const [step, setStep] = useState<PaymentStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txExplorerUrl, setTxExplorerUrl] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'xlm' | 'af'>('xlm');

  const paying = step !== 'idle' && step !== 'done' && step !== 'error';

  const handlePay = async () => {
    setStep('checking_wallet');
    setError(null);
    setTxExplorerUrl(null);
    try {
      const StellarSdk = await import('stellar-sdk');
      const freighter = await import('@stellar/freighter-api');

      // Check Freighter is installed and connected
      const connectionResult = await freighter.isConnected();
      if (!connectionResult.isConnected) {
        throw new Error(
          'Freighter wallet is not installed. Please install the Freighter browser extension at https://www.freighter.app and try again.'
        );
      }

      // Request access if not already granted
      const accessResult = await freighter.requestAccess();
      if (accessResult && 'error' in accessResult && accessResult.error) {
        throw new Error('Freighter access denied. Please allow this site in Freighter and try again.');
      }

      const { address: senderKey, error: addrError } = await freighter.getAddress();
      if (addrError || !senderKey) throw new Error('Could not get wallet address. Please ensure Freighter is unlocked and you have granted permission.');

      setStep('building_tx');

      const isMainnet = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet';
      const horizonUrl = process.env.NEXT_PUBLIC_HORIZON_URL ||
        (isMainnet ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org');
      const networkPassphrase = isMainnet
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET;

      const horizonServer = new StellarSdk.Horizon.Server(horizonUrl);
      const senderAccount = await horizonServer.loadAccount(senderKey);

      const memo = paymentMemo || `agent:${agentId}`;
      let txBuilder = new StellarSdk.TransactionBuilder(senderAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      });

      if (paymentMethod === 'af') {
        const afTokenContractId = process.env.NEXT_PUBLIC_AF_TOKEN_CONTRACT_ID || 'CDCW72YVMAE34IQSED3AQ7UHLKOWXLOMN2UQ2J5H4CKY357G2CHMOARL';
        const amountStroops = BigInt(Math.round(priceXlm * 100 * 10_000_000));
        
        txBuilder.addOperation(
          StellarSdk.Operation.invokeContractFunction({
            contract: afTokenContractId,
            function: 'transfer',
            args: [
              new StellarSdk.Address(senderKey).toScVal(),
              new StellarSdk.Address(ownerAddress).toScVal(),
              StellarSdk.nativeToScVal(amountStroops, { type: 'i128' }),
            ],
          })
        );
      } else {
        txBuilder.addOperation(
          StellarSdk.Operation.payment({
            destination: ownerAddress,
            asset: StellarSdk.Asset.native(),
            amount: priceXlm.toFixed(7),
          })
        );
      }

      txBuilder.addMemo(StellarSdk.Memo.text(memo.slice(0, 28)))
        .setTimeout(paymentMethod === 'af' ? 180 : 60);

      let tx = txBuilder.build();

      if (paymentMethod === 'af') {
        const sorobanRpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 
          (isMainnet ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org');
        const rpcServer = new StellarSdk.rpc.Server(sorobanRpcUrl, { allowHttp: true });
        
        // Prepare Soroban Transaction
        tx = await rpcServer.prepareTransaction(tx);
      }

      setStep('signing');

      const xdr = tx.toXDR();
      const signedResult = await freighter.signTransaction(xdr, { networkPassphrase });
      if (signedResult.error) throw new Error(String(signedResult.error));
      const signedXdr = signedResult.signedTxXdr;
      const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

      setStep('submitting');

      let txHash: string;
      if (paymentMethod === 'af') {
        const sorobanRpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 
          (isMainnet ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org');
        const rpcServer = new StellarSdk.rpc.Server(sorobanRpcUrl, { allowHttp: true });
        
        const sendResult = await rpcServer.sendTransaction(signedTx);
        if (!sendResult.hash) throw new Error('Transaction submitted but no hash returned.');
        txHash = sendResult.hash;

        setStep('confirming');
        let status: any = sendResult.status;
        let txResult;
        let attempts = 0;
        while (status === 'PENDING' && attempts < 15) {
          await new Promise((r) => setTimeout(r, 2000));
          txResult = await rpcServer.getTransaction(txHash);
          status = txResult.status;
          attempts++;
        }
        if (status !== 'SUCCESS') {
          throw new Error(`Soroban transfer failed with status: ${status}`);
        }
      } else {
        const result = await horizonServer.submitTransaction(signedTx);
        txHash = result.hash;

        setStep('confirming');
        await waitForLedgerConfirmation(horizonServer, txHash);
      }

      // Build explorer URL for display
      const explorerNetwork = isMainnet ? 'public' : 'testnet';
      setTxExplorerUrl(`https://stellar.expert/explorer/${explorerNetwork}/tx/${txHash}`);

      setStep('done');
      onPaymentSuccess(txHash, senderKey);
    } catch (err) {
      setError(extractStellarError(err));
      setStep('error');
    }
  };

  const isMainnet = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md mx-4 rounded-2xl border border-[rgba(0,255,229,0.2)] bg-[#0a0a10] p-6"
          >
            <h2 className="font-syne text-xl font-bold text-white mb-1">Payment Required</h2>
            <p className="text-gray-400 text-sm mb-5">402 — Pay-per-request Protocol</p>

            {/* Currency Selector */}
            <div className="flex bg-white/[0.02] border border-white/[0.06] rounded-xl p-1 mb-5">
              <button
                type="button"
                onClick={() => setPaymentMethod('xlm')}
                disabled={paying}
                className={`flex-1 py-2 rounded-lg text-xs font-mono font-semibold transition-all ${
                  paymentMethod === 'xlm'
                    ? 'bg-gradient-to-r from-[#00FFE5]/20 to-[#00FFE5]/5 border border-[#00FFE5]/30 text-[#00FFE5]'
                    : 'text-gray-400 hover:text-white disabled:opacity-40'
                }`}
              >
                Native XLM
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('af')}
                disabled={paying}
                className={`flex-1 py-2 rounded-lg text-xs font-mono font-semibold transition-all ${
                  paymentMethod === 'af'
                    ? 'bg-gradient-to-r from-[#FFB800]/20 to-[#FFB800]/5 border border-[#FFB800]/30 text-[#FFB800]'
                    : 'text-gray-400 hover:text-white disabled:opacity-40'
                }`}
              >
                AF$ Token
              </button>
            </div>

            <div className="space-y-3 mb-6 font-mono text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Agent</span>
                <span className="text-white truncate max-w-[200px]">{agentName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Amount</span>
                {paymentMethod === 'xlm' ? (
                  <span className="text-[#00FFE5] font-bold">{(priceXlm).toFixed(4)} XLM</span>
                ) : (
                  <span className="text-[#FFB800] font-bold">{(priceXlm * 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AF$</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Network</span>
                <span className={isMainnet ? 'text-[#4ade80]' : 'text-[#00FFE5]'}>
                  Stellar {isMainnet ? 'Mainnet' : 'Testnet'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Memo</span>
                <span className="text-gray-300 text-xs truncate max-w-[200px]">
                  {paymentMemo}
                </span>
              </div>
            </div>

            {/* Step progress */}
            {paying && (
              <div className={`mb-4 p-3 rounded border text-xs font-mono flex items-center gap-2 ${
                paymentMethod === 'xlm'
                  ? 'bg-[rgba(0,255,229,0.06)] border-[rgba(0,255,229,0.2)] text-[#00FFE5]'
                  : 'bg-[rgba(255,184,0,0.06)] border-[rgba(255,184,0,0.2)] text-[#FFB800]'
              }`}>
                <span className={`w-2 h-2 rounded-full animate-pulse shrink-0 ${
                  paymentMethod === 'xlm' ? 'bg-[#00FFE5]' : 'bg-[#FFB800]'
                }`} />
                {STEP_LABELS[step]}
              </div>
            )}

            {step === 'done' && txExplorerUrl && (
              <div className="mb-4 p-3 rounded bg-[rgba(74,222,128,0.08)] border border-green-900 text-[#4ade80] text-xs font-mono">
                ✓ Payment confirmed on ledger.{' '}
                <a
                  href={txExplorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-green-300"
                >
                  View on Stellar Expert ↗
                </a>
              </div>
            )}

            {error && (
              <div className="mb-4 p-3 rounded bg-[rgba(255,69,69,0.1)] border border-red-900 text-red-400 text-xs font-mono">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={onClose}
                disabled={paying}
                className="flex-1 py-2.5 text-sm font-mono border border-[rgba(255,255,255,0.1)] text-gray-400 rounded-lg hover:text-white transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handlePay}
                disabled={paying}
                className={`flex-1 py-2.5 text-sm font-mono rounded-lg font-bold transition-all ${
                  paymentMethod === 'xlm'
                    ? 'bg-[#00FFE5] hover:bg-[#00e6ce] text-black disabled:opacity-50'
                    : 'bg-[#FFB800] hover:bg-[#e6a600] text-black disabled:opacity-50'
                }`}
              >
                {STEP_LABELS[step]}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
