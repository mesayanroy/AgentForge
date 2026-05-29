#!/usr/bin/env node
import { argv } from 'process';
import path from 'path';

async function main() {
  const args = argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node dist/runner.js <agentId> <input>');
    process.exit(2);
  }
  const [agentId, ...rest] = args;
  const input = rest.join(' ');

  // Import the local executor and run
  try {
    const mod = await import('../../consumers/agent-executor');
    if (typeof mod.executeAgentLocally !== 'function') {
      throw new Error('executeAgentLocally not available');
    }
    const res = await mod.executeAgentLocally(agentId, input, { requestId: `entry-${Date.now()}` });
    console.log(JSON.stringify({ ok: true, res }, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Runner entry failed:', err);
    process.exit(1);
  }
}

main();
