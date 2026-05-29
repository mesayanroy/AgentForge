/**
 * consumers/agent-executor.ts
 *
 * Listens on `agentforge.payment.confirmed`.
 *
 * For each confirmed payment it:
 *  1. Fetches the agent record from Supabase.
 *  2. Calls the appropriate AI model (OpenAI / Anthropic).
 *  3. Writes the request record to `agent_requests` in Supabase.
 *  4. Publishes `agentforge.agent.completed` for downstream consumers.
 */

import { createClient } from '@supabase/supabase-js';
import { createConsumer, publish, TOPICS } from '../lib/qstash';
import { getDemoAgentById } from '../lib/demo-agents';
import type { PaymentConfirmedEvent, AgentCompletedEvent } from '../types/events';

import fs from 'node:fs';
import path from 'node:path';

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

const CONSUMER_GROUP = 'agentforge-agent-executor';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

function getSupabase() {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase is not configured for the agent executor.');
  }
  return createClient(supabaseUrl, supabaseServiceKey);
}

async function fetchAgent(agentId: string) {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('agents').select('*').eq('id', agentId).single();
    if (!error && data) {
      return data as {
        id: string;
        name: string;
        owner_wallet: string;
        model: string;
        system_prompt: string;
        price_xlm: number;
        total_requests: number;
        total_earned_xlm: number;
      };
    }
  } catch (err) {
    console.warn(`[AgentExecutor] Supabase fetch failed for ${agentId}; falling back to demo agent:`, err);
  }

  const demo = getDemoAgentById(agentId);
  if (demo) {
    return {
      id: demo.id,
      name: demo.name,
      owner_wallet: demo.owner_wallet,
      model: demo.model,
      system_prompt: demo.system_prompt,
      price_xlm: demo.price_xlm,
      total_requests: demo.total_requests,
      total_earned_xlm: demo.total_earned_xlm,
    };
  }

  throw new Error(`Agent ${agentId} not found`);
}

async function runModel(model: string, systemPrompt: string, input: string): Promise<string> {
  if (model === 'mock-echo') {
    const normalizedInput = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
    return JSON.stringify(
      {
        model,
        summary: normalizedInput.slice(0, 180),
        prompt: systemPrompt.slice(0, 120),
      },
      null,
      2
    );
  }

  if (model === 'openai-gpt4o-mini') {
    // Dynamic import keeps the consumer file lightweight
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ],
      max_tokens: 1024,
    });
    return res.choices[0]?.message?.content ?? '';
  }

  if (model === 'anthropic-claude-haiku') {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: 'claude-haiku-20240307',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: input }],
    });
    const block = res.content[0];
    return block?.type === 'text' ? block.text : '';
  }

  throw new Error(`Unknown model: ${model}`);
}

const consumer = createConsumer<PaymentConfirmedEvent>(
  CONSUMER_GROUP,
  TOPICS.PAYMENT_CONFIRMED,
  async (event) => {
    const { requestId, agentId, txHash, callerWallet, ownerWallet, priceXlm, input, confirmedAt } =
      event;

    console.log(`[AgentExecutor] Executing agent ${agentId} for request ${requestId}`);
    const startTime = Date.now();

    let agent;
    try {
      agent = await fetchAgent(agentId);
    } catch (err) {
      console.error(`[AgentExecutor] Cannot fetch agent ${agentId}:`, err);
      return;
    }

    let output: string;
    try {
      output = await runModel(agent.model, agent.system_prompt, input);
    } catch (err) {
      console.error(`[AgentExecutor] Model error for request ${requestId}:`, err);
      return;
    }

    const latencyMs = Date.now() - startTime;

    // Persist request record
    try {
      const sb = getSupabase();
      await sb.from('agent_requests').insert({
        id: requestId,
        agent_id: agentId,
        caller_wallet: callerWallet || null,
        input_payload: { input },
        output_response: { output },
        payment_tx_hash: txHash,
        payment_amount_xlm: priceXlm,
        protocol: '0x402',
        status: 'success',
        latency_ms: latencyMs,
        created_at: confirmedAt,
      });
    } catch (err) {
      console.error(`[AgentExecutor] DB insert error for ${requestId}:`, err);
      // Continue – billing + feed should still fire
    }

    const completed: AgentCompletedEvent = {
      requestId,
      agentId,
      model: agent.model,
      callerWallet,
      ownerWallet,
      priceXlm,
      input,
      output,
      latencyMs,
      txHash,
      completedAt: new Date().toISOString(),
    };

    await publish(TOPICS.AGENT_COMPLETED, completed);
    console.log(`[AgentExecutor] Published agent.completed for request ${requestId} (${latencyMs}ms)`);
  }
);

export default consumer;

// Export a lightweight local executor so the CLI/runtime can reuse the same
// model execution and persistence logic in development mode.
export async function executeAgentLocally(
  agentId: string,
  input: string,
  opts?: { requestId?: string; callerWallet?: string; priceXlm?: number }
) {
  const requestId = opts?.requestId ?? `local-${Date.now()}`;

  let agent;
  try {
    agent = await fetchAgent(agentId);
  } catch (err) {
    throw new Error(`Cannot fetch agent ${agentId}: ${String(err)}`);
  }

  let output: string;
  const startTime = Date.now();
  try {
    output = await runModel(agent.model, agent.system_prompt, input);
  } catch (err) {
    throw new Error(`Model error: ${String(err)}`);
  }

  const latencyMs = Date.now() - startTime;

  try {
    const sb = getSupabase();
    await sb.from('agent_requests').insert({
      id: requestId,
      agent_id: agentId,
      caller_wallet: opts?.callerWallet || null,
      input_payload: { input },
      output_response: { output },
      payment_tx_hash: null,
      payment_amount_xlm: opts?.priceXlm ?? agent.price_xlm,
      protocol: 'local-dev',
      status: 'success',
      latency_ms: latencyMs,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    // Ignore persistence failures in local mode but log
    console.warn('[AgentExecutor.local] DB insert failed:', err);
  }

  const completed: AgentCompletedEvent = {
    requestId,
    agentId,
    model: agent.model,
    callerWallet: opts?.callerWallet ?? '',
    ownerWallet: agent.owner_wallet,
    priceXlm: opts?.priceXlm ?? agent.price_xlm,
    input,
    output,
    latencyMs,
    txHash: '',
    completedAt: new Date().toISOString(),
  };

  try {
    await publish(TOPICS.AGENT_COMPLETED, completed);
  } catch (err) {
    console.warn('[AgentExecutor.local] publish failed:', err);
  }

  return { requestId, output, latencyMs };
}
