-- Migration 004: seed the paid x402 capabilities and full-audit services.
-- Requires: 001_initial.sql, 002_seed_agents.sql, 003_service_payments.sql
-- The URLs must be reachable from the Next.js server.

-- Upgrade rows created by the previous version of this seed.
UPDATE public.services
SET name = 'Solidity Analysis Capabilities',
    endpoint_url = 'http://localhost:4021/api/paid/capabilities',
    endpoint_method = 'GET'
WHERE endpoint_url = 'http://localhost:4021/api/paid/analysis-capabilities';

INSERT INTO public.services (
  name, description, agent_id, endpoint_url, endpoint_method,
  payment_mode, network, asset_address, price_raw, price_usdc,
  pay_to_address, facilitator_url, capabilities
)
SELECT
  'Solidity Analysis Capabilities',
  'Returns the full list of supported Solidity security checks and capabilities. Pay 0.01 USDC per call via x402 on Arc Testnet.',
  a.id,
  'http://localhost:4021/api/paid/capabilities',
  'GET',
  'x402',
  'eip155:5042002',
  '0x3600000000000000000000000000000000000000',
  '10000',
  0.01,
  a.wallet_address,
  'https://facilitator.arcusnetwork.co',
  '["solidity-security-audit","blockrun-ai-analysis","slither-static-analysis","solc-compilation-check","finding-correlation","risk-scoring"]'::jsonb
FROM public.agents a
WHERE a.role = 'provider' AND a.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.services s
    WHERE s.agent_id = a.id
      AND s.endpoint_url = 'http://localhost:4021/api/paid/capabilities'
      AND s.network = 'eip155:5042002'
  );
INSERT INTO public.services (
  name, description, agent_id, endpoint_url, endpoint_method,
  payment_mode, network, asset_address, price_raw, price_usdc,
  pay_to_address, facilitator_url, capabilities
)
SELECT
  'Solidity Full Audit',
  'Full security audit using solc, Slither, and BlockRun AI. Submit Solidity source code and receive findings with risk scoring. Pay 0.50 USDC per call via x402 on Arc Testnet.',
  a.id,
  'http://localhost:4021/api/paid/audit',
  'POST',
  'x402',
  'eip155:5042002',
  '0x3600000000000000000000000000000000000000',
  '500000',
  0.50,
  a.wallet_address,
  'https://facilitator.arcusnetwork.co',
  '["solidity-security-audit","blockrun-ai-analysis","slither-static-analysis","solc-compilation-check","finding-correlation","risk-scoring"]'::jsonb
FROM public.agents a
WHERE a.role = 'provider' AND a.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.services s
    WHERE s.agent_id = a.id
      AND s.endpoint_url = 'http://localhost:4021/api/paid/audit'
      AND s.network = 'eip155:5042002'
  );

INSERT INTO public.services (
  name, description, agent_id, endpoint_url, endpoint_method,
  payment_mode, network, asset_address, price_raw, price_usdc,
  pay_to_address, facilitator_url, capabilities
)
SELECT
  'Solidity Analysis Capabilities',
  'Returns the full list of supported Solidity security checks and capabilities. Pay 0.01 USDC per call via x402 on Arc Mainnet.',
  a.id,
  'http://localhost:4021/api/paid/capabilities',
  'GET',
  'x402',
  'eip155:5042',
  '0x3600000000000000000000000000000000000000',
  '10000',
  0.01,
  a.wallet_address,
  'https://facilitator.arcusnetwork.co',
  '["solidity-security-audit","blockrun-ai-analysis","slither-static-analysis","solc-compilation-check","finding-correlation","risk-scoring"]'::jsonb
FROM public.agents a
WHERE a.role = 'provider' AND a.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.services s
    WHERE s.agent_id = a.id
      AND s.endpoint_url = 'http://localhost:4021/api/paid/capabilities'
      AND s.network = 'eip155:5042'
  );

INSERT INTO public.services (
  name, description, agent_id, endpoint_url, endpoint_method,
  payment_mode, network, asset_address, price_raw, price_usdc,
  pay_to_address, facilitator_url, capabilities
)
SELECT
  'Solidity Full Audit',
  'Full security audit using solc, Slither, and BlockRun AI. Submit Solidity source code and receive findings with risk scoring. Pay 0.50 USDC per call via x402 on Arc Mainnet.',
  a.id,
  'http://localhost:4021/api/paid/audit',
  'POST',
  'x402',
  'eip155:5042',
  '0x3600000000000000000000000000000000000000',
  '500000',
  0.50,
  a.wallet_address,
  'https://facilitator.arcusnetwork.co',
  '["solidity-security-audit","blockrun-ai-analysis","slither-static-analysis","solc-compilation-check","finding-correlation","risk-scoring"]'::jsonb
FROM public.agents a
WHERE a.role = 'provider' AND a.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.services s
    WHERE s.agent_id = a.id
      AND s.endpoint_url = 'http://localhost:4021/api/paid/audit'
      AND s.network = 'eip155:5042'
  );
