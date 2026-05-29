#!/usr/bin/env ts-node
import path from 'path';

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    console.error('Usage: ts-node orchestrator/cli-runner.ts <workflow.json>');
    process.exit(2);
  }
  const [file] = argv;
  try {
    let orchestrator: any;
    try {
      orchestrator = require('./orchestrator');
    } catch (e1) {
      try {
        orchestrator = require('./orchestrator/orchestrator');
      } catch (e2) {
        // last resort: dynamic import
        orchestrator = await import('./orchestrator');
      }
    }
    const results = await orchestrator.runWorkflowFile(file);
    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Orchestrator runner failed:', err);
    process.exit(1);
  }
}

main();
