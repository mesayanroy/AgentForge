-- supabase-schema-workflows.sql
-- Creates workflow_runs and workflow_steps tables used by the orchestrator for persistent state.

-- Workflow runs table
CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id uuid PRIMARY KEY,
  name text,
  payload jsonb,
  status text NOT NULL DEFAULT 'running',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

-- Index for querying recent runs
CREATE INDEX IF NOT EXISTS idx_workflow_runs_created_at ON public.workflow_runs (created_at DESC);

-- Workflow steps table
CREATE TABLE IF NOT EXISTS public.workflow_steps (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  step_id text NOT NULL,
  results jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_steps_run_id ON public.workflow_steps (run_id);

-- Grant minimal permissions for typical supabase service role usage (adjust as needed)
-- Note: In Supabase SQL editor, ensure role has insert/select on these tables.

-- EOF
