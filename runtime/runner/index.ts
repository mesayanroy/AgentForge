#!/usr/bin/env node
/**
 * runtime/runner/index.ts
 *
 * Lightweight local runner prototype.
 * Usage: node runtime/runner/index.ts <agentId> "input text"
 */

import path from 'node:path';

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2) {
    console.error('Usage: node runtime/runner/index.ts <agentId> <input>');
    process.exit(2);
  }

  const [agentId, ...rest] = argv;
  const input = rest.join(' ');

  // Dynamic import so this file can be run with ts-node or compiled to JS
  try {
    let mod;
    try {
      mod = await import('../../consumers/agent-executor');
    } catch {
      const targetPath = path.resolve(__dirname, '../../consumers/agent-executor.ts');
      mod = require(targetPath);
    }
    if (typeof mod.executeAgentLocally !== 'function') {
      console.error('consumers/agent-executor does not export executeAgentLocally');
      process.exit(1);
    }

    console.log(`Running local agent ${agentId}...`);
    const res = await mod.executeAgentLocally(agentId, input, { requestId: `local-${Date.now()}` });
    console.log('--- RESULT ---');
    console.log('requestId:', res.requestId);
    console.log('latencyMs:', res.latencyMs);
    console.log('output:\n', res.output);
    process.exit(0);
  } catch (err) {
    console.error('Runner error:', err);
    process.exit(1);
  }
}

main();
