-- Migration 004: seed the x402 paid analysis-capabilities service.
-- Requires: 001_initial.sql, 002_seed_agents.sql, 003_service_payments.sql
--
-- NOTE: endpoint_url points to localhost:4021.
-- If the x402 server runs on a different host, UPDATE services SET endpoint_url=... after seeding.
-- The buyer agent (Next.js server) calls this URL directly, so it must be reachable from the server
-- running apps/web (not the user's browser).

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
  '["solidity-source-report","reentrancy-detection","access-control-audit"]'::jsonb
FROM public.agents a
WHERE a.role = 'provider' AND a.is_active = true
LIMIT 1
ON CONFLICT DO NOTHING;

-- Seed the full audit service (POST /api/paid/audit, 0.50 USDC)
INSERT INTO public.services (
  name, description, agent_id, endpoint_url, endpoint_method,
  payment_mode, network, asset_address, price_raw, price_usdc,
  pay_to_address, facilitator_url, capabilities
)
SELECT
  'Solidity Full Audit',
  'Full security audit: solc compilation, Slither static analysis, BlockRun AI analysis, finding correlation, risk scoring (0–100). 0.50 USDC per call via x402 on Arc Testnet.',
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
LIMIT 1
ON CONFLICT DO NOTHING;
