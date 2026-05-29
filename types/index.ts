export interface User {
  id: string;
  wallet_address: string;
  username?: string;
  bio?: string;
  created_at: string;
}

export interface Agent {
  id: string;
  owner_wallet: string;
  name: string;
  description?: string;
  tags?: string[];
  model: 'openai-gpt4o-mini' | 'anthropic-claude-haiku' | 'mock-echo';
  system_prompt: string;
  tools: string[];
  price_xlm: number;
  visibility: 'public' | 'private' | 'forked';
  forked_from?: string;
  api_endpoint?: string;
  api_key?: string;
  soroban_contract_id?: string;
  on_chain_node_id?: string;
  total_requests: number;
  total_earned_xlm: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentRequest {
  id: string;
  agent_id: string;
  caller_wallet?: string;
  caller_ip?: string;
  input_payload?: Record<string, unknown>;
  output_response?: Record<string, unknown>;
  payment_tx_hash?: string;
  payment_amount_xlm?: number;
  protocol: string;
  status: 'success' | 'failed' | 'pending';
  latency_ms?: number;
  created_at: string;
}

export interface AgentFork {
  id: string;
  original_agent_id: string;
  forked_agent_id: string;
  forked_by_wallet: string;
  created_at: string;
}

export interface ApiKey {
  id: string;
  agent_id: string;
  owner_wallet: string;
  key_hash: string;
  label?: string;
  last_used?: string;
  is_active: boolean;
  created_at: string;
}

export interface PaymentRequiredHeaders {
  'X-Payment-Required': string;
  'X-Payment-Amount': string;
  'X-Payment-Address': string;
  'X-Payment-Network': string;
  'X-Payment-Memo': string;
}

export interface PaymentSubmitHeaders {
  'X-Payment-Tx-Hash': string;
  'X-Payment-Wallet': string;
}
