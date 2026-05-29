'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PageHero from '@/components/PageHero';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tool = 'pen' | 'eraser' | 'text' | 'rect' | 'circle' | 'triangle' | 'select';

interface DrawElement {
  id: string;
  tool: Tool;
  points?: { x: number; y: number }[];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  text?: string;
  color: string;
  strokeWidth: number;
}

interface Task {
  id: string;
  label: string;
  status: 'idle' | 'running' | 'done' | 'error';
  output?: string;
}

interface WorkflowPresetTask {
  label: string;
  output?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ─── Canvas Drawing ───────────────────────────────────────────────────────────

function DrawingCanvas({
  elements,
  onAdd,
  activeTool,
  activeColor,
  strokeWidth,
}: {
  elements: DrawElement[];
  onAdd: (el: DrawElement) => void;
  activeTool: Tool;
  activeColor: string;
  strokeWidth: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const currentEl = useRef<DrawElement | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const el of elements) {
      ctx.strokeStyle = el.color;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (el.tool === 'pen' && el.points && el.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length; i++) ctx.lineTo(el.points[i].x, el.points[i].y);
        ctx.stroke();
      } else if (el.tool === 'eraser' && el.points && el.points.length > 1) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length; i++) ctx.lineTo(el.points[i].x, el.points[i].y);
        ctx.stroke();
        ctx.restore();
      } else if (el.tool === 'rect' && el.x != null && el.y != null && el.w != null && el.h != null) {
        ctx.strokeRect(el.x, el.y, el.w, el.h);
      } else if (el.tool === 'circle' && el.x != null && el.y != null && el.w != null && el.h != null) {
        ctx.beginPath();
        ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.abs(el.w / 2), Math.abs(el.h / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (el.tool === 'triangle' && el.x != null && el.y != null && el.w != null && el.h != null) {
        ctx.beginPath();
        ctx.moveTo(el.x + el.w / 2, el.y);
        ctx.lineTo(el.x + el.w, el.y + el.h);
        ctx.lineTo(el.x, el.y + el.h);
        ctx.closePath();
        ctx.stroke();
      } else if (el.tool === 'text' && el.text && el.x != null && el.y != null) {
        ctx.fillStyle = el.color;
        ctx.font = `${el.strokeWidth * 6 + 10}px monospace`;
        ctx.fillText(el.text, el.x, el.y);
      }
    }

    if (currentEl.current) {
      const el = currentEl.current;
      ctx.strokeStyle = el.color;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = 'round';
      if (el.tool === 'pen' && el.points && el.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length; i++) ctx.lineTo(el.points[i].x, el.points[i].y);
        ctx.stroke();
      } else if (el.tool === 'rect' && el.x != null && el.y != null && el.w != null && el.h != null) {
        ctx.strokeRect(el.x, el.y, el.w, el.h);
      } else if (el.tool === 'circle' && el.x != null && el.y != null && el.w != null && el.h != null) {
        ctx.beginPath();
        ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.abs(el.w / 2), Math.abs(el.h / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (el.tool === 'triangle' && el.x != null && el.y != null && el.w != null && el.h != null) {
        ctx.beginPath();
        ctx.moveTo(el.x + el.w / 2, el.y);
        ctx.lineTo(el.x + el.w, el.y + el.h);
        ctx.lineTo(el.x, el.y + el.h);
        ctx.closePath();
        ctx.stroke();
      }
    }
  }, [elements]);

  useEffect(() => { redraw(); }, [redraw]);

  function getPos(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (activeTool === 'select') return;
    drawing.current = true;
    const pos = getPos(e);
    if (activeTool === 'pen' || activeTool === 'eraser') {
      currentEl.current = { id: uid(), tool: activeTool, points: [pos], color: activeColor, strokeWidth };
    } else if (['rect', 'circle', 'triangle'].includes(activeTool)) {
      currentEl.current = { id: uid(), tool: activeTool, x: pos.x, y: pos.y, w: 0, h: 0, color: activeColor, strokeWidth };
    }
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawing.current || !currentEl.current) return;
    const pos = getPos(e);
    if (currentEl.current.tool === 'pen' || currentEl.current.tool === 'eraser') {
      currentEl.current.points!.push(pos);
    } else if (currentEl.current.x != null && currentEl.current.y != null) {
      currentEl.current.w = pos.x - currentEl.current.x;
      currentEl.current.h = pos.y - currentEl.current.y;
    }
    redraw();
  }

  function onMouseUp() {
    if (!drawing.current || !currentEl.current) return;
    drawing.current = false;
    onAdd({ ...currentEl.current });
    currentEl.current = null;
  }

  return (
    <canvas
      ref={canvasRef}
      width={900}
      height={520}
      className="w-full h-full rounded-xl cursor-crosshair"
      style={{ background: 'transparent' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    />
  );
}

// ─── Tool Button ──────────────────────────────────────────────────────────────

function ToolBtn({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
        active
          ? 'bg-[rgba(0,255,229,0.15)] text-[#00FFE5] border border-[rgba(0,255,229,0.3)]'
          : 'text-gray-400 hover:text-white hover:bg-[rgba(255,255,255,0.06)]'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Payment Executor Types ────────────────────────────────────────────────────

interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  priceXlm: number;
  ownerAddress: string;
}

interface InvoiceData {
  invoiceNumber: string;
  agentId: string;
  agentName: string;
  task: string;
  priceXlm: number;
  txHash: string;
  fromWallet: string;
  timestamp: string;
  explorerUrl: string;
}

type ExecutorStep =
  | 'idle'
  | 'checking_wallet'
  | 'building_tx'
  | 'signing'
  | 'submitting'
  | 'confirming'
  | 'running_agent'
  | 'done'
  | 'error';

const EXECUTOR_STEP_LABELS: Record<ExecutorStep, string> = {
  idle: 'Execute Task',
  checking_wallet: 'Checking wallet…',
  building_tx: 'Building transaction…',
  signing: 'Waiting for Freighter…',
  submitting: 'Submitting to Stellar…',
  confirming: 'Confirming on ledger…',
  running_agent: 'Running agent…',
  done: 'Done',
  error: 'Retry',
};

const DEMO_WORKFLOW_PRESET: WorkflowPresetTask[] = [
  {
    label: 'Map current XLM/USDC conditions and identify a single execution risk.',
  },
  {
    label: 'Refine the prior analysis into a concise execution plan with one actionable trade-off.',
  },
  {
    label: 'Package the result as a delivery-ready summary for the operator dashboard.',
  },
];

const STELLAR_MEMO_MAX_LENGTH = 28;
const STELLAR_POLL_INTERVAL_MS = 2_000;

function generateInvoiceNumber(): string {
  return `INV-${Date.now().toString(36).toUpperCase()}`;
}

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
    } catch { /* fall through */ }
  }
  const msg = String(err);
  if (msg.includes('Resource Missing') || msg.includes('404'))
    return 'Account not found on Stellar network. Make sure Freighter is funded on the correct network.';
  if (msg.includes('403') || msg.includes('Forbidden'))
    return 'Access denied. Please unlock Freighter and try again.';
  return msg.startsWith('Error:') ? msg.slice(7).trim() : msg;
}

