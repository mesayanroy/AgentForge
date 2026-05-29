#!/usr/bin/env node
// Small HTTP runner that calls the AgentForge API to execute an agent.
// Usage: node runner-http.js <agentId> "input text"

const [,, agentId, ...rest] = process.argv;
if (!agentId) {
  console.error('Usage: node runner-http.js <agentId> <input>');
  process.exit(2);
}
const input = rest.join(' ');
const API_BASE = process.env.AGENTFORGE_API_URL || process.env.NEXT_PUBLIC_AGENTFORGE_API_URL || 'http://host.docker.internal:3000';

(async function(){
  try {
    const res = await fetch(`${API_BASE}/api/agents/${agentId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    });

    const data = await res.json();
    console.log('STATUS:', res.status);
    console.log(JSON.stringify(data, null, 2));
    process.exit(res.ok ? 0 : 1);
  } catch (err) {
    console.error('Runner HTTP error:', err);
    process.exit(1);
  }
})();
