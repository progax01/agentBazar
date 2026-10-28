-- Migration 003: service_payments and services registry
-- Supports x402 per-request payments and Gateway nanopayments.

-- -----------------------------------------------------------------------
-- services (registered paid providers)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.services (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,
  description     TEXT        NOT NULL DEFAULT '',
  agent_id        UUID        NOT NULL REFERENCES public.agents(id),
  endpoint_url    TEXT        NOT NULL,
  endpoint_method TEXT        NOT NULL DEFAULT 'GET',
  payment_mode    TEXT        NOT NULL CHECK (payment_mode IN ('x402','gateway_nanopayment','escrow')),
  network         TEXT        NOT NULL DEFAULT 'eip155:5042002',
  asset_address   TEXT        NOT NULL,
  price_raw       TEXT        NOT NULL,   -- exact amount in asset decimals (string to avoid precision loss)
  price_usdc      NUMERIC(20,6) NOT NULL,
  pay_to_address  TEXT        NOT NULL,
  facilitator_url TEXT        NOT NULL DEFAULT 'https://facilitator.arcusnetwork.co',
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  capabilities    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------
-- service_payments (one row per x402/gateway invocation)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_payments (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             UUID        REFERENCES public.tasks(id) ON DELETE SET NULL,
  buyer_agent_id      UUID        NOT NULL REFERENCES public.agents(id),
  provider_agent_id   UUID        NOT NULL REFERENCES public.agents(id),
  service_id          UUID        NOT NULL REFERENCES public.services(id),
  payment_mode        TEXT        NOT NULL CHECK (payment_mode IN ('x402','gateway_nanopayment','escrow')),
  network             TEXT        NOT NULL,
  asset_address       TEXT        NOT NULL,
  amount_raw          TEXT        NOT NULL,
  pay_to_address      TEXT        NOT NULL,
  status              TEXT        NOT NULL CHECK (status IN (
    'pending','quote_received','authorization_created','payment_verified',
    'executing','gateway_accepted','settlement_pending','settled','failed'
  )),
  facilitator         TEXT,
  tx_hash             TEXT,
  http_status         INTEGER,
  result_reference    TEXT,    -- JSON-encoded summary of the service response (no raw secrets)
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS service_payments_buyer_idx    ON public.service_payments(buyer_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS service_payments_service_idx  ON public.service_payments(service_id, created_at DESC);
CREATE INDEX IF NOT EXISTS service_payments_task_idx     ON public.service_payments(task_id) WHERE task_id IS NOT NULL;
