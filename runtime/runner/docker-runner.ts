#!/usr/bin/env node
/**
 * runtime/runner/docker-runner.ts
 *
 * Docker-based runner prototype. Runs a temporary Node container, mounts the
 * project workspace, and invokes the local runner script inside the container.
 *
 * Usage: node runtime/runner/docker-runner.ts <agentId> "input text"
 */

import { spawnSync } from 'child_process';
import path from 'path';

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2) {
    console.error('Usage: node runtime/runner/docker-runner.ts <agentId> <input>');
    process.exit(2);
  }

  const [agentId, ...rest] = argv;
  const input = rest.join(' ');
  const workspace = process.cwd();

  // Build the docker command
  const runnerCmd = `node ${path.posix.join('/workspace', 'runtime', 'runner', 'index.ts')} ${agentId} ${JSON.stringify(input)}`;

  const args = [
    'run',
    '--rm',
    '-v',
    `${workspace}:/workspace`,
    '-w',
    '/workspace',
    'node:18-bullseye-slim',
    'sh',
    '-lc',
    `npx -y ts-node --project tsconfig.json ${path.posix.join('runtime','runner','index.ts')} ${agentId} ${JSON.stringify(input)}`,
  ];

  console.log('Spawning docker:', 'docker', args.join(' '));
  const res = spawnSync('docker', args, { stdio: 'inherit' });
  if (res.error) {
    console.error('Docker spawn error:', res.error);
    process.exit(1);
  }
  process.exit(res.status ?? 0);
}

main();
