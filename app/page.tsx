 'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';

const FEATURE_CARDS = [
  {
    title: 'Execution isolation',
    description: 'Run each agent in a reproducible, policy-controlled environment instead of a shared opaque process.',
  },
  {
    title: 'Identity and payment',
    description: 'Bind execution to wallet ownership, permissions, settlement, and auditable on-chain evidence.',
  },
  {
    title: 'Workflow orchestration',
    description: 'Treat agent work as deterministic DAG pipelines with retries, checkpoints, and replay.',
  },
];

const ARCHITECTURE_STEPS = [
  'Forge CLI',
  'Workflow Engine',
  'Execution Orchestrator',
  'Sandbox Runtime',
  'Soroban Integration',
  'Payment + Identity',
];

export default function HomePage() {
  return (
    <div className="page-theme min-h-screen overflow-x-hidden">
      <section className="page-hero">
        <div className="page-shell text-center">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65 }}
          >
            <div className="page-kicker mx-auto">Stellar Agentic Operating System</div>
            <h1 className="page-title mt-5 text-[38px] md:text-[58px] lg:text-[72px] max-w-5xl mx-auto">
              Agent Runtime Infrastructure for Stellar-native execution.
            </h1>
            <p className="page-lead mx-auto mt-5 text-[15px] md:text-[17px]">
              Build portable, sandboxed, monetizable agents with deterministic workflows, on-chain identity, programmable payments, and verifiable execution.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/dashboard" className="cta-primary">Open Dashboard →</Link>
              <Link href="/build" className="cta-secondary">Start Building</Link>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-[11px] uppercase tracking-[0.22em] text-white/35">
              <span>Docker for agents</span>
              <span>•</span>
              <span>Temporal-style workflows</span>
              <span>•</span>
              <span>Soroban policy layer</span>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="page-shell">
        <div className="page-grid cols-3">
          {FEATURE_CARDS.map((card, index) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.08 }}
              className="page-panel p-6"
            >
              <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--color-green-strong)] mb-4">
                0{index + 1}
              </div>
              <h2 className="text-lg font-semibold text-white">{card.title}</h2>
              <p className="mt-3 text-sm leading-7 text-white/65">{card.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="page-shell pb-24">
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="page-panel p-6 md:p-8">
            <div className="page-kicker">Core Vision</div>
            <h2 className="mt-5 text-2xl md:text-3xl font-semibold text-white">
              You are not building an AI agent. You are building the execution layer around it.
            </h2>
            <div className="mt-5 space-y-4 text-sm md:text-[15px] leading-8 text-white/68">
              <p>
                The moat is reproducibility, portability, economic primitives, security, and developer tooling. The product needs to feel like a professional infrastructure platform, not a demo.
              </p>
              <p>
                The architecture should start centralized for speed, but stay modular enough to evolve into distributed execution later.
              </p>
            </div>
          </div>

          <div className="page-panel p-6 md:p-8">
            <div className="page-kicker">Architecture Stack</div>
            <div className="mt-5 space-y-3">
              {ARCHITECTURE_STEPS.map((step, index) => (
                <div key={step} className="page-panel-soft px-4 py-3 flex items-center justify-between">
                  <span className="text-sm text-white/78">{step}</span>
                  <span className="text-[11px] uppercase tracking-[0.2em] text-white/30">0{index + 1}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
