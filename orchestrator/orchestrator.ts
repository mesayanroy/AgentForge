/**
 * orchestrator/orchestrator.ts
 *
 * Minimal workflow orchestrator prototype for Phase 1.
 * Workflow JSON format (example):
 * {
 *   "name": "Simple Workflow",
 *   "steps": [
 *     { "id": "s1", "agentId": "agent-1", "input": "Scan markets for X" },
 *     { "id": "s2", "agentId": "agent-2", "input": "Analyze results from s1" }
 *   ]
 * }
 */

import fs from 'fs';
import path from 'path';
import * as state from './state';

function loadEnvFile(filePath = path.join(process.cwd(), '.env.local')): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (key && (process.env[key] === undefined || process.env[key] === '')) {
        process.env[key] = value;
      }
    }
  } catch {
    // ignore
  }
}

loadEnvFile();

export interface WorkflowStep {
  id: string;
  agentId: string;
  input: string;
  dependsOn?: string[];
  retries?: number;
  retryDelayMs?: number;
}

export interface Workflow {
  name?: string;
  steps: WorkflowStep[];
}

export interface RunOptions {
  concurrency?: number;
  continueOnError?: boolean;
}

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export async function runWorkflowFile(filePath: string, opts: RunOptions = {}) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(abs, 'utf8');
  const wf = JSON.parse(raw) as Workflow;
  console.log(`Running workflow: ${wf.name ?? path.basename(filePath)}`);

  const runId = await state.createRunRecord(wf.name ?? path.basename(filePath), { file: filePath });

  const steps = wf.steps || [];
  const byId: Record<string, WorkflowStep> = {};
  for (const s of steps) byId[s.id] = s;

  const results: Record<string, any> = {};
  const running = new Set<string>();
  const completed = new Set<string>();
  const failed = new Set<string>();

  const concurrency = Math.max(1, opts.concurrency ?? 3);

  function readySteps() {
    return steps.filter((s) => {
      if (completed.has(s.id) || running.has(s.id) || failed.has(s.id)) return false;
      const deps = s.dependsOn || [];
      return deps.every((d) => completed.has(d) || failed.has(d));
    });
  }

  async function runStep(s: WorkflowStep) {
    running.add(s.id);
    const maxRetries = s.retries ?? 1;
    const retryDelay = s.retryDelayMs ?? 1000;
    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;
      try {
        // interpolate input using outputs from previous steps
        const interpolatedInput = interpolateInputStructured(s.input, results);

        const mod = await import('../consumers/agent-executor');
        if (typeof mod.executeAgentLocally !== 'function') throw new Error('Local executor not available');
        const res = await mod.executeAgentLocally(s.agentId, interpolatedInput, { requestId: `wf-${s.id}-${Date.now()}` });
        results[s.id] = { success: true, output: res.output, latencyMs: res.latencyMs };
        completed.add(s.id);
        running.delete(s.id);
        console.log(`   -> ${s.id} completed (${res.latencyMs}ms)`);

        // persist step record
        if (runId) await state.insertStepRecord(runId, s.id, results[s.id], 'success');
        return;
      } catch (err) {
        console.error(`   -> ${s.id} attempt ${attempt} failed:`, err);
        if (attempt < maxRetries) {
          await sleep(retryDelay);
          console.log(`   -> ${s.id} retrying (attempt ${attempt + 1}/${maxRetries})`);
        } else {
          failed.add(s.id);
          running.delete(s.id);
          results[s.id] = { success: false, error: String(err) };
          console.error(`   -> ${s.id} failed after ${attempt} attempts`);
          if (runId) await state.insertStepRecord(runId, s.id, results[s.id], 'failed');
          return;
        }
      }
    }
  }

  // Main driver loop
  while (completed.size + failed.size < steps.length) {
    const avail = readySteps();
    if (avail.length === 0) {
      // nothing ready yet — possibly circular dependency
      console.error('No ready steps found — possible circular dependency or blocked steps');
      break;
    }

    const toRun = avail.slice(0, Math.max(1, concurrency - running.size));
    await Promise.all(toRun.map((s) => runStep(s)));
  }

  // finalize
  if (runId) {
    await state.updateRunStatus(runId, failed.size > 0 ? 'failed' : 'completed');
  }

  return results;
}

// Simple template interpolation: replace {{steps.<id>.output}} or {{steps.<id>.latencyMs}}
function getPath(obj: any, pathStr: string) {
  const parts = pathStr.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(p);
      cur = cur[idx];
    } else {
      cur = cur[p];
    }
  }
  return cur;
}

function interpolateString(str: string, results: Record<string, any>) {
  return str.replace(/{{\s*steps\.([a-zA-Z0-9_.-]+)\s*}}/g, (_m, pathKey) => {
    const [stepId, ...rest] = pathKey.split('.');
    const keyPath = rest.join('.');
    const r = results[stepId];
    if (!r) return '';
    if (!keyPath) {
      // default to output
      const v = r.output ?? r;
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    const v = getPath(r, keyPath);
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  });
}

function interpolateInputStructured(input: any, results: Record<string, any>): any {
  if (typeof input === 'string') return interpolateString(input, results);
  if (input == null) return input;
  if (Array.isArray(input)) return input.map((v) => interpolateInputStructured(v, results));
  if (typeof input === 'object') {
    const out: any = {};
    for (const k of Object.keys(input)) {
      out[k] = interpolateInputStructured(input[k], results);
    }
    return out;
  }
  return input;
}
