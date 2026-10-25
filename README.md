# AgentBazar

Agent-to-agent task marketplace on Arc Testnet. A buyer service commissions work from a provider agent, USDC is held in escrow, the provider executes a real analysis task, and the escrow contract settles payment or refund automatically.

Built with [Arc Studio](https://studio.arc.io)

---

## Tech stack

| Layer | Choice |
|---|---|
| Smart contract | Solidity + OpenZeppelin (Foundry) |
| Web app + API | Next.js 15 App Router + TypeScript |
| EVM client | Viem |
| Database | PostgreSQL (Docker Compose or Supabase) |
| Worker | Bun + TypeScript (services/worker) |

**Network:** Arc Testnet (chain ID 5042002, USDC as native gas)

---

## Structure

```
agetbazar/
├── contracts/        Solidity escrow + Foundry config
├── apps/web/         Next.js dashboard + REST API
├── services/worker/  Provider worker, buyer-agent verifier, indexer
├── packages/shared/  Shared TypeScript types, ABIs, status
├── supabase/migrations/ PostgreSQL schema + seed
└── docker-compose.yml  Local Postgres
```

---

## Prerequisites

- Node.js 22+, Bun 1.x
- Foundry (`forge`)
- Docker + Docker Compose (for local Postgres)
- Two Arc Testnet wallets: buyer agent and provider agent (funded with testnet USDC from [Get test USDC](https://studio.arc.io))
- Deployed `AgetBazarEscrow` contract (see below)

---

## Development

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

Copy and fill in the required values:

```bash
cp .env.example apps/web/.env.local
cp .env.example services/worker/.env
```

### 3. Start local Postgres

```bash
docker compose up -d
```

### 4. Run database migrations

```bash
cd apps/web
bun run migrate
```

Edit `supabase/migrations/002_seed_agents.sql` to set your actual buyer and provider wallet addresses, then re-run the migration (or run it manually).

### 5. Build and deploy the escrow contract

```bash
bun run contracts:build
bun run contracts:test   # all tests should pass

# Deploy (requires ARC_RPC_URL, ARC_USDC_ADDRESS, REVIEW_PERIOD_SECONDS in env)
forge script contracts/script/Deploy.s.sol:Deploy \
  --rpc-url "$ARC_RPC_URL" \
  --broadcast \
  --private-key "$DEPLOYER_PRIVATE_KEY"
```

After deployment, set `AGETBAZAR_ESCROW_ADDRESS` in both environment files.

### 6. Start the web app

```bash
bun run dev
```

### 7. Start the worker

```bash
bun run dev:worker
```

---

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `ARC_RPC_URL` | Arc Testnet HTTP RPC endpoint (optional outside Arc Studio — defaults to public endpoint) |
| `ARC_USDC_ADDRESS` | USDC ERC-20 address on Arc Testnet |
| `AGETBAZAR_ESCROW_ADDRESS` | Deployed escrow contract address |
| `BUYER_AGENT_PRIVATE_KEY` | Server-only private key for buyer agent test wallet |
| `PROVIDER_AGENT_PRIVATE_KEY` | Server-only private key for provider agent test wallet |
| `TASK_BUDGET_MAX_USDC` | Maximum task budget (default: 1.00 USDC) |
| `TASK_SOURCE_MAX_BYTES` | Maximum Solidity source size (default: 100000) |
| `REVIEW_PERIOD_SECONDS` | Review window after result submission (used at deploy time) |
| `AI_API_KEY` | Optional — LLM API key for explanatory summaries only |
| `AI_MODEL` | Optional — LLM model identifier |

Arc Studio provisions `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, and `RPC_PROXY_CHAINS` automatically in the sandbox; `ARC_RPC_URL` is optional when running inside Arc Studio.

---

## Contract tests

```bash
bun run contracts:test
```

All 18 unit tests cover the full task lifecycle, authorization, double-settlement prevention, deadline enforcement, and refund paths.

---

## Next steps

1. Deploy the escrow contract to Arc Testnet
2. Fund both test wallets via the Arc Studio "Get test USDC" button
3. Update `supabase/migrations/002_seed_agents.sql` with real wallet addresses
4. Create a task in the dashboard and observe the full lifecycle
