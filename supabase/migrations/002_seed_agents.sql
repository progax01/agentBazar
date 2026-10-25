-- Seed the two configured agent wallets.
-- Replace the wallet addresses with the actual test wallet addresses before running.
-- NEVER store private keys in this file.

INSERT INTO public.agents (name, role, wallet_address, capabilities, is_active)
VALUES
  (
    'Buyer Agent',
    'buyer',
    '0xFE4F90C23DCAb838bb608E3129a82c7869FA32a8', -- REPLACE with real buyer wallet address
    '["solidity-source-report"]',
    true
  ),
  (
    'Solidity Report Agent',
    'provider',
    '0x3F125fAbb558fd8083E8610800464F7Ae50bEc76', -- REPLACE with real provider wallet address
    '["solidity-source-report"]',
    true
  )
ON CONFLICT (wallet_address) DO NOTHING;
