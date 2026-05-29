'use client';

import { motion } from 'framer-motion';
import PageHero from '@/components/PageHero';

export default function AboutPage() {
  return (
    <div className="page-theme min-h-screen">
      <PageHero
        eyebrow="About"
        title={<>A Stellar-native execution layer for autonomous agents.</>}
        description={<>AgentForge binds identity, workflow orchestration, payments, and sandboxed execution into one programmable runtime.</>}
        actions={[
          { href: '/build', label: 'Build an Agent' },
          { href: '/dashboard', label: 'Open Dashboard', variant: 'secondary' },
        ]}
      />

      <div className="page-shell space-y-10">
        <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="page-panel p-6 md:p-8">
          <h2 className="text-2xl font-semibold text-white">Vision</h2>
          <div className="mt-4 space-y-4 text-sm md:text-[15px] leading-8 text-white/68">
            <p>
              AgentForge is building the infrastructure for a new economy of autonomous agents where execution is portable, reproducible, and monetizable.
            </p>
            <p>
              The platform is designed to feel like execution infrastructure, not a one-off AI demo.
            </p>
          </div>
        </motion.section>

        <section className="page-panel p-6 md:p-8">
          <h2 className="text-2xl font-semibold text-white mb-4">Technology Stack</h2>
          <div className="page-grid cols-2">
            {[
              { name: 'Stellar', role: 'Blockchain layer for low-fee transactions' },
              { name: 'Soroban', role: 'Policy and contract layer for agent identity' },
              { name: 'Freighter', role: 'Wallet integration and signing' },
              { name: '0x402', role: 'Pay-per-execution settlement flow' },
              { name: 'Supabase', role: 'Operational data and indexing' },
              { name: 'Next.js', role: 'Frontend App Router experience' },
            ].map((tech) => (
              <div key={tech.name} className="page-panel-soft p-4">
                <div className="font-semibold text-[var(--color-green-strong)]">{tech.name}</div>
                <div className="mt-1 text-xs leading-6 text-white/50">{tech.role}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="page-panel p-6 md:p-8">
          <h2 className="text-xl font-semibold text-white mb-3">Architecture</h2>
          <p className="text-sm leading-8 text-white/68">
            Each agent is registered as a Soroban policy-backed execution unit. The contract layer stores ownership and registry data while execution, logs, and artifacts remain in the runtime system.
          </p>
        </section>
      </div>
    </div>
  );
}
