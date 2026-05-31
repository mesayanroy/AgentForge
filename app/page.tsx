'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

// Features for the outline
const FEATURE_SPEC = [
  {
    title: 'Execution Manager',
    subtitle: 'Soroban-native smart contract',
    description: 'Binds execution requests, active states, proof generation, and isolated resource bounds into a decentralized audit trial.',
    color: 'rgba(46,242,142,0.95)'
  },
  {
    title: 'Payment Router',
    subtitle: '0x402 Settlement standard',
    description: 'Implements native token settlement, protocol execution tariffs, workflow fee routing, and secure treasury accounting.',
    color: '#00FFE5'
  },
  {
    title: 'Programmable Agent Wallet',
    subtitle: 'Self-custodial agent-owned accounts',
    description: 'Programmable payment policies, daily spend thresholds, whitelisting for Soroswap/Blend pools, and strict multisig checks.',
    color: '#7b61ff'
  }
];

// CLI simulator contents
const CLI_COMMANDS = {
  'forge init': [
    'Creating local workspace...',
    '  ├── workspace/main.py',
    '  ├── workspace/agent.yaml',
    '  ├── workspace/requirements.txt',
    '  └── config/keys.json (linked to sandbox)',
    '✔ Initialized AgentForge project under python-3.11-stellar runtime.'
  ],
  'forge run': [
    '🔄 Compiling agent.yaml configuration to DAG...',
    '✔ DAG compiled: fetch_prices → analyze → simulate → execute → report',
    '📦 Spinning up PRoot sandboxed runtime environment...',
    '🔒 Mounting isolated namespaces, cgroups, and seccomp system-call filter...',
    '🚀 Booting agent process inside node-20-stellar runtime image...',
    '⏳ Executing step 1/5: fetch_prices (Soroswap liquidity query)...',
    '⏳ Executing step 2/5: analyze (Calculated slippage: 0.18% on AQUARIUS)...',
    '⏳ Executing step 3/5: simulate (Paper trade simulation: BUY 1,500 XLM)...',
    '⏳ Executing step 4/5: execute (Requesting signature via Agent Wallet Contract)...',
    '✔ Soroswap swap transaction succeeded: Hash [0x7f23a...f12c]',
    '⏳ Executing step 5/5: report (Sending audit proof to Agent Validator)...',
    '✨ Workflow completed successfully. Sandboxed container destroyed.'
  ],
  'forge deploy': [
    '🔑 Compiling agent source and verifying runtime checksums...',
    '📡 Pushing agent metadata to IPFS...',
    '   ↳ IPFS Hash: QmP9r2GgX...7y8z',
    '✍ Requesting signature from your Stellar Wallet...',
    '📡 Broadcasting to Stellar Testnet...',
    '✔ Deployed successfully to AgentRegistry Contract!',
    '   ↳ Registry Contract ID: CAS3...FORG',
    '   ↳ Validation Contract ID: CBB2...VALD'
  ],
  'forge monitor': [
    '📡 Connected to /ws/runtime gateway...',
    '── AGENT MONITORING CONSOLE ─────────────────────────',
    '● Runtime Status: ACTIVE (RUNNING)',
    '● CPU Limit: 2 Cores | Memory: 512MB',
    '● Network policy: WHITELIST (Soroswap API, Stellar RPC)',
    '● Current PnL: +$148.50 USD (Virtual balance)',
    '● Logs streaming: active... press Ctrl+C to close'
  ]
};

// Filesystems simulator
const DIRECTORY_STRUCTURE = {
  '/workspace': {
    description: 'Your primary agent logic directory. Read-write permitted only inside sandbox process.',
    file: 'main.py',
    content: `import sys\nfrom stellar_sdk import Server\nfrom agentforge import AgentWallet\n\ndef execute_logic():\n    print("Initiating market observation...")\n    # Agent-owned wallet interacts with Soroban SDK\n    wallet = AgentWallet.connect()\n    balance = wallet.get_balance()\n    print(f"Agent Balance: {balance} XLM")\n    \n    if balance > 100:\n        wallet.execute_swap("AQUARIUS", "XLM", "USDC", 50)\n\nif __name__ == "__main__":\n    execute_logic()`
  },
  '/config': {
    description: 'Secure, sandboxed configuration containing credentials and agent identity rules.',
    file: 'agent.yaml',
    content: `agent:\n  name: "ArbitrageStrike-V1"\n  version: "1.0.0"\n  model: "openai-gpt4o-mini"\n  payout_policy:\n    treasury: "GD23...AF89"\n    split_ratio: 0.85 # 85% to builder, 15% to protocol\n\nworkflow:\n  steps:\n    - name: fetch_prices\n      timeout: 30\n    - name: swap_dex\n      dependencies: [fetch_prices]`
  },
  '/logs': {
    description: 'Dynamic output logs streaming straight from the sandboxed container.',
    file: 'execution.log',
    content: `[2026-05-31 03:52:12] INFO: Booting PRoot filesystem layer...\n[2026-05-31 03:52:14] INFO: Sandboxed runtime allocated successfully.\n[2026-05-31 03:52:15] DEBUG: Network namespace locked. Only whitelisted endpoints allowed.\n[2026-05-31 03:52:16] SUCCESS: Agent identity contract verified [CAS3...FORG].`
  },
  '/artifacts': {
    description: 'Folder containing immutable trade proofs, CSV outputs, and performance reports.',
    file: 'pnl_report.json',
    content: `{\n  "agent_id": "arbitrage-strike-v1",\n  "timestamp": 1780182732,\n  "simulated_trades": 18,\n  "successful_swaps": 14,\n  "virtual_pnl_usd": 148.50,\n  "gas_spent_xlm": 0.082,\n  "audit_proof_ready": true\n}`
  },
  '/runtime': {
    description: 'System folder detailing isolation thresholds: CPU limits, cgroup properties, and seccomp filters.',
    file: 'sandbox.status',
    content: `sandbox_isolation_profile:\n  runtime: "pr-cgroups-v2"\n  namespaces:\n    - mount\n    - pid\n    - net\n    - ipc\n  seccomp_policy: "strict-block-syscalls"\n  allow_host_filesystem: false\n  signing_service_url: "http://signing-service.internal"`
  }
};

