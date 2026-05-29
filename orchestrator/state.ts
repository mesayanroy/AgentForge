import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function getSupabase() {
  if (!supabaseUrl || !supabaseKey) return null;
  return createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
}

export async function createRunRecord(workflowName: string, payload: any) {
  const sb = getSupabase();
  if (!sb) return null;
  const runId = uuidv4();
  try {
    await sb.from('workflow_runs').insert({ id: runId, name: workflowName, payload, status: 'running', created_at: new Date().toISOString() });
    return runId;
  } catch (err) {
    console.warn('[orchestrator.state] createRunRecord failed', err);
    return null;
  }
}

export async function updateRunStatus(runId: string, status: string) {
  const sb = getSupabase();
  if (!sb || !runId) return false;
  try {
    await sb.from('workflow_runs').update({ status, updated_at: new Date().toISOString() }).eq('id', runId);
    return true;
  } catch (err) {
    console.warn('[orchestrator.state] updateRunStatus failed', err);
    return false;
  }
}

export async function insertStepRecord(runId: string, stepId: string, results: any, status: string) {
  const sb = getSupabase();
  if (!sb || !runId) return null;
  try {
    await sb.from('workflow_steps').insert({ id: uuidv4(), run_id: runId, step_id: stepId, results, status, created_at: new Date().toISOString() });
    return true;
  } catch (err) {
    console.warn('[orchestrator.state] insertStepRecord failed', err);
    return null;
  }
}
