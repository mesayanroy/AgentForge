import type { Agent } from '@/types';
import fs from 'node:fs';
import path from 'node:path';

type DemoAgentInput = {
  id: string;
  owner_wallet: string;
  name: string;
  description?: string;
  tags?: string[];
  model: Agent['model'];
  system_prompt: string;
  tools?: string[];
  price_xlm: number;
  visibility?: Agent['visibility'];
  api_endpoint?: string;
  api_key?: string;
};

const nowIso = () => new Date().toISOString();
const STORE_PATH = path.join(process.cwd(), '.agent-store.json');

function loadPersistedAgents(): Agent[] {
  try {
    if (!fs.existsSync(STORE_PATH)) return [];
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    if (!raw.trim()) return [];

    const parsed = JSON.parse(raw) as { agents?: Agent[] };
    return Array.isArray(parsed.agents) ? parsed.agents : [];
  } catch (err) {
    console.warn('[demo-agents] Failed to read persisted store:', err);
    return [];
  }
}

function persistAgents(map: Map<string, Agent>): void {
  try {
    const payload = JSON.stringify({ agents: Array.from(map.values()) }, null, 2);
    fs.writeFileSync(STORE_PATH, payload, 'utf8');
  } catch (err) {
    console.warn('[demo-agents] Failed to persist store:', err);
  }
}

const demoAgents = new Map<string, Agent>([
  [
    '1',
    {
      id: '1',
      owner_wallet: 'GBZTWIV3ISK4KRBHP2BUVUB4PVZ6CK3AWBYLQLAI2JKVX45U63CO4PLW',
      name: 'DeFi Analyst',
      description: 'Analyzes DeFi protocols, yields, and on-chain metrics in real time.',
      tags: ['web3', 'finance', 'defi'],
      model: 'openai-gpt4o-mini',
      system_prompt: 'You are a DeFi analyst...',
      tools: ['on_chain_data', 'web_search'],
      price_xlm: 0.05,
      visibility: 'public',
      api_endpoint: 'https://agentforge.dev/api/agents/1/run',
      total_requests: 1420,
      total_earned_xlm: 71,
      is_active: true,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
  ],
  [
    'demo-echo',
    {
      id: 'demo-echo',
      owner_wallet: 'GBZTWIV3ISK4KRBHP2BUVUB4PVZ6CK3AWBYLQLAI2JKVX45U63CO4PLW',
      name: 'Demo Echo',
      description: 'Deterministic local demo agent used for workflow templating smoke tests.',
      tags: ['demo', 'workflow', 'mock'],
      model: 'mock-echo',
      system_prompt: 'Echo back the input in a concise structured form.',
      tools: [],
      price_xlm: 0,
      visibility: 'public',
      api_endpoint: 'http://localhost:3000/api/agents/demo-echo/run',
      total_requests: 0,
      total_earned_xlm: 0,
      is_active: true,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
  ],
]);

for (const persisted of loadPersistedAgents()) {
  demoAgents.set(persisted.id, persisted);
}

export function getDemoAgentById(id: string): Agent | null {
  return demoAgents.get(id) ?? null;
}

export function listDemoAgents(filters?: { owner?: string; model?: string; tag?: string; limit?: number }): Agent[] {
  const { owner, model, tag, limit = 50 } = filters ?? {};

  const rows = Array.from(demoAgents.values())
    .filter((agent) => agent.is_active)
    .filter((agent) => (owner ? agent.owner_wallet === owner : agent.visibility === 'public'))
    .filter((agent) => (model ? agent.model === model : true))
    .filter((agent) => (tag ? (agent.tags ?? []).includes(tag) : true))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return rows.slice(0, limit);
}

export function upsertDemoAgent(input: DemoAgentInput): Agent {
  const existing = demoAgents.get(input.id);

  const next: Agent = {
    id: input.id,
    owner_wallet: input.owner_wallet,
    name: input.name,
    description: input.description ?? existing?.description ?? '',
    tags: input.tags ?? existing?.tags ?? [],
    model: input.model,
    system_prompt: input.system_prompt,
    tools: input.tools ?? existing?.tools ?? [],
    price_xlm: input.price_xlm,
    visibility: input.visibility ?? existing?.visibility ?? 'public',
    api_endpoint: input.api_endpoint ?? existing?.api_endpoint,
    api_key: input.api_key ?? existing?.api_key,
    total_requests: existing?.total_requests ?? 0,
    total_earned_xlm: existing?.total_earned_xlm ?? 0,
    is_active: existing?.is_active ?? true,
    created_at: existing?.created_at ?? nowIso(),
    updated_at: nowIso(),
  };

  demoAgents.set(input.id, next);
  persistAgents(demoAgents);
  return next;
}

export function incrementDemoAgentStats(id: string, opts: { paid: boolean; amountXlm: number }): void {
  const found = demoAgents.get(id);
  if (!found) return;

  found.total_requests += 1;
  if (opts.paid) {
    found.total_earned_xlm += opts.amountXlm;
  }
  found.updated_at = nowIso();
  demoAgents.set(id, found);
  persistAgents(demoAgents);
}

export function deactivateDemoAgent(id: string, ownerWallet: string): { ok: boolean; reason?: string } {
  const found = demoAgents.get(id);
  if (!found) return { ok: false, reason: 'not_found' };
  if (found.owner_wallet !== ownerWallet) return { ok: false, reason: 'forbidden' };
  found.is_active = false;
  found.updated_at = nowIso();
  demoAgents.set(id, found);
  persistAgents(demoAgents);
  return { ok: true };
}
