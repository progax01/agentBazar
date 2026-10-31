-- Migration 006: reduce service prices to minimum viable amounts.
-- audit:        0.50 USDC → 0.01 USDC  (price_raw: 500000 → 10000)
-- capabilities: 0.01 USDC → 0.001 USDC (price_raw: 10000  → 1000)

UPDATE public.services
SET price_raw  = '10000',
    price_usdc = 0.01,
    description = regexp_replace(description, 'Pay [0-9.]+ USDC per call', 'Pay 0.01 USDC per call')
WHERE endpoint_url LIKE '%/api/paid/audit%';

UPDATE public.services
SET price_raw  = '1000',
    price_usdc = 0.001,
    description = regexp_replace(description, 'Pay [0-9.]+ USDC per call', 'Pay 0.001 USDC per call')
WHERE endpoint_url LIKE '%/api/paid/capabilities%'
   OR endpoint_url LIKE '%/api/paid/analysis-capabilities%';
