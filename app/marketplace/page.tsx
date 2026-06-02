'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import AgentCard from '@/components/AgentCard';
import { Agent } from '@/types';
import PageHero from '@/components/PageHero';

interface ForkModalProps {
  agent: Agent;
  onClose: () => void;
  onSuccess: (txHash: string) => void;
}

function ForkModal({ agent, onClose, onSuccess }: ForkModalProps) {
  const [step, setStep] = useState<'idle' | 'paying' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [customName, setCustomName] = useState(`Fork of ${agent.name}`);
  const [customPrompt, setCustomPrompt] = useState(agent.system_prompt || '');
  const [paymentMethod, setPaymentMethod] = useState<'xlm' | 'af'>('xlm');
  
  const FORK_FEE_XLM = agent.price_xlm > 0 ? agent.price_xlm * 10 : 1;

  const handleFork = async () => {
    setStep('paying');
    setError(null);
    try {
      const StellarSdk = await import('@stellar/stellar-sdk');
      const freighter = await import('@stellar/freighter-api');

      const conn = await freighter.isConnected();
      if (!conn.isConnected) throw new Error('Freighter wallet not installed. Visit https://www.freighter.app');

      await freighter.requestAccess();
      const { address: senderKey, error: addrError } = await freighter.getAddress();
      if (addrError || !senderKey) throw new Error('Could not get wallet address from Freighter.');

      const isMainnet = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet';
      const horizonUrl = process.env.NEXT_PUBLIC_HORIZON_URL ||
        (isMainnet ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org');
      const networkPassphrase = isMainnet ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET;

      const horizonServer = new StellarSdk.Horizon.Server(horizonUrl);
      const senderAccount = await horizonServer.loadAccount(senderKey);

      const memo = `fork:${agent.id}`.slice(0, 28);
      let txBuilder = new StellarSdk.TransactionBuilder(senderAccount, { fee: StellarSdk.BASE_FEE, networkPassphrase });

      if (paymentMethod === 'af') {
        const afTokenContractId = process.env.NEXT_PUBLIC_AF_TOKEN_CONTRACT_ID || 'CDCW72YVMAE34IQSED3AQ7UHLKOWXLOMN2UQ2J5H4CKY357G2CHMOARL';
        const amountStroops = BigInt(Math.round(FORK_FEE_XLM * 100 * 10_000_000));
        
        txBuilder.addOperation(
          StellarSdk.Operation.invokeContractFunction({
            contract: afTokenContractId,
            function: 'transfer',
            args: [
              new StellarSdk.Address(senderKey).toScVal(),
              new StellarSdk.Address(agent.owner_wallet).toScVal(),
              StellarSdk.nativeToScVal(amountStroops, { type: 'i128' }),
            ],
          })
        );
      } else {
        txBuilder.addOperation(StellarSdk.Operation.payment({
          destination: agent.owner_wallet,
          asset: StellarSdk.Asset.native(),
          amount: FORK_FEE_XLM.toFixed(7),
        }));
      }

      txBuilder.addMemo(StellarSdk.Memo.text(memo))
        .setTimeout(paymentMethod === 'af' ? 180 : 60);

      let tx = txBuilder.build();

      if (paymentMethod === 'af') {
        const sorobanRpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 
          (isMainnet ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org');
        const rpcServer = new StellarSdk.rpc.Server(sorobanRpcUrl, { allowHttp: true });
        tx = await rpcServer.prepareTransaction(tx);
      }

      const signedResult = await freighter.signTransaction(tx.toXDR(), { networkPassphrase });
      if (signedResult.error) throw new Error(String(signedResult.error));

      const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedResult.signedTxXdr, networkPassphrase);
      
      let txHash: string;
      if (paymentMethod === 'af') {
        const sorobanRpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 
          (isMainnet ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org');
        const rpcServer = new StellarSdk.rpc.Server(sorobanRpcUrl, { allowHttp: true });
        
        const sendResult = await rpcServer.sendTransaction(signedTx);
        if (!sendResult.hash) throw new Error('Transaction submitted but no hash returned.');
        txHash = sendResult.hash;

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
      }

      setStep('done');
      onSuccess(txHash);
    } catch (err) {
      const msg = String(err);
      setError(msg.startsWith('Error:') ? msg.slice(7).trim() : msg);
      setStep('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg mx-4 rounded-2xl border border-[rgba(255,184,0,0.2)] bg-[#0a0a10] p-6"
        onClick={(e) => e.stopPropagation()}>
        <h2 className="font-syne text-xl font-bold text-white mb-1">Fork Agent</h2>
        
        {/* Currency Selector */}
        <div className="flex bg-white/[0.02] border border-white/[0.06] rounded-xl p-1 mb-5 mt-4">
          <button
            type="button"
            onClick={() => setPaymentMethod('xlm')}
            disabled={step === 'paying'}
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
            disabled={step === 'paying'}
            className={`flex-1 py-2 rounded-lg text-xs font-mono font-semibold transition-all ${
              paymentMethod === 'af'
                ? 'bg-gradient-to-r from-[#FFB800]/20 to-[#FFB800]/5 border border-[#FFB800]/30 text-[#FFB800]'
                : 'text-gray-400 hover:text-white disabled:opacity-40'
            }`}
          >
            AF$ Token
          </button>
        </div>

        <p className="text-gray-400 text-sm mb-5">
          Pay {paymentMethod === 'xlm' ? (
            <span className="text-[#00FFE5] font-bold">{FORK_FEE_XLM} XLM</span>
          ) : (
            <span className="text-[#FFB800] font-bold">{(FORK_FEE_XLM * 100).toLocaleString()} AF$</span>
          )} to fork &quot;{agent.name}&quot; and customise it.
        </p>

        <div className="space-y-4 mb-5">
          <div>
            <label className="block text-[10px] font-mono text-gray-500 mb-1">Custom Name</label>
            <input value={customName} onChange={(e) => setCustomName(e.target.value)}
              className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-white text-sm font-mono focus:outline-none focus:border-[rgba(255,184,0,0.4)]" />
          </div>
          <div>
            <label className="block text-[10px] font-mono text-gray-500 mb-1">Custom System Prompt</label>
            <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} rows={4}
              className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-white text-sm font-mono focus:outline-none focus:border-[rgba(255,184,0,0.4)] resize-none" />
          </div>
        </div>

        <div className="text-xs font-mono text-gray-500 mb-4 p-3 rounded bg-white/[0.02] border border-white/[0.06]">
          <div className="flex justify-between">
            <span>Fork fee</span>
            {paymentMethod === 'xlm' ? (
              <span className="text-[#00FFE5] font-bold">{FORK_FEE_XLM} XLM</span>
            ) : (
              <span className="text-[#FFB800] font-bold">{(FORK_FEE_XLM * 100).toLocaleString()} AF$</span>
            )}
          </div>
          <div className="flex justify-between mt-1"><span>Destination</span><span className="text-white/70 truncate max-w-[200px]">{agent.owner_wallet}</span></div>
        </div>

        {step === 'done' && (
          <div className="mb-4 p-3 rounded bg-[rgba(74,222,128,0.08)] border border-green-900 text-[#4ade80] text-xs font-mono">
            ✓ Fork payment confirmed! Your customised agent has been registered.
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 rounded bg-[rgba(255,69,69,0.1)] border border-red-900 text-red-400 text-xs font-mono">{error}</div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} disabled={step === 'paying'}
            className="flex-1 py-2.5 text-sm font-mono border border-[rgba(255,255,255,0.1)] text-gray-400 rounded-lg hover:text-white transition-colors disabled:opacity-40">
            Cancel
          </button>
          <button onClick={handleFork} disabled={step === 'paying' || step === 'done'}
            className={`flex-1 py-2.5 text-sm font-mono rounded-lg font-bold transition-all disabled:opacity-50 ${
              paymentMethod === 'xlm'
                ? 'bg-[#00FFE5] text-black hover:bg-[#00e6ce]'
                : 'bg-[#FFB800] text-black hover:bg-[#e6a600]'
            }`}>
            {step === 'paying' ? 'Processing...' : step === 'done' ? 'Forked!' : `Fork & Pay ${
              paymentMethod === 'xlm' ? `${FORK_FEE_XLM} XLM` : `${(FORK_FEE_XLM * 100).toLocaleString()} AF$`
            }`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MarketplacePage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [forkAgent, setForkAgent] = useState<Agent | null>(null);
  const [forkSuccess, setForkSuccess] = useState<string | null>(null);

  useEffect(() => {
    const fetchAgents = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/agents/list');
        if (res.ok) {
          const data = await res.json() as { agents: Agent[] };
          setAgents(data.agents ?? []);
        }
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    };
    void fetchAgents();
  }, []);

  const featured = agents.filter((a) => a.is_active && a.total_requests > 0).slice(0, 6);
  const trending = agents.filter((a) => a.is_active).slice(0, 3);

  const isMainnet = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet';

  return (
    <div className="page-theme min-h-screen">
      <PageHero
        eyebrow="Marketplace"
        title={<>Discover, buy, and fork live agents.</>}
        description={<>Explore active agent listings, settle forks in XLM or AF$ tokens, and customize runtimes dynamically.</>}
        actions={[
          { href: '/build', label: 'Deploy an Agent' },
          { href: '/agents', label: 'View Agents', variant: 'secondary' },
        ]}
      />

      <div className="page-shell max-w-7xl space-y-14">

        {forkSuccess && (
          <div className="p-4 rounded-xl bg-[rgba(74,222,128,0.08)] border border-green-900 text-[#4ade80] font-mono text-sm">
            ✓ Fork payment confirmed · Tx: <a href={`https://stellar.expert/explorer/${isMainnet ? 'public' : 'testnet'}/tx/${forkSuccess}`}
              target="_blank" rel="noreferrer" className="underline hover:text-green-300">{forkSuccess.slice(0, 20)}...</a>
          </div>
        )}

        {loading ? (
          <div className="text-gray-500 font-mono text-sm py-20 text-center animate-pulse">Loading agents from chain...</div>
        ) : (
          <>
            <section>
              <h2 className="font-syne text-2xl font-bold text-white mb-6">⭐ Featured Agents</h2>
              {featured.length === 0 ? (
                <p className="font-mono text-sm text-gray-500">No featured agents yet. Deploy the first one!</p>
              ) : (
                <div className="page-grid cols-3">
                  {featured.map((agent) => (
                    <AgentCard key={agent.id} agent={agent} onFork={(a) => setForkAgent(a)} />
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="font-syne text-2xl font-bold text-white mb-6">🔥 Trending Now</h2>
              {trending.length === 0 ? (
                <p className="font-mono text-sm text-gray-500">No trending agents yet.</p>
              ) : (
                <div className="page-grid cols-3">
                  {trending.map((agent) => (
                    <AgentCard key={agent.id} agent={agent} onFork={(a) => setForkAgent(a)} />
                  ))}
                </div>
              )}
            </section>

            {agents.length === 0 && (
              <div className="py-20 text-center">
                <p className="font-syne text-xl text-white mb-2">No agents deployed yet</p>
                <p className="font-mono text-sm text-gray-500">Be the first to deploy an agent on AgentForge.</p>
              </div>
            )}
          </>
        )}
      </div>

      {forkAgent && (
        <ForkModal
          agent={forkAgent}
          onClose={() => setForkAgent(null)}
          onSuccess={(txHash) => {
            setForkAgent(null);
            setForkSuccess(txHash);
          }}
        />
      )}
    </div>
  );
}
