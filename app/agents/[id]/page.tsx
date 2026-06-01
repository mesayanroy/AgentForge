'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useParams, useRouter } from 'next/navigation';
import { Agent } from '@/types';
import TerminalOutput from '@/components/TerminalOutput';
import PaymentModal from '@/components/PaymentModal';
import { truncateAddress } from '@/lib/stellar';
import { useMarketplaceFeed } from '@/hooks/useMarketplaceFeed';

type RuntimeInfo = {
  agent_id: string;
  owner_wallet: string;
  api_endpoint: string | null;
  api_key: string | null;
  model: string;
  visibility: string;
};

export default function AgentDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [paymentChallenge, setPaymentChallenge] = useState<{
    memo: string;
    address: string;
    amountXlm: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [customTags, setCustomTags] = useState('');
  const [customEndpoint, setCustomEndpoint] = useState('');
  const [lastSignerWallet, setLastSignerWallet] = useState<string | null>(null);
  const [lastBilledXlm, setLastBilledXlm] = useState<number>(0);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [paymentApproved, setPaymentApproved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [viewerWallet, setViewerWallet] = useState<string>('');

  const agentId = Array.isArray(id) ? id[0] : id ?? '';

  // Real-time feed filtered to this agent's activity
  const { events: realtimeEvents, isConnected } = useMarketplaceFeed({ maxEvents: 5 });
  const agentEvents = realtimeEvents.filter((e) => e.agentId === agentId);

  useEffect(() => {
    setViewerWallet(localStorage.getItem('wallet_address') || '');
  }, []);

  useEffect(() => {
    const fetchAgent = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/agents/${agentId}`);
        if (res.ok) {
          const data = await res.json();
          setAgent(data);
          setCustomPrompt(String(data.system_prompt || ''));
          setCustomTags(Array.isArray(data.tags) ? data.tags.join(', ') : '');
          setCustomEndpoint(String(data.api_endpoint || ''));
        } else if (res.status === 404) {
          setNotFound(true);
        } else {
          setError('Failed to load agent details.');
        }
      } catch {
        setError('Failed to load agent details.');
      } finally {
        setLoading(false);
      }
    };
    if (agentId) fetchAgent();
  }, [agentId]);

  const runAgent = async (txHash?: string, signerWallet?: string) => {
    setRunning(true);
    setError(null);
    try {
      const walletAddress = signerWallet || localStorage.getItem('wallet_address');
      if (walletAddress) {
        setLastSignerWallet(walletAddress);
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (txHash) {
        headers['X-Payment-Tx-Hash'] = txHash;
        if (walletAddress) headers['X-Payment-Wallet'] = walletAddress;
      }

      const marketplaceEditable = ['public', 'forked'].includes(String(agent?.visibility || ''));
      const res = await fetch(`/api/agents/${agentId}/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          input,
          customization: marketplaceEditable
            ? {
                prompt: customPrompt,
                tags: customTags
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
                api_endpoint: customEndpoint,
              }
            : undefined,
        }),
      });
      const data = await res.json() as {
        error?: string;
        details?: string;
        output?: string;
        request_id?: string;
        latency_ms?: number;
        billed_xlm?: number;
        runtime?: RuntimeInfo;
        payment_details?: {
          memo?: string;
          address?: string;
          amount_xlm?: number;
        };
      };

      if (res.status === 402) {
        if (data?.payment_details?.memo && data?.payment_details?.address) {
          setPaymentChallenge({
            memo: data.payment_details.memo,
            address: data.payment_details.address,
            amountXlm: Number(data.payment_details.amount_xlm ?? agent?.price_xlm ?? 0),
          });
        }
        setPaymentApproved(false);
        setPaymentModal(true);
        return;
      }

      if (!res.ok) {
        const detailText = data.details ? ` (${data.details})` : '';
        throw new Error(`${data.error || 'Request failed'}${detailText}`);
      }

      setOutput(String(data.output || ''));
      setLastBilledXlm(Number(data.billed_xlm || 0));
      setRuntimeInfo(data.runtime || null);

      // Persist run timing locally so dashboard can reflect request timing instantly.
      if (typeof window !== 'undefined' && data.request_id && typeof data.latency_ms === 'number') {
        try {
          const existing = JSON.parse(localStorage.getItem('agent_runtime_history') || '[]') as Array<{
            requestId: string;
            agentId: string;
            latencyMs: number;
            createdAt: string;
          }>;
          existing.unshift({
            requestId: data.request_id,
            agentId,
            latencyMs: data.latency_ms,
            createdAt: new Date().toISOString(),
          });
          localStorage.setItem('agent_runtime_history', JSON.stringify(existing.slice(0, 100)));
          window.dispatchEvent(new CustomEvent('agent_run_success', {
            detail: {
              requestId: data.request_id,
              agentId,
              latencyMs: data.latency_ms,
            },
          }));
        } catch {
          // Ignore telemetry persistence failures.
        }
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  };

  const removeAgent = async () => {
    if (!agent || deleting) return;
    const walletAddress = localStorage.getItem('wallet_address') || '';
    if (!walletAddress) {
      setError('Connect wallet first to remove this agent.');
      return;
    }
    if (walletAddress !== agent.owner_wallet) {
      setError('Only the owner wallet can remove this agent.');
      return;
    }

    const ok = window.confirm(`Remove agent \"${agent.name}\" from active listings?`);
    if (!ok) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to remove agent');
      }
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500 font-mono text-sm">Loading agent...</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="font-syne text-2xl font-bold text-white mb-3">Agent Not Found</h2>
          <p className="text-gray-400 font-mono text-sm">
            The agent with ID <span className="text-[#00FFE5]">{agentId}</span> does not exist or has been removed.
          </p>
        </div>
      </div>
    );
  }

  if (!agent) return null;

  const totalRequests = Number(agent.total_requests ?? 0);
  const totalEarnedXlm = Number(agent.total_earned_xlm ?? 0);
  const forkCount = Number((agent as Agent & { fork_count?: number }).fork_count ?? 0);
  const marketplaceEditable = ['public', 'forked'].includes(String(agent.visibility || ''));

  const cliUsage = [
    'pnpm run cli -- agents list',
    `pnpm run cli -- agents get ${agent.id}`,
    `pnpm run cli -- run --id ${agent.id} --input \"your task\"`,
    'pnpm run cli -- tasks list',
    'pnpm run cli -- approvals list',
  ].join('\n');

  const devSnippet = `const res = await fetch('${runtimeInfo?.api_endpoint || agent.api_endpoint || `/api/agents/${agent.id}/run`}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // Add these after 402 challenge:
    // 'X-Payment-Tx-Hash': '<stellar_tx_hash>',
    // 'X-Payment-Wallet': '<your_wallet>'
  },
  body: JSON.stringify({ input: 'Automate this workflow' })
});
const data = await res.json();`;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_10%_0%,rgba(0,255,229,0.08),transparent_30%),radial-gradient(circle_at_90%_100%,rgba(255,184,0,0.08),transparent_35%),#07080d] text-white">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 md:py-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-7"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-syne text-3xl md:text-4xl font-bold">{agent.name}</h1>
              <p className="text-white/65 mt-1 text-sm md:text-base max-w-2xl">{agent.description || 'AI agent execution console with 0x402 payment flow.'}</p>
            </div>
            <div className="text-right space-y-2">
              <div>
                <div className="text-[#00FFE5] font-syne font-bold text-2xl md:text-3xl">
                  {agent.price_xlm} XLM
                </div>
                <div className="text-white/40 text-xs font-mono mt-0.5">
                  or {(agent.price_xlm * 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AF$
                </div>
              </div>
              {viewerWallet && viewerWallet === agent.owner_wallet && (
                <button
                  onClick={removeAgent}
                  disabled={deleting}
                  className="border border-red-700/70 text-red-300 px-3 py-1.5 rounded-lg text-xs font-mono hover:bg-red-500/10 disabled:opacity-50"
                >
                  {deleting ? 'Removing...' : 'Remove Agent'}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <section className="lg:col-span-2 border border-white/15 rounded-3xl bg-white/[0.03] backdrop-blur-sm p-5 md:p-7">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-7">
                <div>
                  <label className="block text-sm font-mono text-white/70 mb-2">User wallet</label>
                  <input
                    value={lastSignerWallet || agent.owner_wallet}
                    readOnly
                    className="w-full border border-white/20 rounded-2xl px-4 py-3 bg-white/[0.04] text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-mono text-white/70 mb-2">Url</label>
                  <input
                    value={customEndpoint || agent.api_endpoint || ''}
                    onChange={(e) => setCustomEndpoint(e.target.value)}
                    readOnly={!marketplaceEditable}
                    className="w-full border border-white/20 rounded-2xl px-4 py-3 bg-white/[0.04] text-sm text-white"
                  />
                </div>
              </div>

              <div className="mb-7">
                <label className="block text-sm font-mono text-white/70 mb-2">API endpoint</label>
                <input
                  value={runtimeInfo?.api_endpoint || agent.api_endpoint || ''}
                  readOnly
                  className="w-full border border-white/20 rounded-2xl px-4 py-3 bg-white/[0.04] text-sm text-white"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-mono text-white/70 mb-2">Tags</label>
                  <input
                    value={customTags}
                    onChange={(e) => setCustomTags(e.target.value)}
                    readOnly={!marketplaceEditable}
                    className="w-full border border-white/20 rounded-2xl px-4 py-3 bg-white/[0.04] text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-mono text-white/70 mb-2">Prompt</label>
                  <textarea
                    rows={4}
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    readOnly={!marketplaceEditable}
                    className="w-full border border-white/20 rounded-2xl px-4 py-3 bg-white/[0.04] text-sm text-white resize-none"
                  />
                </div>
              </div>

              {!marketplaceEditable && (
                <p className="mt-3 text-xs font-mono text-white/50">
                  Prompt/details customization is enabled only for marketplace agents.
                </p>
              )}
            </section>

            <aside className="space-y-6">
              <section className="border border-white/15 rounded-3xl bg-white/[0.03] p-5 md:p-6">
                <h3 className="font-syne text-xl md:text-2xl mb-3">How To Use CLI</h3>
                <ul className="font-mono text-sm leading-relaxed text-white/80">
                  <li>- CLI commands</li>
                  <li>- Tasks + approvals</li>
                  <li>- Actions + workflow automation</li>
                  <li>- 0x402 payment requests</li>
                  <li>- Completion and next task chaining</li>
                </ul>
                <div className="mt-4 border border-white/15 rounded-2xl p-4 text-center font-mono text-sm leading-tight bg-black/20">
                  <div>macOS</div>
                  <div>Windows</div>
                  <div>Linux</div>
                </div>
              </section>

              <section className="border border-white/15 rounded-3xl bg-white/[0.03] p-5 md:p-6">
                <h3 className="font-syne text-xl md:text-2xl mb-3">Developers Toolkit</h3>
                <p className="font-mono text-sm text-white/70 mb-4">Embed this agent in your app and automate workflows via API.</p>
                <div className="mt-4">
                  <TerminalOutput content={devSnippet} title="sdk" language="typescript" />
                </div>
                <div className="mt-4">
                  <TerminalOutput content={cliUsage} title="cli" language="bash" />
                </div>
              </section>
            </aside>
          </div>

          <section className="border border-white/15 rounded-3xl bg-white/[0.03] p-5 md:p-7">
            <h2 className="text-center font-syne text-2xl md:text-3xl mb-5">Run Agent</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 items-center">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Describe task for this agent"
                rows={3}
                className="md:col-span-2 border border-white/20 rounded-2xl px-4 py-3 bg-white/[0.04] text-sm text-white"
              />
              <button
                onClick={() => runAgent()}
                disabled={running || !input}
                className="border border-white/20 rounded-2xl px-5 py-3 bg-[#00FFE5] text-black hover:bg-[#0ef2dc] font-bold text-sm disabled:opacity-50"
              >
                {running ? 'Running...' : `Run (${agent.price_xlm} XLM / ${agent.price_xlm * 100} AF$)`}
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-xl border border-red-700/40 bg-red-500/10 text-red-300 text-sm">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-center">
              <div className="border border-white/20 rounded-3xl p-4 text-center bg-black/20 font-mono text-sm">
                {paymentApproved ? 'wallet signature approves' : 'awaiting payment signature'}
              </div>
              <div className="text-center text-xl font-mono text-white/70">else</div>
              <div className="border border-white/20 rounded-3xl p-4 text-center bg-black/20 font-mono text-sm">
                {!paymentApproved && paymentChallenge ? 'wallet signature disapprove' : 'ready'}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-white/15 rounded-2xl bg-white/[0.03] p-5">
              <h3 className="font-syne text-xl mb-3">Run Summary</h3>
              <div className="space-y-2 text-sm text-white/85">
                <div><strong>API Key:</strong> {runtimeInfo?.api_key || agent.api_key || 'N/A'}</div>
                <div><strong>User Wallet:</strong> {lastSignerWallet || 'N/A'}</div>
                <div><strong>Price:</strong> {agent.price_xlm} XLM / {agent.price_xlm * 100} AF$</div>
                <div><strong>Billed Last Run:</strong> {lastBilledXlm} XLM / {lastBilledXlm * 100} AF$</div>
                <div><strong>Forked:</strong> {forkCount} times</div>
                <div><strong>URL Endpoint:</strong> {runtimeInfo?.api_endpoint || agent.api_endpoint || 'N/A'}</div>
                <div><strong>Total Requests:</strong> {totalRequests.toLocaleString()}</div>
                <div><strong>Total Earned:</strong> {totalEarnedXlm} XLM / {totalEarnedXlm * 100} AF$</div>
              </div>
            </div>

            <div className="border border-white/15 rounded-2xl bg-white/[0.03] p-5">
              <h3 className="font-syne text-xl mb-3">Live Feed ({isConnected ? 'connected' : 'connecting'})</h3>
              <div className="space-y-2 text-xs text-white/75">
                {agentEvents.length === 0 ? (
                  <p>No live activity yet.</p>
                ) : (
                  agentEvents.map((ev, idx) => (
                    <div key={`${ev.timestamp}-${idx}`} className="border border-white/15 rounded-lg p-2 bg-black/20">
                      <div>{ev.eventType}</div>
                      <div>{ev.callerWallet ? truncateAddress(ev.callerWallet) : 'anonymous'}</div>
                      <div>{new Date(ev.timestamp).toLocaleTimeString('en-US', { hour12: false })}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          {output && (
            <TerminalOutput content={output} title="response" language="txt" />
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3 text-center">
              <div className="font-mono text-[#00FFE5]">{totalRequests.toLocaleString()}</div>
              <div className="text-[11px] text-white/55">Total Requests</div>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3 text-center">
              <div className="font-mono text-[#4ade80]">{totalEarnedXlm} XLM / {totalEarnedXlm * 100} AF$</div>
              <div className="text-[11px] text-white/55">Total Earned</div>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3 text-center">
              <div className="font-mono text-[#FFB800]">{forkCount}</div>
              <div className="text-[11px] text-white/55">Fork Count</div>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3 text-center">
              <div className="font-mono text-white">{truncateAddress(agent.owner_wallet)}</div>
              <div className="text-[11px] text-white/55">Owner</div>
            </div>
          </div>
        </motion.div>
      </div>

      <PaymentModal
        isOpen={paymentModal}
        onClose={() => {
          setPaymentModal(false);
          setPaymentApproved(false);
        }}
        agentId={agent.id}
        agentName={agent.name}
        priceXlm={paymentChallenge?.amountXlm ?? agent.price_xlm}
        ownerAddress={paymentChallenge?.address ?? agent.owner_wallet}
        paymentMemo={paymentChallenge?.memo ?? `agent:${agent.id}`}
        onPaymentSuccess={(txHash, signerWallet) => {
          setPaymentModal(false);
          setPaymentApproved(true);
          runAgent(txHash, signerWallet);
        }}
      />
    </div>
  );
}
