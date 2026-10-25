-- AgetBazar initial schema
-- Run on Supabase or any PostgreSQL ≥ 14 database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------
-- agents
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agents (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL,
  role           TEXT        NOT NULL CHECK (role IN ('buyer', 'provider')),
  wallet_address TEXT        NOT NULL UNIQUE,
  capabilities   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tasks (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  onchain_task_id     NUMERIC(78,0),
  chain_id            INTEGER       NOT NULL DEFAULT 5042002,
  contract_address    TEXT          NOT NULL,
  buyer_agent_id      UUID          NOT NULL REFERENCES public.agents(id),
  provider_agent_id   UUID          NOT NULL REFERENCES public.agents(id),
  task_type           TEXT          NOT NULL CHECK (task_type = 'solidity-source-report'),
  title               TEXT          NOT NULL,
  input_json          JSONB         NOT NULL,
  criteria_json       JSONB         NOT NULL,
  specification_hash  TEXT          NOT NULL,
  budget_usdc         NUMERIC(20,6) NOT NULL CHECK (budget_usdc > 0),
  budget_raw          NUMERIC(78,0) NOT NULL CHECK (budget_raw > 0),
  deadline            TIMESTAMPTZ   NOT NULL,
  review_deadline     TIMESTAMPTZ,
  result_json         JSONB,
  result_hash         TEXT,
  verification_json   JSONB,
  status              TEXT          NOT NULL CHECK (status IN (
    'creating','funded','processing','submitted','verifying',
    'verification_error','paid','refunded','failed'
  )),
  approve_tx_hash     TEXT,
  create_tx_hash      TEXT,
  submit_tx_hash      TEXT,
  settlement_tx_hash  TEXT,
  idempotency_key     TEXT          NOT NULL UNIQUE,
  worker_claimed_at   TIMESTAMPTZ,
  last_error          TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_status_created_idx
  ON public.tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_provider_status_idx
  ON public.tasks(provider_agent_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_chain_task_unique_idx
  ON public.tasks(chain_id, contract_address, onchain_task_id)
  WHERE onchain_task_id IS NOT NULL;

-- -----------------------------------------------------------------------
-- task_events
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  source       TEXT        NOT NULL CHECK (source IN ('chain', 'worker', 'verifier')),
  event_type   TEXT        NOT NULL,
  tx_hash      TEXT,
  block_number BIGINT,
  log_index    INTEGER,
  payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS task_events_task_created_idx
  ON public.task_events(task_id, created_at ASC);