export default function HomePage() {
  // States for interactive components
  const [activeStep, setActiveStep] = useState<'PENDING' | 'QUEUED' | 'RUNNING' | 'COMPLETED'>('RUNNING');
  const [selectedFolder, setSelectedFolder] = useState<keyof typeof DIRECTORY_STRUCTURE>('/workspace');
  const [cliCommand, setCliCommand] = useState<keyof typeof CLI_COMMANDS>('forge run');
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [activeTab, setActiveTab] = useState<'contracts' | 'sandbox' | 'cli' | 'trading'>('contracts');

  // Paper trading mock state
  const [usdBalance, setUsdBalance] = useState(10000);
  const [xlmBalance, setXlmBalance] = useState(50000);
  const [tradeQuantity, setTradeQuantity] = useState('1000');
  const [tradeAsset, setTradeAsset] = useState('XLM');
  const [paperTrades, setPaperTrades] = useState([
    { id: '1', time: '10:42 AM', type: 'BUY', pair: 'XLM/USDC', size: '5,000 XLM', entry: '0.124', status: 'COMPLETED', pnl: '+4.2%' },
    { id: '2', time: '11:15 AM', type: 'SELL', pair: 'AQUARIUS/XLM', size: '10,000 AQUA', entry: '0.008', status: 'COMPLETED', pnl: '+2.8%' },
  ]);
  const [newOrderSuccess, setNewOrderSuccess] = useState(false);

  // Cryptographic verifier state
  const [auditHashes, setAuditHashes] = useState({
    execution: 'ea9e0ef7343e06180c4...7f92b49c',
    runtime: '8a2b109e230cbda109f...c28901ba',
    workflow: '6fb910e1189acbe09c7...a238fd19',
    agent: '98e1b20f01ba879cda8...28b9d0ea',
    validated: false,
    verifying: false
  });

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // CLI log typing simulator
  useEffect(() => {
    setIsTyping(true);
    setTerminalLines([]);
    let currentLine = 0;
    const lines = CLI_COMMANDS[cliCommand];

    const timer = setInterval(() => {
      if (currentLine < lines.length) {
        setTerminalLines((prev) => [...prev, lines[currentLine]]);
        currentLine++;
      } else {
        setIsTyping(false);
        clearInterval(timer);
      }
    }, 450);

    return () => clearInterval(timer);
  }, [cliCommand]);

  // Terminal scroll to bottom
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalLines]);

  // Simulated live execution loop
  useEffect(() => {
    const steps: ('PENDING' | 'QUEUED' | 'RUNNING' | 'COMPLETED')[] = ['PENDING', 'QUEUED', 'RUNNING', 'COMPLETED'];
    let index = steps.indexOf(activeStep);

    const interval = setInterval(() => {
      index = (index + 1) % steps.length;
      setActiveStep(steps[index]);
    }, 4500);

    return () => clearInterval(interval);
  }, [activeStep]);

  // Submit mock paper order
  const handlePaperOrder = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(tradeQuantity);
    if (isNaN(qty) || qty <= 0) return;

    const rate = 0.125; // mock XLM price in USD
    const totalCost = qty * rate;

    if (tradeAsset === 'XLM') {
      if (usdBalance < totalCost) {
        alert('Insufficient mock USDC balance!');
        return;
      }
      setUsdBalance((prev) => prev - totalCost);
      setXlmBalance((prev) => prev + qty);
    } else {
      if (xlmBalance < qty) {
        alert('Insufficient mock XLM balance!');
        return;
      }
      setXlmBalance((prev) => prev - qty);
      setUsdBalance((prev) => prev + totalCost);
    }

    const newTrade = {
      id: Date.now().toString(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      type: tradeAsset === 'XLM' ? 'BUY' : 'SELL',
      pair: 'XLM/USDC',
      size: `${qty.toLocaleString()} XLM`,
      entry: rate.toString(),
      status: 'COMPLETED',
      pnl: '0.0%'
    };

    setPaperTrades((prev) => [newTrade, ...prev]);
    setNewOrderSuccess(true);
    setTimeout(() => setNewOrderSuccess(false), 2000);
  };

  // Run mock cryptographic verification
  const handleVerifyAudit = () => {
    setAuditHashes(prev => ({ ...prev, verifying: true }));
    setTimeout(() => {
      setAuditHashes(prev => ({
        ...prev,
        verifying: false,
        validated: true,
        execution: 'ea9e0ef7343e06180c439129841804f981297e298109d9f123d47f92b49c',
        runtime: '8a2b109e230cbda109f283d10294e1e812d8a0f28b0cb1c28901ba28d9c28901',
        workflow: '6fb910e1189acbe09c73d2746f3918237912e8b23c91b7d8d238fd19bc9e10ab',
        agent: '98e1b20f01ba879cda812b109e02ef29b8c0df12d312bc80cb28b9d0ea01c29e'
      }));
    }, 1500);
  };

  return (
    <div className="page-theme min-h-screen overflow-x-hidden text-white font-sans">

      {/* ── HERO SECTION ──────────────────────────────────────────────────────── */}
      <section className="relative pt-32 pb-24 px-4 bg-black overflow-hidden border-b border-white/5">
        {/* Subtle grid lines background overlay */}
        <div className="absolute inset-0 grid-bg opacity-[0.12] pointer-events-none" />

        {/* Glowing backdrop spotlights for 3D depth */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] rounded-full bg-[radial-gradient(circle,rgba(46,242,142,0.08)_0%,transparent_70%)] blur-[140px] pointer-events-none z-0" />
        <div className="absolute top-1/3 left-1/4 -translate-x-1/2 w-[400px] h-[400px] rounded-full bg-[radial-gradient(circle,rgba(0,255,229,0.04)_0%,transparent_70%)] blur-[120px] pointer-events-none z-0" />
        <div className="absolute top-1/2 right-1/4 translate-x-1/2 w-[400px] h-[400px] rounded-full bg-[radial-gradient(circle,rgba(123,97,255,0.04)_0%,transparent_70%)] blur-[120px] pointer-events-none z-0" />

        {/* 3D Emergent Hands Background (Inverted to glow white on pitch black) */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 w-full h-[520px] max-w-[1500px] mx-auto pointer-events-none z-0 overflow-hidden opacity-30 select-none">
          <img
            src="/hands_creation.png"
            alt="Emergent 3D Hands Silhouette"
            className="w-full h-full object-cover invert brightness-[1.25] contrast-[1.25] scale-[1.04] sm:scale-100"
          />
        </div>

        {/* Centered Hero Content layered on top of the hands background */}
        <div className="relative z-10 text-center max-w-5xl mx-auto space-y-8 select-text">
          {/* Kicker badge */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[rgba(46,242,142,0.22)] bg-[rgba(46,242,142,0.06)] text-[10px] md:text-xs font-bold uppercase tracking-[0.24em] text-[var(--color-green-strong)] glow-teal"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-green-strong)] animate-ping" />
            AgentForge Execution Layer V1
          </motion.div>

          {/* Bold Serif Headline, superimposed directly on the fingertips touching in the center */}
          <motion.h1
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="font-serif text-[46px] sm:text-[66px] lg:text-[84px] font-medium leading-[1.04] tracking-tight text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)]"
          >
            Agentic OS. <br className="hidden sm:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[var(--color-green-strong)] via-[#00FFE5] to-[#7b61ff]">
              Built On Stellar.
            </span>
          </motion.h1>

          {/* Subtext in clean sans-serif */}
          <motion.p
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25 }}
            className="font-sans text-sm sm:text-base md:text-lg leading-relaxed text-gray-300 max-w-3xl mx-auto font-medium drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
          >
            Build portable, PRoot-sandboxed, monetizable agents with deterministic DAG workflows, secure agent-owned Stellar wallets, programmable payments, and cryptographically auditable runtimes on Soroban.
          </motion.p>

          {/* Action CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35 }}
            className="flex flex-wrap items-center justify-center gap-4 pt-2"
          >
            <Link href="/build" className="cta-primary text-sm px-9 py-4 rounded-xl group transition-all duration-300 hover:shadow-[0_0_35px_rgba(46,242,142,0.35)] flex items-center gap-2">
              Start Building
              <span className="font-mono transition-transform duration-300 group-hover:translate-x-1">→</span>
            </Link>
            <Link href="/dashboard" className="cta-secondary text-sm px-9 py-4 rounded-xl transition-all duration-300 hover:border-white/20 hover:bg-white/5 flex items-center gap-2 bg-black/40 backdrop-blur-sm">
              Deploy Agent
              <span className="font-mono text-gray-400">🚀</span>
            </Link>
          </motion.div>

          {/* Status Indicator */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.45 }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-emerald-500/20 bg-emerald-950/20 backdrop-blur-md w-fit mx-auto font-mono text-[9px] tracking-widest text-emerald-400 uppercase animate-pulse"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Soroban SDK Active
          </motion.div>
        </div>

        {/* Brand/Integration Marquee directly modeled after Nexora mockup */}
        <div className="relative z-10 mt-20 pt-8 border-t border-white/5 text-center">
          <p className="font-mono text-[10px] sm:text-xs text-gray-500 uppercase tracking-[0.24em] mb-6">
            Powering autonomous workflows across the Stellar ecosystem
          </p>
          <div className="flex flex-wrap items-center justify-center gap-y-3 gap-x-8 sm:gap-x-14 opacity-40 grayscale hover:opacity-85 hover:grayscale-0 transition-all duration-500 text-sm font-semibold tracking-wider font-mono text-white/80">
            <span className="hover:text-[var(--color-green-strong)] transition-colors">SOROSWAP</span>
            <span className="hover:text-[#00FFE5] transition-colors">BLEND POOLS</span>
            <span className="hover:text-[#7b61ff] transition-colors">AQUARIUS DEX</span>
            <span className="hover:text-amber-400 transition-colors">PHOENIX FI</span>
            <span className="hover:text-cyan-400 transition-colors">STELLAR CORE</span>
            <span className="hover:text-pink-400 transition-colors">0x402 ROUTER</span>
          </div>
        </div>
      </section>

      {/* ── INTERACTIVE CORE SPECIFICATION SHOWCASE ──────────────────────────── */}
      <section className="py-20 px-4 max-w-7xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="page-kicker">Platform Specification</div>
          <h2 className="mt-4 font-syne text-3xl md:text-5xl font-extrabold tracking-tight text-white">
            Architecture built for ironclad orchestration.
          </h2>
          <p className="mt-4 text-sm sm:text-base text-gray-400">
            Every layer from contracts to execution runtimes is decoupled, isolated, and auditable. Switch between architectural layers below.
          </p>
        </div>

        {/* Dynamic Selector Tabs */}
        <div className="flex flex-wrap items-center justify-center gap-2 p-1.5 bg-[#0b0b11] border border-white/5 rounded-2xl max-w-3xl mx-auto mb-12">
          {[
            { id: 'contracts', label: 'Soroban Contracts', icon: '📝' },
            { id: 'sandbox', label: 'Sandboxed Filesystem', icon: '📦' },
            { id: 'cli', label: 'CLI Developer DX', icon: '💻' },
            { id: 'trading', label: 'Paper Trading Engine', icon: '📈' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-mono text-xs font-semibold transition-all duration-300 ${activeTab === tab.id
                  ? 'bg-[rgba(46,242,142,0.09)] border border-[rgba(46,242,142,0.22)] text-[var(--color-green-strong)]'
                  : 'border border-transparent text-gray-500 hover:text-gray-300'
                }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab 1: Soroban Contracts */}
        <AnimatePresence mode="wait">
          {activeTab === 'contracts' && (
            <motion.div
              key="contracts"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.4 }}
              className="grid gap-8 lg:grid-cols-[1fr_1.1fr]"
            >
              <div className="space-y-6 flex flex-col justify-center">
                <div className="page-kicker border-purple-500/20 bg-purple-950/10 text-purple-400">Soroban Contract Core</div>
                <h3 className="font-syne text-2xl md:text-3xl font-extrabold text-white">
                  Decentralized governance of agent life cycles.
                </h3>
                <p className="text-gray-400 text-sm md:text-[15px] leading-relaxed">
                  Three native smart contracts manage registration, security assertions, token billing, and spend restrictions directly on the Stellar ledger.
                </p>

                <div className="space-y-4">
                  {FEATURE_SPEC.map((spec) => (
                    <div key={spec.title} className="page-panel-soft p-4 flex gap-4 items-start">
                      <div className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: spec.color }} />
                      <div>
                        <h4 className="text-sm font-bold text-white">{spec.title}</h4>
                        <span className="text-[10px] font-mono text-gray-500 block mb-1 uppercase tracking-wider">{spec.subtitle}</span>
                        <p className="text-xs text-gray-400">{spec.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Execution State Interactive Widget */}
              <div className="page-panel p-6 sm:p-8 flex flex-col justify-between border-white/10 bg-[#08080f]/70">
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <span className="font-mono text-xs text-gray-500">CONTRACT LOGIC: ExecutionManager.soroban</span>
                    <span className="px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-950/20 font-mono text-[9px] text-emerald-400 font-bold uppercase tracking-widest">
                      Ledger Verified
                    </span>
                  </div>

                  <h4 className="font-syne text-lg font-bold text-white mb-2">Interactive Pipeline State Monitor</h4>
                  <p className="text-xs text-gray-400 mb-8">
                    Watch the Soroban contract dynamically cycle agent states based on execution proofs and payments. Click a state node to force a manual pipeline jump.
                  </p>

                  <div className="relative grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    {/* Pipeline connecting line */}
                    <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-white/5 -translate-y-1/2 hidden md:block z-0" />

                    {[
                      { id: 'PENDING', desc: 'Verifying keys & AF gas tokens' },
                      { id: 'QUEUED', desc: 'Acquiring sandbox container' },
                      { id: 'RUNNING', desc: 'Executing sandboxed DAG' },
                      { id: 'COMPLETED', desc: 'Publishing proof & audits' }
                    ].map((step, idx) => {
                      const isActive = activeStep === step.id;
                      return (
                        <button
                          key={step.id}
                          onClick={() => setActiveStep(step.id as any)}
                          className={`relative z-10 p-4 rounded-xl border text-left transition-all duration-300 ${isActive
                              ? 'border-[var(--color-green-strong)] bg-[rgba(46,242,142,0.06)] shadow-[0_0_20px_rgba(46,242,142,0.05)]'
                              : 'border-white/5 bg-white/[0.01] hover:border-white/10 hover:bg-white/[0.02]'
                            }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className={`font-mono text-[10px] font-bold ${isActive ? 'text-[var(--color-green-strong)]' : 'text-gray-600'}`}>
                              0{idx + 1}
                            </span>
                            {isActive && (
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-green-strong)] animate-ping" />
                            )}
                          </div>
                          <div className={`font-mono text-xs font-bold ${isActive ? 'text-white' : 'text-gray-400'}`}>
                            {step.id}
                          </div>
                          <p className="text-[10px] text-gray-500 mt-1 leading-normal">{step.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* State explanations or output logs */}
                <div className="p-4 rounded-xl bg-black/40 border border-white/5 font-mono text-[11px] text-gray-400 min-h-[90px] flex flex-col justify-center">
                  <div className="flex items-center gap-2 text-[var(--color-green-strong)] font-bold mb-1.5">
                    <span>🗲</span>
                    <span>State Active: {activeStep}</span>
                  </div>
                  {activeStep === 'PENDING' && (
                    <p>Executing signature checks. The Payment Router verified a gas deposit of 2.50 AF Tokens from account GD42...12A8. Validation pending signature checks...</p>
                  )}
                  {activeStep === 'QUEUED' && (
                    <p>Soroban contract approved execution request. Allocating CPU limits inside NATS broker. Dispatching runner agent code to standard Docker-isolated PRoot sandbox...</p>
                  )}
                  {activeStep === 'RUNNING' && (
                    <p>Sandbox isolated. DAG workflow running: main.py executes Soroswap slippage estimation. System calls verified by seccomp policy filter.</p>
                  )}
                  {activeStep === 'COMPLETED' && (
                    <p>Execution completed successfully. Cryptographic audit hashes generated and anchored to Stellar block. Host container destroyed and locked.</p>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* Tab 2: Sandboxed Filesystem */}
          {activeTab === 'sandbox' && (
            <motion.div
              key="sandbox"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.4 }}
              className="grid gap-8 lg:grid-cols-[1fr_1.1fr]"
            >
              <div className="space-y-6 flex flex-col justify-center">
                <div className="page-kicker border-[#00FFE5]/20 bg-teal-950/10 text-[#00FFE5]">Sandbox Isolation</div>
                <h3 className="font-syne text-2xl md:text-3xl font-extrabold text-white">
                  Strictly sandboxed agent environments.
                </h3>
                <p className="text-gray-400 text-sm md:text-[15px] leading-relaxed">
                  Agents operate inside a lightweight **PRoot** sandbox wrapped with namespaces, strict cgroups, and strict seccomp restrictions. They can never escape to the host filesystem, and all signing must pass through the Soroban Policy contract.
                </p>

                <div className="grid grid-cols-2 gap-4">
                  {[
                    { title: '/workspace', size: 'Active logic code' },
                    { title: '/config', size: 'YAML DAG definitions' },
                    { title: '/logs', size: 'Real-time output stream' },
                    { title: '/artifacts', size: 'JSON performance audits' },
                    { title: '/runtime', size: 'Isolation system rules' }
                  ].map((folder) => {
                    const isSelected = selectedFolder === folder.title;
                    return (
                      <button
                        key={folder.title}
                        onClick={() => setSelectedFolder(folder.title as any)}
                        className={`p-4 rounded-xl border text-left transition-all duration-300 flex items-center justify-between ${isSelected
                            ? 'border-[#00FFE5] bg-[rgba(0,255,229,0.06)]'
                            : 'border-white/5 bg-white/[0.01] hover:border-white/10 hover:bg-white/[0.02]'
                          }`}
                      >
                        <div>
                          <div className={`font-mono text-xs font-bold ${isSelected ? 'text-white' : 'text-gray-300'}`}>
                            📁 {folder.title}
                          </div>
                          <div className="text-[10px] text-gray-500 font-mono mt-1">{folder.size}</div>
                        </div>
                        <span className={`font-mono text-xs ${isSelected ? 'text-[#00FFE5]' : 'text-gray-700'}`}>➔</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Sandboxed Code and Explorer Widget */}
              <div className="page-panel p-6 border-white/10 bg-[#08080f]/70 font-mono flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/5 text-xs text-gray-500">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#00FFE5]" />
                      PRoot Sandbox Filesystem Viewer
                    </span>
                    <span>Active Folder: {selectedFolder}</span>
                  </div>

                  <p className="text-xs text-gray-400 leading-relaxed mb-4">
                    {DIRECTORY_STRUCTURE[selectedFolder].description}
                  </p>

                  <div className="flex items-center gap-2 p-2 rounded-lg bg-black/40 border border-white/5 text-xs text-gray-400 mb-4">
                    <span className="text-gray-600">📄 File:</span>
                    <span className="font-bold text-[#00FFE5]">{DIRECTORY_STRUCTURE[selectedFolder].file}</span>
                  </div>

                  <div className="relative rounded-xl border border-white/5 bg-black/50 p-4 max-h-[220px] overflow-y-auto overflow-x-auto text-[11px] leading-relaxed text-gray-300">
                    <pre>{DIRECTORY_STRUCTURE[selectedFolder].content}</pre>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between gap-4 p-3 rounded-xl bg-white/[0.02] border border-white/5 text-[10px] text-gray-500 uppercase tracking-wider">
                  <span>Isolated Runtime:</span>
                  <div className="flex gap-2">
                    <span className="px-2 py-0.5 rounded border border-[#00FFE5]/30 bg-[#00FFE5]/5 text-[#00FFE5] font-bold">Python-3.11</span>
                    <span className="px-2 py-0.5 rounded border border-white/10 text-gray-500 font-bold">Node-20</span>
                    <span className="px-2 py-0.5 rounded border border-white/10 text-gray-500 font-bold">Rust-Soroban</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Tab 3: CLI Developer DX */}
          {activeTab === 'cli' && (
            <motion.div
              key="cli"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.4 }}
              className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]"
            >
              {/* Simulated Terminal Widget */}
              <div className="page-panel p-6 border-white/10 bg-[#040407] font-mono flex flex-col min-h-[360px] justify-between">
                <div>
                  {/* Top terminal bar */}
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/5 text-xs text-gray-500">
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-red-500/60" />
                      <span className="w-3 h-3 rounded-full bg-yellow-500/60" />
                      <span className="w-3 h-3 rounded-full bg-emerald-500/60" />
                      <span className="ml-2 text-white/50 text-[10px]">forge-cli-v1.0.0-stable</span>
                    </div>
                    <span>PowerShell (Sandbox Host)</span>
                  </div>

                  {/* Terminal stdout logs */}
                  <div className="space-y-1.5 text-[11px] leading-relaxed text-gray-300 min-h-[220px] max-h-[220px] overflow-y-auto">
                    <div className="text-gray-500 font-bold">C:\Users\Developer\AgentForge&gt; {cliCommand}</div>
                    {terminalLines.map((line, idx) => {
                      if (!line) return null;
                      const isError = line.includes('❌') || line.includes('Failed');
                      const isSuccess = line.includes('✔') || line.includes('succeeded') || line.includes('successfully') || line.includes('Completed');
                      return (
                        <div
                          key={idx}
                          className={`${isError ? 'text-red-400' : isSuccess ? 'text-[var(--color-green-strong)]' : 'text-gray-300'}`}
                        >
                          {line}
                        </div>
                      );
                    })}
                    {isTyping && (
                      <div className="flex items-center gap-1">
                        <span className="w-1.5 h-3.5 bg-white/70 animate-pulse inline-block" />
                        <span className="text-[10px] text-gray-600 uppercase tracking-widest italic animate-pulse">Running process...</span>
                      </div>
                    )}
                    <div ref={terminalEndRef} />
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border border-white/5 bg-white/[0.01] flex items-center justify-between text-[10px] text-gray-500">
                  <span>CLI Commands available. Click on the sidebar options to run.</span>
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-green-strong)] animate-pulse" />
                </div>
              </div>

              {/* Developer Command Selector */}
              <div className="space-y-6 flex flex-col justify-center">
                <div className="page-kicker border-emerald-500/20 bg-emerald-950/10 text-emerald-400">Developer DX</div>
                <h3 className="font-syne text-2xl md:text-3xl font-extrabold text-white">
                  CLI-first agent orchestration.
                </h3>
                <p className="text-gray-400 text-sm md:text-[15px] leading-relaxed">
                  Developers can manage, validate, simulate, and launch agents using the modular `forge` CLI utility. Click on the commands below to simulate execution in the terminal:
                </p>

                <div className="space-y-3 font-mono">
                  {[
                    { cmd: 'forge init', desc: 'Initialize an agent workspace template.' },
                    { cmd: 'forge run', desc: 'Compile YAML, spin up PRoot sandbox, and run agent DAG.' },
                    { cmd: 'forge deploy', desc: 'Deploy compiled agent and register to Soroban Ledger.' },
                    { cmd: 'forge monitor', desc: 'Stream real-time sandbox logs, CPU cycles, and paper PnL.' }
                  ].map((item) => {
                    const isSelected = cliCommand === item.cmd;
                    return (
                      <button
                        key={item.cmd}
                        onClick={() => setCliCommand(item.cmd as any)}
                        disabled={isTyping}
                        className={`w-full p-4 rounded-xl border text-left transition-all duration-300 flex items-center justify-between disabled:opacity-50 ${isSelected
                            ? 'border-[var(--color-green-strong)] bg-[rgba(46,242,142,0.06)]'
                            : 'border-white/5 bg-white/[0.01] hover:border-white/10 hover:bg-white/[0.02]'
                          }`}
                      >
                        <div>
                          <div className={`text-xs font-bold ${isSelected ? 'text-[var(--color-green-strong)]' : 'text-white'}`}>
                            {item.cmd}
                          </div>
                          <div className="text-[10px] text-gray-500 mt-1">{item.desc}</div>
                        </div>
                        <span className={`text-xs ${isSelected ? 'text-[var(--color-green-strong)]' : 'text-gray-700'}`}>➔</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}

          {/* Tab 4: Paper Trading & DEX Adapters */}
          {activeTab === 'trading' && (
            <motion.div
              key="trading"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.4 }}
              className="grid gap-8 lg:grid-cols-[1fr_1.1fr]"
            >
              <div className="space-y-6 flex flex-col justify-center">
                <div className="page-kicker border-amber-500/20 bg-amber-950/10 text-amber-400">Risk Simulation Engine</div>
                <h3 className="font-syne text-2xl md:text-3xl font-extrabold text-white">
                  Paper trade risk-free before deploying.
                </h3>
                <p className="text-gray-400 text-sm md:text-[15px] leading-relaxed">
                  Before linking capital to smart contracts, AgentForge runtimes simulate swaps on the Stellar DEX. The Paper Trading Engine manages virtual balances, tracks positions, and monitors risk.
                </p>

                {/* Simulated balances card */}
                <div className="p-5 rounded-2xl border border-white/5 bg-[#0b0b11] font-mono grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[9px] uppercase tracking-wider text-gray-500 block mb-1">Simulated Balance (USDC)</span>
                    <span className="text-lg font-bold text-white">${usdBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div>
                    <span className="text-[9px] uppercase tracking-wider text-gray-500 block mb-1">Simulated Balance (XLM)</span>
                    <span className="text-lg font-bold text-[#00FFE5]">{xlmBalance.toLocaleString()} XLM</span>
                  </div>
                </div>

                {/* Form to submit a paper trade */}
                <form onSubmit={handlePaperOrder} className="p-5 rounded-2xl border border-white/5 bg-white/[0.01] space-y-4">
                  <div className="text-xs font-bold text-white font-mono flex items-center justify-between">
                    <span>⚡ Submit Simulated Paper Order</span>
                    {newOrderSuccess && (
                      <span className="text-[var(--color-green-strong)] font-bold animate-pulse">Order Executed Successfully!</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[9px] text-gray-500 uppercase tracking-wider block">Quantity (XLM)</label>
                      <input
                        type="number"
                        value={tradeQuantity}
                        onChange={(e) => setTradeQuantity(e.target.value)}
                        className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-[#00FFE5]"
                        placeholder="1000"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] text-gray-500 uppercase tracking-wider block">Action</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setTradeAsset('XLM')}
                          className={`py-2 rounded-lg font-mono text-[10px] font-bold border transition-all ${tradeAsset === 'XLM'
                              ? 'border-[#00FFE5] text-[#00FFE5] bg-[#00FFE5]/5'
                              : 'border-white/10 text-gray-400'
                            }`}
                        >
                          BUY XLM
                        </button>
                        <button
                          type="button"
                          onClick={() => setTradeAsset('USDC')}
                          className={`py-2 rounded-lg font-mono text-[10px] font-bold border transition-all ${tradeAsset === 'USDC'
                              ? 'border-red-500 text-red-500 bg-red-500/5'
                              : 'border-white/10 text-gray-400'
                            }`}
                        >
                          SELL XLM
                        </button>
                      </div>
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-lg bg-[rgba(46,242,142,0.95)] hover:bg-[var(--color-green-strong)] text-[#041107] font-bold font-mono text-xs uppercase tracking-wider transition-all"
                  >
                    Execute Swap via DexAdapter
                  </button>
                </form>
              </div>

              {/* Live paper trades list */}
              <div className="page-panel p-6 border-white/10 bg-[#08080f]/70 font-mono flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/5 text-xs text-gray-500">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                      Paper Trading Ledger — Active Positions
                    </span>
                    <span className="px-2 py-0.5 rounded border border-amber-500/30 bg-amber-950/20 text-amber-400 text-[9px] uppercase tracking-wider font-bold">
                      Risk Locked
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead>
                        <tr className="border-b border-white/5 text-gray-500">
                          <th className="py-2.5">Time</th>
                          <th className="py-2.5">Type</th>
                          <th className="py-2.5">Pair</th>
                          <th className="py-2.5 text-right">Size</th>
                          <th className="py-2.5 text-right">Rate</th>
                          <th className="py-2.5 text-right text-emerald-400">PnL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paperTrades.map((trade) => (
                          <tr key={trade.id} className="border-b border-white/[0.02] hover:bg-white/[0.01]">
                            <td className="py-2.5 text-gray-500">{trade.time}</td>
                            <td className="py-2.5 font-bold">
                              <span className={trade.type === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>
                                {trade.type}
                              </span>
                            </td>
                            <td className="py-2.5 text-gray-300">{trade.pair}</td>
                            <td className="py-2.5 text-right text-gray-300">{trade.size}</td>
                            <td className="py-2.5 text-right text-gray-300">${trade.entry}</td>
                            <td className="py-2.5 text-right text-emerald-400 font-bold">{trade.pnl}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between gap-4 p-3 rounded-xl bg-white/[0.02] border border-white/5 text-[9px] text-gray-500 uppercase tracking-widest leading-relaxed">
                  <span>Stellar DEX adapters loaded:</span>
                  <div className="flex gap-2">
                    <span className="text-[#00FFE5] font-bold">Soroswap</span>
                    <span>•</span>
                    <span className="text-amber-500 font-bold">Aquarius</span>
                    <span>•</span>
                    <span className="text-purple-400 font-bold">Phoenix</span>
                    <span>•</span>
                    <span className="text-cyan-400 font-bold">Blend</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </section>

      {/* ── CRYPTOGRAPHIC AUDIT AND VERIFIER SECTION ───────────────────────── */}
      <section className="py-20 px-4 max-w-7xl mx-auto border-t border-white/5 relative">
        <div className="absolute top-1/2 left-1/4 w-[350px] h-[350px] rounded-full bg-[radial-gradient(circle,rgba(123,97,255,0.05)_0%,transparent_60%)] blur-[90px] pointer-events-none" />

        <div className="grid gap-12 lg:grid-cols-2 items-center">

          <div className="space-y-6">
            <div className="page-kicker border-purple-500/20 bg-purple-950/10 text-purple-400">Zero-Trust Audit Framework</div>
            <h2 className="font-syne text-3xl md:text-5xl font-extrabold tracking-tight text-white leading-tight">
              Cryptographically verified decision trails.
            </h2>
            <p className="text-gray-400 text-sm md:text-base leading-relaxed">
              Every workflow compilation, container initialization, transaction invocation, and paper trade logs a secure cryptographic fingerprint. These fingerprints are signed by the **Agent Validator** contract on Stellar to construct a tamper-proof auditing log.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div className="page-panel-soft p-5 border-white/5 bg-[#0b0b11]">
                <div className="text-3xl mb-3">🛡️</div>
                <h4 className="font-bold text-white text-sm mb-1.5">PRoot Container Seal</h4>
                <p className="text-xs text-gray-400">Runtimes generate verification hashes upon spinup to seal container filesystem authenticity.</p>
              </div>
              <div className="page-panel-soft p-5 border-white/5 bg-[#0b0b11]">
                <div className="text-3xl mb-3">🔗</div>
                <h4 className="font-bold text-white text-sm mb-1.5">DAG Compilation Hash</h4>
                <p className="text-xs text-gray-400">Workflow files compile into an immutable execution graph to prevent dynamic pipeline hijacking.</p>
              </div>
            </div>

            <button
              onClick={handleVerifyAudit}
              disabled={auditHashes.verifying}
              className={`px-6 py-3.5 rounded-xl font-mono text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-3 ${auditHashes.validated
                  ? 'border border-emerald-500/30 bg-emerald-950/10 text-emerald-400'
                  : 'bg-[#7b61ff] hover:bg-[#6348f2] text-white'
                }`}
            >
              <span>{auditHashes.verifying ? '🔄' : auditHashes.validated ? '✔' : '🔍'}</span>
              <span>{auditHashes.verifying ? 'Computing verification proofs...' : auditHashes.validated ? 'Stellar Ledger Verified!' : 'Run Verification Audit'}</span>
            </button>
          </div>

          {/* Hashing Terminal Visual Widget */}
          <div className="page-panel p-6 sm:p-8 border-white/10 bg-[#08080f]/80 font-mono text-[11px] leading-relaxed text-gray-400">
            <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-6">
              <span className="text-[10px] text-gray-500">AUDIT PROOF GENERATOR</span>
              <span className="px-2 py-0.5 rounded border border-white/10 bg-white/5 text-[9px] text-gray-300 uppercase tracking-widest font-bold">
                SECURE SHA-256
              </span>
            </div>

            <div className="space-y-4">
              {[
                { label: 'EXECUTION HASH', value: auditHashes.execution, desc: 'Logs isolated sandboxed inputs/outputs' },
                { label: 'RUNTIME HASH', value: auditHashes.runtime, desc: 'Calculates PRoot filesystem integrity check' },
                { label: 'WORKFLOW HASH', value: auditHashes.workflow, desc: 'Seals YAML dependency DAG integrity' },
                { label: 'AGENT HASH', value: auditHashes.agent, desc: 'Identifies registry contract profile' }
              ].map((hash) => (
                <div key={hash.label} className="p-3.5 rounded-xl border border-white/5 bg-black/40">
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="font-bold text-white">{hash.label}</span>
                    <span className="text-gray-600 font-mono text-[9px]">{hash.desc}</span>
                  </div>
                  <div className="text-[10px] font-mono text-[#00FFE5] truncate tracking-wider">{hash.value}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 p-4 rounded-xl border border-emerald-500/20 bg-emerald-950/5 flex items-start gap-3">
              <span className="text-lg">🛡️</span>
              <div className="space-y-1">
                <span className="font-bold text-white text-xs block">Verifiable On-Chain Checksums</span>
                <span className="text-[10px] text-gray-400 leading-normal block">
                  Clicking the validation triggers a Soroban cryptographic verification audit request that matches local outputs against the deployed `AgentValidator` contract on Stellar mainnet.
                </span>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ── FOOTER CORE VISION BANNER ────────────────────────────────────────── */}
      <section className="py-24 px-4 max-w-7xl mx-auto border-t border-white/5 text-center relative overflow-hidden">
        {/* Subtle grid lines background overlay */}
        <div className="absolute inset-0 grid-bg opacity-20 pointer-events-none" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[500px] h-[250px] rounded-full bg-[radial-gradient(circle,rgba(123,97,255,0.06)_0%,transparent_70%)] blur-[90px] pointer-events-none" />

        <div className="relative z-10 max-w-3xl mx-auto space-y-6">
          <div className="page-kicker">Core System Architecture</div>
          <h2 className="font-syne text-3xl md:text-5xl font-extrabold text-white tracking-tight leading-tight">
            Designed for modularity. Evolving for decentralization.
          </h2>
          <p className="text-gray-400 text-sm md:text-base leading-relaxed max-w-2xl mx-auto">
            AgentForge starts centralized for rapid iteration, but its components are completely modular. Future upgrades will support remote runners, zero-knowledge proofs of execution, decentralized nodes, staking, and SLA slashing policies.
          </p>
          <div className="pt-4 flex flex-wrap items-center justify-center gap-4">
            <Link href="/build" className="cta-primary text-xs px-6 py-3.5 rounded-xl font-bold uppercase tracking-wider">
              Start Building Now
            </Link>
            <Link href="/docs" className="cta-secondary text-xs px-6 py-3.5 rounded-xl font-bold uppercase tracking-wider text-gray-300 hover:text-white">
              Read Documentation
            </Link>
          </div>
        </div>
      </section>

    </div>
  );
}