async function waitForLedger(
  horizonServer: import('stellar-sdk').Horizon.Server,
  txHash: string,
  timeoutMs = 30_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await horizonServer.transactions().transaction(txHash).call();
      return;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, STELLAR_POLL_INTERVAL_MS));
  }
}

// ─── Payment Executor Section ──────────────────────────────────────────────────

function PaymentExecutorSection({ walletAddress }: { walletAddress: string }) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(null);
  const [taskPrompt, setTaskPrompt] = useState('');

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [step, setStep] = useState<ExecutorStep>('idle');
  const [stepError, setStepError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);

  useEffect(() => {
    if (!walletAddress) return;
    setLoadingAgents(true);
    setAgentsError(null);
    fetch(`/api/agents/list?owner=${walletAddress}`)
      .then((r) => r.json())
      .then((data) => {
        const list: AgentInfo[] = (Array.isArray(data) ? data : data?.agents ?? []).map(
          (a: Record<string, unknown>) => ({
            id: String(a.id ?? a.agent_id ?? ''),
            name: String(a.name ?? a.agent_name ?? 'Unnamed Agent'),
            description: a.description ? String(a.description) : undefined,
            priceXlm: Number(a.price_xlm ?? a.priceXlm ?? 0.1),
            ownerAddress: String(a.owner_address ?? a.ownerAddress ?? walletAddress),
          })
        );
        setAgents(list);
      })
      .catch((e) => setAgentsError(String(e)))
      .finally(() => setLoadingAgents(false));
  }, [walletAddress]);

  const handleExecute = async () => {
    if (!selectedAgent || !taskPrompt.trim()) return;
    setShowConfirmModal(false);
    setStep('checking_wallet');
    setStepError(null);
    setInvoice(null);

    try {
      const StellarSdk = await import('stellar-sdk');
      const freighter = await import('@stellar/freighter-api');

      const connResult = await freighter.isConnected();
      if (!connResult.isConnected)
        throw new Error('Freighter wallet is not installed. Visit https://www.freighter.app');

      const accessResult = await freighter.requestAccess();
      if (accessResult && 'error' in accessResult && accessResult.error)
        throw new Error('Freighter access denied. Please allow this site in Freighter.');

      const { address: senderKey, error: addrErr } = await freighter.getAddress();
      if (addrErr || !senderKey)
        throw new Error('Could not get wallet address. Ensure Freighter is unlocked.');

      setStep('building_tx');

      const isMainnet = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet';
      const horizonUrl =
        process.env.NEXT_PUBLIC_HORIZON_URL ??
        (isMainnet ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org');
      const networkPassphrase = isMainnet ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET;
      const horizonServer = new StellarSdk.Horizon.Server(horizonUrl);

      const senderAccount = await horizonServer.loadAccount(senderKey);
      const memo = `agent:${selectedAgent.id}`.slice(0, STELLAR_MEMO_MAX_LENGTH);

      const tx = new StellarSdk.TransactionBuilder(senderAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: selectedAgent.ownerAddress,
            asset: StellarSdk.Asset.native(),
            amount: selectedAgent.priceXlm.toFixed(7),
          })
        )
        .addMemo(StellarSdk.Memo.text(memo))
        .setTimeout(60)
        .build();

      setStep('signing');

      const signedResult = await freighter.signTransaction(tx.toXDR(), { networkPassphrase });
      if (signedResult.error) throw new Error(String(signedResult.error));

      const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedResult.signedTxXdr, networkPassphrase);

      setStep('submitting');
      const submitResult = await horizonServer.submitTransaction(signedTx);
      const txHash = submitResult.hash;

      setStep('confirming');
      await waitForLedger(horizonServer, txHash);

      setStep('running_agent');

      const explorerNet = isMainnet ? 'public' : 'testnet';
      const explorerUrl = `https://stellar.expert/explorer/${explorerNet}/tx/${txHash}`;

      const runRes = await fetch(`/api/agents/${selectedAgent.id}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-payment-tx-hash': txHash,
          'x-payment-from': senderKey,
        },
        body: JSON.stringify({ prompt: taskPrompt, task: taskPrompt }),
      });

      const runData = await runRes.json().catch(() => ({}));
      if (!runRes.ok) {
        // Payment succeeded; agent run had an issue — still show invoice
        console.warn('Agent run error:', runData);
      }

      setInvoice({
        invoiceNumber: generateInvoiceNumber(),
        agentId: selectedAgent.id,
        agentName: selectedAgent.name,
        task: taskPrompt,
        priceXlm: selectedAgent.priceXlm,
        txHash,
        fromWallet: senderKey,
        timestamp: new Date().toISOString(),
        explorerUrl,
      });

      setStep('done');
    } catch (err) {
      setStepError(extractStellarError(err));
      setStep('error');
    }
  };

  const busy = step !== 'idle' && step !== 'done' && step !== 'error';
  const isMainnet = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet';

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="space-y-6"
    >
      {/* Heading */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[rgba(0,255,229,0.1)] border border-[rgba(0,255,229,0.2)] flex items-center justify-center shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00FFE5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <div>
          <h2 className="font-syne text-xl font-bold text-white">0x402 Payment Executor</h2>
          <p className="font-mono text-xs text-gray-500">Select an agent, enter a task, pay &amp; execute via Stellar.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ── Agent Selection ── */}
        <div className="space-y-3">
          <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest">Your Agents</p>

          {loadingAgents && (
            <div className="flex items-center gap-2 text-[#00FFE5] font-mono text-xs py-4">
              <span className="w-2 h-2 rounded-full bg-[#00FFE5] animate-pulse" />
              Loading agents…
            </div>
          )}

          {agentsError && (
            <div className="p-3 rounded-lg border border-red-900 bg-[rgba(248,113,113,0.06)] text-red-400 font-mono text-xs">
              {agentsError}
            </div>
          )}

          {!loadingAgents && !agentsError && agents.length === 0 && (
            <div className="p-4 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] text-center">
              <p className="font-mono text-xs text-gray-600">No agents found for this wallet.</p>
              <p className="font-mono text-[10px] text-gray-700 mt-1">Deploy an agent from the dashboard first.</p>
            </div>
          )}

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {agents.map((agent, i) => (
              <motion.button
                key={agent.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => { setSelectedAgent(agent); setStep('idle'); setStepError(null); setInvoice(null); }}
                className={`w-full text-left p-3 rounded-xl border transition-all ${
                  selectedAgent?.id === agent.id
                    ? 'border-[rgba(0,255,229,0.4)] bg-[rgba(0,255,229,0.06)]'
                    : 'border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] hover:border-[rgba(0,255,229,0.2)] hover:bg-[rgba(0,255,229,0.03)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-syne text-sm font-semibold ${selectedAgent?.id === agent.id ? 'text-[#00FFE5]' : 'text-white'}`}>
                    {agent.name}
                  </span>
                  <span className="font-mono text-xs text-[#FFB800] shrink-0">{agent.priceXlm} XLM</span>
                </div>
                {agent.description && (
                  <p className="font-mono text-[10px] text-gray-500 mt-1 truncate">{agent.description}</p>
                )}
                <p className="font-mono text-[9px] text-gray-700 mt-1 truncate">{agent.id}</p>
              </motion.button>
            ))}
          </div>
        </div>

        {/* ── Task Input + Execute ── */}
        <div className="space-y-4">
          <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest">Task / Prompt</p>

          <textarea
            value={taskPrompt}
            onChange={(e) => setTaskPrompt(e.target.value)}
            placeholder={selectedAgent ? `Describe the task for ${selectedAgent.name}…` : 'Select an agent first…'}
            disabled={!selectedAgent || busy}
            rows={5}
            className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-xl px-3 py-2.5 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-[rgba(0,255,229,0.3)] resize-none disabled:opacity-40 transition-colors"
          />

          {selectedAgent && (
            <div className="p-3 rounded-xl border border-[rgba(255,184,0,0.2)] bg-[rgba(255,184,0,0.04)] space-y-1">
              <div className="flex justify-between font-mono text-xs">
                <span className="text-gray-500">Agent</span>
                <span className="text-white">{selectedAgent.name}</span>
              </div>
              <div className="flex justify-between font-mono text-xs">
                <span className="text-gray-500">Price</span>
                <span className="text-[#FFB800] font-bold">{selectedAgent.priceXlm} XLM</span>
              </div>
              <div className="flex justify-between font-mono text-xs">
                <span className="text-gray-500">Network</span>
                <span className={isMainnet ? 'text-[#4ade80]' : 'text-[#00FFE5]'}>
                  Stellar {isMainnet ? 'Mainnet' : 'Testnet'}
                </span>
              </div>
            </div>
          )}

          {/* Step progress */}
          <AnimatePresence>
            {busy && (
              <motion.div
                key="progress"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="p-3 rounded-lg border border-[rgba(0,255,229,0.2)] bg-[rgba(0,255,229,0.06)] text-[#00FFE5] text-xs font-mono flex items-center gap-2"
              >
                <span className="w-2 h-2 rounded-full bg-[#00FFE5] animate-pulse shrink-0" />
                {EXECUTOR_STEP_LABELS[step]}
              </motion.div>
            )}
            {stepError && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="p-3 rounded-lg border border-red-900 bg-[rgba(248,113,113,0.06)] text-red-400 text-xs font-mono"
              >
                {stepError}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-2">
            <button
              onClick={() => { if (selectedAgent && taskPrompt.trim()) setShowConfirmModal(true); }}
              disabled={!selectedAgent || !taskPrompt.trim() || busy}
              className="w-full py-3 rounded-xl bg-[#00FFE5] text-black font-bold font-mono text-sm hover:bg-[#00e6ce] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {EXECUTOR_STEP_LABELS[step]}
            </button>
            <p className="font-mono text-[10px] text-[#FFB800] text-center">
              ⚠ Transaction requires wallet signature. Your XLM balance will be deducted.
            </p>
          </div>
        </div>
      </div>

      {/* ── Signature Confirm Modal ── */}
      <AnimatePresence>
        {showConfirmModal && selectedAgent && (
          <motion.div
            key="confirm-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setShowConfirmModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md mx-4 rounded-2xl border border-[rgba(0,255,229,0.2)] bg-[#0a0a10] p-6"
            >
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-[rgba(255,184,0,0.1)] border border-[rgba(255,184,0,0.3)] flex items-center justify-center shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFB800" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                </div>
                <div>
                  <h3 className="font-syne text-lg font-bold text-white">Signature Required</h3>
                  <p className="font-mono text-xs text-gray-400">Review and confirm the transaction</p>
                </div>
              </div>

              <div className="space-y-3 mb-6 font-mono text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Agent</span>
                  <span className="text-white">{selectedAgent.name}</span>
                </div>
                <div className="flex justify-between items-start gap-2">
                  <span className="text-gray-500 shrink-0">Task</span>
                  <span className="text-gray-300 text-xs text-right max-w-[240px] line-clamp-2">{taskPrompt}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Price</span>
                  <span className="text-[#FFB800] font-bold">{selectedAgent.priceXlm} XLM</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Network</span>
                  <span className={isMainnet ? 'text-[#4ade80]' : 'text-[#00FFE5]'}>
                    Stellar {isMainnet ? 'Mainnet' : 'Testnet'}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-lg border border-[rgba(255,184,0,0.2)] bg-[rgba(255,184,0,0.05)] mb-5">
                <p className="font-mono text-[10px] text-[#FFB800]">
                  ⚠ This will open Freighter and deduct {selectedAgent.priceXlm} XLM from your wallet.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="flex-1 py-2.5 text-sm font-mono border border-[rgba(255,255,255,0.1)] text-gray-400 rounded-lg hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExecute}
                  className="flex-1 py-2.5 text-sm font-mono bg-[#00FFE5] text-black rounded-lg font-bold hover:bg-[#00e6ce] transition-colors"
                >
                  Confirm &amp; Sign in Freighter
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Invoice Panel ── */}
      <AnimatePresence>
        {invoice && (
          <motion.div
            key="invoice"
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 200, damping: 22 }}
            className="rounded-2xl border border-[rgba(0,255,229,0.25)] bg-[rgba(0,10,10,0.8)] overflow-hidden"
          >
            {/* Invoice header */}
            <div className="px-6 py-4 border-b border-[rgba(0,255,229,0.1)] flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] text-[#00FFE5] uppercase tracking-widest mb-0.5">Payment Invoice</p>
                <p className="font-syne text-lg font-bold text-white">{invoice.invoiceNumber}</p>
              </div>
              <div className="px-3 py-1.5 rounded-lg bg-[rgba(74,222,128,0.12)] border border-[rgba(74,222,128,0.3)]">
                <span className="font-mono text-xs text-[#4ade80] font-bold tracking-wider">✓ CONFIRMED</span>
              </div>
            </div>

            {/* Invoice body */}
            <div className="px-6 py-5 space-y-3 font-mono text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Agent Name</span>
                <span className="text-white">{invoice.agentName}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-500 shrink-0">Agent ID</span>
                <span className="text-gray-300 text-xs text-right truncate max-w-[240px]">{invoice.agentId}</span>
              </div>
              <div className="flex justify-between items-start gap-3">
                <span className="text-gray-500 shrink-0">Task</span>
                <span className="text-gray-300 text-xs text-right max-w-[260px] line-clamp-2">{invoice.task}</span>
              </div>
              <div className="border-t border-[rgba(255,255,255,0.06)] pt-3 flex justify-between">
                <span className="text-gray-500">Amount Paid</span>
                <span className="text-[#FFB800] font-bold text-base">{invoice.priceXlm} XLM</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-500 shrink-0">TX Hash</span>
                <a
                  href={invoice.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#00FFE5] text-xs text-right truncate max-w-[220px] hover:underline"
                >
                  {invoice.txHash}
                </a>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-500 shrink-0">From Wallet</span>
                <span className="text-gray-300 text-xs text-right truncate max-w-[220px]">{invoice.fromWallet}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Timestamp</span>
                <span className="text-gray-300 text-xs">{new Date(invoice.timestamp).toLocaleString()}</span>
              </div>
            </div>

            {/* Invoice footer */}
            <div className="px-6 py-4 border-t border-[rgba(0,255,229,0.1)] flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] text-gray-600">Protocol: 0x402 · Stellar {isMainnet ? 'Mainnet' : 'Testnet'}</p>
              <a
                href={invoice.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(0,255,229,0.2)] text-[#00FFE5] font-mono text-xs hover:bg-[rgba(0,255,229,0.08)] transition-colors"
              >
                View on Stellar Explorer
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkflowPage() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>('pen');
  const [activeColor, setActiveColor] = useState('#00FFE5');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [elements, setElements] = useState<DrawElement[]>([]);
  const [history, setHistory] = useState<DrawElement[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const [tasks, setTasks] = useState<Task[]>([
    { id: uid(), label: 'Analyze market data from Binance', status: 'idle' },
    { id: uid(), label: 'Propose a DCA buy order on Jupiter', status: 'idle' },
  ]);
  const [newTask, setNewTask] = useState('');
  const [taskCount, setTaskCount] = useState(0);
  const [pendingPayment, setPendingPayment] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Strategy Notes state
  const [notes, setNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    const addr = localStorage.getItem('wallet_address');
    setWalletAddress(addr);
    // Load persisted notes
    const saved = localStorage.getItem('agentforge-workflow-notes');
    if (saved) setNotes(saved);
  }, []);

  // Canvas history helpers
  function pushHistory(els: DrawElement[]) {
    const next = history.slice(0, historyIndex + 1);
    next.push(els);
    setHistory(next);
    setHistoryIndex(next.length - 1);
  }

  function undo() {
    if (historyIndex <= 0) return;
    const idx = historyIndex - 1;
    setHistoryIndex(idx);
    setElements(history[idx]);
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    const idx = historyIndex + 1;
    setHistoryIndex(idx);
    setElements(history[idx]);
  }

  function addElement(el: DrawElement) {
    const next = [...elements, el];
    setElements(next);
    pushHistory(next);
  }

  function addTask() {
    if (!newTask.trim()) return;
    setTasks((t) => [...t, { id: uid(), label: newTask.trim(), status: 'idle' }]);
    setNewTask('');
  }

  function removeTask(id: string) {
    setTasks((t) => t.filter((x) => x.id !== id));
  }

  async function runTask(task: Task) {
    if (!walletAddress) return;
    setTasks((t) => t.map((x) => x.id === task.id ? { ...x, status: 'running' } : x));

    // Simulate agent processing
    await new Promise((r) => setTimeout(r, 1200 + Math.random() * 800));

    const newCount = taskCount + 1;
    setTaskCount(newCount);

    // Every 2 tasks: request wallet signature / 0x402 payment
    if (newCount % 2 === 0) {
      setPendingPayment(true);
      setTasks((t) => t.map((x) => x.id === task.id ? { ...x, status: 'done', output: '[Mock] Task completed. Payment approval required for next batch.' } : x));
      return;
    }

    setTasks((t) => t.map((x) =>
      x.id === task.id ? {
        ...x,
        status: 'done',
        output: `[Mock] Task executed successfully. Agent processed: "${task.label}". Testnet TX pending confirmation.`,
      } : x
    ));
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFile(file.name);
  }

  function approvePayment() {
    setPendingPayment(false);
    setTasks((t) => t.map((x) => x.status === 'done' ? x : { ...x, status: 'idle' }));
  }

  function saveNotes() {
    localStorage.setItem('agentforge-workflow-notes', notes);
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  }

  function sendNotesToTasks() {
    const lines = notes.split('\n');
    const checkboxTasks = lines
      .filter((line) => line.trim().startsWith('- [ ]'))
      .map((line) => line.replace(/^- \[ \]\s*/, '').trim())
      .filter(Boolean);
    if (checkboxTasks.length === 0) return;
    setTasks((t) => [
      ...t,
      ...checkboxTasks.map((label) => ({ id: uid(), label, status: 'idle' as const })),
    ]);
  }

  function loadDemoWorkflow() {
    const nextTasks = DEMO_WORKFLOW_PRESET.map((task, index) => ({
      id: `demo-${index + 1}`,
      label: task.label,
      status: 'idle' as const,
      output: task.output,
    }));

    setDemoMode(true);
    setTasks(nextTasks);
    setTaskCount(0);
    setPendingPayment(false);
    setNewTask('');
  }

  if (!walletAddress) {
    return (
      <div className="page-theme min-h-screen flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-sm page-panel p-8"
        >
          <div className="w-16 h-16 rounded-2xl bg-[rgba(0,255,229,0.1)] border border-[rgba(0,255,229,0.2)] flex items-center justify-center mx-auto mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00FFE5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="5" height="5" rx="1" /><rect x="16" y="3" width="5" height="5" rx="1" />
              <rect x="3" y="16" width="5" height="5" rx="1" /><rect x="16" y="16" width="5" height="5" rx="1" />
              <line x1="8" y1="5.5" x2="16" y2="5.5" /><line x1="5.5" y1="8" x2="5.5" y2="16" />
              <line x1="18.5" y1="8" x2="18.5" y2="16" /><line x1="8" y1="18.5" x2="16" y2="18.5" />
            </svg>
          </div>
          <h2 className="font-syne text-2xl font-bold text-white mb-2">Workflow Studio</h2>
          <p className="text-gray-400 font-mono text-sm">Connect your Freighter wallet to access the workflow canvas and task planner.</p>
        </motion.div>
      </div>
    );
  }

  const colors = ['#00FFE5', '#FFB800', '#4ade80', '#f87171', '#a78bfa', '#fb923c', '#ffffff'];

  return (
    <div className="page-theme min-h-screen px-6 py-8 space-y-6">
      <PageHero
        eyebrow="Workflow"
        title={<>Plan and execute agent tasks as a deterministic DAG.</>}
        description={<>Use the canvas to break execution into steps, wire dependencies, and simulate the final flow before deployment.</>}
        actions={[
          { href: '/build', label: 'Create an Agent' },
          { href: '/dashboard', label: 'Open Dashboard', variant: 'secondary' },
        ]}
      />

      <section className="page-shell page-panel overflow-hidden">
        <div className="relative rounded-[28px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(135deg,rgba(8,12,20,0.96),rgba(10,14,24,0.92)_42%,rgba(10,18,28,0.88))] p-6 md:p-8 shadow-[0_30px_90px_rgba(0,0,0,0.42)]">
          <div className="absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_top_right,rgba(0,255,229,0.09),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(255,184,0,0.08),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_18%,transparent_82%,rgba(255,255,255,0.02))]" />
          <div className="absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(0,255,229,0.35),rgba(255,255,255,0.25),transparent)]" />
          <div className="relative grid gap-6 lg:grid-cols-[1.2fr_0.8fr] items-start">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-[10px] font-mono uppercase tracking-[0.28em] text-white/55">
                Execution Studio
              </div>
              <div>
                <h2 className="font-syne text-[28px] md:text-[36px] font-semibold text-white leading-tight tracking-[-0.03em]">
                  A premium execution box for orchestrating, simulating, and shipping agent workflows.
                </h2>
                <p className="mt-3 max-w-2xl text-[14px] md:text-[15px] text-white/52 leading-7">
                  Compose a workflow like a production-grade operating environment: seed a demo preset, edit the canvas, queue tasks, and inspect payment-aware execution in one polished surface.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="page-panel-soft border border-[rgba(255,255,255,0.06)] px-4 py-3 bg-[rgba(255,255,255,0.025)]">
                  <div className="text-[10px] uppercase tracking-[0.24em] text-white/34">Mode</div>
                  <div className={`mt-2 text-sm font-semibold ${demoMode ? 'text-[#7efcf2]' : 'text-white'}`}>
                    {demoMode ? 'Demo sequence loaded' : 'Live workspace'}
                  </div>
                </div>
                <div className="page-panel-soft border border-[rgba(255,255,255,0.06)] px-4 py-3 bg-[rgba(255,255,255,0.025)]">
                  <div className="text-[10px] uppercase tracking-[0.24em] text-white/34">Canvas</div>
                  <div className="mt-2 text-sm font-semibold text-white">Deterministic DAG flow</div>
                </div>
                <div className="page-panel-soft border border-[rgba(255,255,255,0.06)] px-4 py-3 bg-[rgba(255,255,255,0.025)]">
                  <div className="text-[10px] uppercase tracking-[0.24em] text-white/34">Execution</div>
                  <div className="mt-2 text-sm font-semibold text-white">0x402 payment-aware runs</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  onClick={loadDemoWorkflow}
                  className="cta-primary"
                >
                  Load Demo Workflow <span>→</span>
                </button>
                <a
                  href="/docs#cli"
                  className="cta-secondary"
                >
                  View CLI Guide
                </a>
                {demoMode && (
                  <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(74,222,128,0.18)] bg-[rgba(74,222,128,0.06)] px-3 py-2 text-[10px] font-mono uppercase tracking-[0.26em] text-[#7cf0a6] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7cf0a6] opacity-35" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#7cf0a6]" />
                    </span>
                    Demo workflow loaded
                  </div>
                )}
              </div>
            </div>

            <div className="page-panel-soft relative overflow-hidden border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-5">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(0,255,229,0.08),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(255,184,0,0.06),transparent_30%)]" />
              <div className="relative space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.24em] text-white/34">Preset Preview</div>
                    <div className="mt-1 font-syne text-base font-semibold text-white">Templated Demo Workflow</div>
                  </div>
                  <div className="rounded-full border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-white/60">
                    Live preset
                  </div>
                </div>

                <div className="space-y-2">
                  {DEMO_WORKFLOW_PRESET.map((task, index) => (
                    <div key={task.label} className="flex items-start gap-3 rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.025)] px-4 py-3">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] text-[10px] font-mono text-white/70">
                        0{index + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="font-syne text-sm font-medium text-white">Step {index + 1}</div>
                        <div className="mt-1 text-[12px] leading-6 text-white/52">{task.label}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Payment approval banner */}
      {pendingPayment && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-[rgba(255,184,0,0.4)] bg-[rgba(255,184,0,0.06)] px-5 py-4 flex items-center justify-between gap-4"
        >
          <div>
            <p className="font-syne font-bold text-[#FFB800] text-sm">0x402 Payment Required</p>
            <p className="font-mono text-xs text-gray-400 mt-0.5">You have completed 2 tasks. Sign the transaction to unlock the next batch.</p>
          </div>
          <button
            onClick={approvePayment}
            className="px-4 py-2 rounded-lg bg-[#FFB800] text-black font-bold text-sm font-mono hover:bg-yellow-300 transition-colors whitespace-nowrap"
          >
            Sign &amp; Approve
          </button>
        </motion.div>
      )}

      {/* Two-column layout */}
      <div className="page-shell max-w-[1440px]">
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">

        {/* ── Drawing Canvas ── */}
        <div className="xl:col-span-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <p className="font-mono text-xs text-gray-500 uppercase tracking-[0.26em]">Canvas</p>
              {demoMode && (
                <motion.span
                  initial={{ opacity: 0, y: -4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                    className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-[10px] font-mono uppercase tracking-[0.26em] text-white/70"
                >
                  <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7cf0a6] opacity-35" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#7cf0a6]" />
                  </span>
                  Run Demo Workflow
                </motion.span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {demoMode && (
                <div className="hidden sm:inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-white/55">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#7cf0a6] shadow-[0_0_14px_rgba(124,240,166,0.55)]" />
                  Workflow health: stable
                </div>
              )}
              <button onClick={undo} title="Undo" className="w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:text-white hover:bg-[rgba(255,255,255,0.06)] text-xs font-mono">↩</button>
              <button onClick={redo} title="Redo" className="w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:text-white hover:bg-[rgba(255,255,255,0.06)] text-xs font-mono">↪</button>
              <button
                onClick={() => { setElements([]); pushHistory([]); }}
                className="ml-1 px-2 py-1 rounded text-[10px] font-mono text-gray-500 hover:text-red-400 hover:bg-[rgba(255,80,80,0.06)] transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-1 p-2 rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] flex-wrap">
            <ToolBtn active={activeTool === 'pen'} onClick={() => setActiveTool('pen')} title="Pen">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </ToolBtn>
            <ToolBtn active={activeTool === 'eraser'} onClick={() => setActiveTool('eraser')} title="Eraser">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 20H7L3 16l13-13 5 5-1 12z"/></svg>
            </ToolBtn>
            <ToolBtn active={activeTool === 'text'} onClick={() => setActiveTool('text')} title="Text">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
            </ToolBtn>
            <div className="w-px h-5 bg-[rgba(255,255,255,0.08)] mx-0.5" />
            <ToolBtn active={activeTool === 'rect'} onClick={() => setActiveTool('rect')} title="Rectangle">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
            </ToolBtn>
            <ToolBtn active={activeTool === 'circle'} onClick={() => setActiveTool('circle')} title="Circle">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
            </ToolBtn>
            <ToolBtn active={activeTool === 'triangle'} onClick={() => setActiveTool('triangle')} title="Triangle">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 22 22 2 22"/></svg>
            </ToolBtn>
            <div className="w-px h-5 bg-[rgba(255,255,255,0.08)] mx-0.5" />
            {colors.map((c) => (
              <button
                key={c}
                onClick={() => setActiveColor(c)}
                title={c}
                className={`w-5 h-5 rounded-full border-2 transition-transform ${activeColor === c ? 'scale-125 border-white' : 'border-transparent'}`}
                style={{ background: c }}
              />
            ))}
            <div className="w-px h-5 bg-[rgba(255,255,255,0.08)] mx-0.5" />
            <input
              type="range"
              min={1}
              max={8}
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
              className="w-16 accent-[#00FFE5]"
              title="Stroke width"
            />
          </div>

          {/* Canvas area */}
          <div className="relative overflow-hidden rounded-[28px] border border-[rgba(255,255,255,0.08)] bg-[rgba(2,6,16,0.88)] shadow-[0_28px_90px_rgba(0,0,0,0.56),inset_0_1px_0_rgba(255,255,255,0.04)]" style={{ height: 420 }}>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.11]"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(255,255,255,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.16) 1px, transparent 1px)',
                backgroundSize: '28px 28px',
                maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.95), rgba(0,0,0,0.55) 70%, transparent)',
                WebkitMaskImage: 'linear-gradient(180deg, rgba(0,0,0,0.95), rgba(0,0,0,0.55) 70%, transparent)',
              }}
            />
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -left-20 top-6 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(0,255,229,0.16),transparent_70%)] blur-2xl"
              animate={{ x: [0, 14, 0], y: [0, 8, 0], opacity: [0.38, 0.72, 0.38] }}
              transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -bottom-24 right-0 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(255,184,0,0.12),transparent_68%)] blur-3xl"
              animate={{ x: [0, -12, 0], y: [0, -10, 0], opacity: [0.3, 0.62, 0.3] }}
              transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-[linear-gradient(90deg,rgba(255,255,255,0.06),transparent)] opacity-0"
              animate={{ x: ['-20%', '122%'], opacity: [0, 0.16, 0] }}
              transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_12%,transparent_88%,rgba(255,255,255,0.015))]" />
            <div className="relative h-full p-3 md:p-4">
              <div className="h-full rounded-[22px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] backdrop-blur-[20px] overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <DrawingCanvas
                  elements={elements}
                  onAdd={addElement}
                  activeTool={activeTool}
                  activeColor={activeColor}
                  strokeWidth={strokeWidth}
                />
              </div>
            </div>
          </div>

          {/* File upload */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[rgba(255,255,255,0.08)] text-xs font-mono text-gray-400 hover:text-white hover:border-[rgba(0,255,229,0.2)] transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload Diagram
            </button>
            {uploadedFile && (
              <span className="font-mono text-[11px] text-[#00FFE5]">{uploadedFile} attached</span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".png,.jpg,.jpeg,.pdf,.svg"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
        </div>

        {/* ── Task Planner ── */}
        <div className="xl:col-span-2 flex flex-col gap-4">
          <p className="font-mono text-xs text-gray-500 uppercase tracking-widest">Agent Task Queue</p>

          <div className="flex gap-2">
            <input
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTask(); }}
              placeholder="Describe a task for your agent…"
              className="flex-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-[rgba(0,255,229,0.3)]"
            />
            <button
              onClick={addTask}
              className="px-3 py-2 rounded-lg bg-[rgba(0,255,229,0.1)] border border-[rgba(0,255,229,0.2)] text-[#00FFE5] text-sm font-mono hover:bg-[rgba(0,255,229,0.18)] transition-colors"
            >
              Add
            </button>
          </div>

          <div className="flex-1 flex flex-col gap-2 max-h-[460px] overflow-y-auto pr-1">
            {tasks.length === 0 && (
              <p className="font-mono text-xs text-gray-600 text-center py-8">No tasks yet. Add one above.</p>
            )}
            {tasks.map((task, i) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className={`rounded-xl border p-3 space-y-2 ${
                  task.status === 'running'
                    ? 'border-[rgba(0,255,229,0.3)] bg-[rgba(0,255,229,0.05)]'
                    : task.status === 'done'
                    ? 'border-[rgba(74,222,128,0.2)] bg-[rgba(74,222,128,0.04)]'
                    : task.status === 'error'
                    ? 'border-[rgba(248,113,113,0.2)] bg-[rgba(248,113,113,0.04)]'
                    : 'border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="font-mono text-[10px] text-gray-600 shrink-0">#{i + 1}</span>
                    <p className="font-mono text-xs text-white truncate">{task.label}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {task.status === 'idle' && (
                      <button
                        onClick={() => runTask(task)}
                        disabled={pendingPayment}
                        className="px-2 py-1 rounded text-[10px] font-mono bg-[rgba(0,255,229,0.1)] text-[#00FFE5] hover:bg-[rgba(0,255,229,0.2)] disabled:opacity-40 transition-colors"
                      >
                        Run
                      </button>
                    )}
                    {task.status === 'running' && (
                      <span className="font-mono text-[10px] text-[#00FFE5] animate-pulse">Running…</span>
                    )}
                    {task.status === 'done' && (
                      <span className="font-mono text-[10px] text-[#4ade80]">Done</span>
                    )}
                    <button
                      onClick={() => removeTask(task.id)}
                      className="w-5 h-5 flex items-center justify-center text-gray-600 hover:text-red-400 transition-colors"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                </div>
                {task.output && (
                  <p className="font-mono text-[10px] text-gray-400 leading-relaxed border-t border-[rgba(255,255,255,0.04)] pt-2">{task.output}</p>
                )}
              </motion.div>
            ))}
          </div>

          <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-3 space-y-1">
            <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest mb-2">Info</p>
            <p className="font-mono text-[11px] text-gray-400">Tasks completed: <span className="text-white">{taskCount}</span></p>
            <p className="font-mono text-[11px] text-gray-400">Mode: <span className={demoMode ? 'text-[#00FFE5]' : 'text-white'}>{demoMode ? 'Demo preset' : 'Live workspace'}</span></p>
            <p className="font-mono text-[11px] text-gray-400">Next payment gate: <span className="text-[#FFB800]">every 2 tasks</span></p>
            <p className="font-mono text-[11px] text-gray-400">Protocol: <span className="text-[#00FFE5]">0x402 · Testnet</span></p>
          </div>
        </div>
      </div>
      </div>

      {/* ── Payment Executor ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="rounded-2xl border border-[rgba(0,255,229,0.1)] bg-[rgba(255,255,255,0.01)] p-6"
      >
        <PaymentExecutorSection walletAddress={walletAddress} />
      </motion.div>

      {/* ── Strategy Notes ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl border border-[rgba(255,184,0,0.12)] bg-[rgba(255,255,255,0.01)] p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-syne text-xl font-bold text-white">Strategy Notes</h2>
            <p className="font-mono text-xs text-gray-500 mt-0.5">
              Saved to localStorage · Lines starting with <code className="text-[#00FFE5]">- [ ]</code> become tasks
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={sendNotesToTasks}
              className="px-3 py-1.5 rounded-lg border border-[rgba(0,255,229,0.2)] text-[#00FFE5] font-mono text-xs hover:bg-[rgba(0,255,229,0.08)] transition-colors"
            >
              Send to Tasks
            </button>
            <button
              onClick={saveNotes}
              className="px-3 py-1.5 rounded-lg bg-[rgba(255,184,0,0.1)] border border-[rgba(255,184,0,0.2)] text-[#FFB800] font-mono text-xs hover:bg-[rgba(255,184,0,0.18)] transition-colors"
            >
              {notesSaved ? '✓ Saved' : 'Save Notes'}
            </button>
          </div>
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={`Write your trading strategy or agent plan here...\n\nTip: Lines starting with "- [ ]" will be imported as tasks:\n- [ ] Analyze XLM/USDC liquidity\n- [ ] Run MEV bot scan\n- [ ] Execute arbitrage if profit > 0.5%`}
          rows={10}
          className="w-full bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.07)] rounded-xl px-4 py-3 font-mono text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[rgba(255,184,0,0.3)] resize-y transition-colors"
        />
      </motion.div>
    </div>
  );
}
