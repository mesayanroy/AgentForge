'use client';

import { motion } from 'framer-motion';
import AgentBuilder from '@/components/AgentBuilder';
import PageHero from '@/components/PageHero';

export default function BuildPage() {
  return (
    <div className="page-theme min-h-screen">
      <PageHero
        eyebrow="Build"
        title={<>Compose and deploy an agent runtime.</>}
        description={<>Configure identity, permissions, workflow, and payout policy, then deploy to the Stellar execution layer.</>}
        actions={[
          { href: '/dashboard', label: 'Go to Dashboard', variant: 'secondary' },
        ]}
        stats={[
          { label: 'Step 1', value: 'Configure' },
          { label: 'Step 2', value: 'Simulate' },
          { label: 'Step 3', value: 'Deploy' },
        ]}
      />

      <div className="page-shell max-w-4xl">
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="page-panel p-4 md:p-6">
          <AgentBuilder />
        </motion.div>
      </div>
    </div>
  );
}
