/**
 * Worker process entry point.
 * Starts the provider worker, buyer-agent verifier, and event indexer.
 * Exits on unhandled errors so a supervisor (e.g. PM2, Docker restart policy)
 * can restart cleanly.
 */
import { Pool } from "pg";
import { ProviderWorker } from "./provider-worker";
import { BuyerAgent }     from "./buyer-agent";
import { EventIndexer }   from "./event-indexer";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[Worker] DATABASE_URL is not set — exiting");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

async function getProviderAgentId(): Promise<string | null> {
  const { rows } = await pool.query(
    "SELECT id FROM agents WHERE role='provider' AND is_active=true LIMIT 1",
  );
  return rows[0]?.id ?? null;
}

async function getDeploymentBlock(): Promise<bigint> {
  // Resolve the deployment block from the first TaskCreated event, or fall back
  // to a bounded lookback so we never scan from genesis.
  const { createPublic } = await import("./chain/client");
  const client = createPublic();
  const head   = await client.getBlockNumber();

  // If the DB has any task with a create_tx_hash, resolve the deployment block
  const { rows } = await pool.query(
    "SELECT create_tx_hash FROM tasks WHERE create_tx_hash IS NOT NULL LIMIT 1",
  );
  if (rows[0]?.create_tx_hash) {
    try {
      const receipt = await client.getTransactionReceipt({
        hash: rows[0].create_tx_hash as `0x${string}`,
      });
      if (receipt?.blockNumber) {
        console.log(`[EventIndexer] Resolved deployment block: ${receipt.blockNumber}`);
        return receipt.blockNumber;
      }
    } catch {
      // Receipt not found — fall back to recent-only scan
    }
  }

  // Default: scan the last 5,000 blocks (recent activity only)
  const lookback = 5_000n;
  const start    = head > lookback ? head - lookback : 0n;
  console.log(`[EventIndexer] No deployment block resolved; scanning from block ${start} (head - ${lookback})`);
  return start;
}

async function main() {
  console.log("[Worker] Starting AgetBazar worker…");

  const providerAgentId = await getProviderAgentId();
  if (!providerAgentId) {
    console.warn("[Worker] No active provider agent found — provider worker disabled");
  }

  const deploymentBlock = await getDeploymentBlock();

  const indexer = new EventIndexer(pool, deploymentBlock);
  indexer.start();

  if (providerAgentId) {
    const providerWorker = new ProviderWorker(pool, providerAgentId);
    providerWorker.start();
  }

  const buyerAgent = new BuyerAgent(pool);
  buyerAgent.start();

  process.on("SIGTERM", async () => {
    console.log("[Worker] SIGTERM received — shutting down");
    await pool.end();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[Worker] Fatal startup error:", err);
  process.exit(1);
});
