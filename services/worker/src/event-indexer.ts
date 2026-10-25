/**
 * Event indexer / reconciler.
 * Scans contract logs from the deployment block forward and keeps the DB
 * in sync with the on-chain state.
 */
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { escrowAbi } from "@agetbazar/shared";
import { createPublic, ESCROW_ADDRESS } from "./chain/client";
import type { Log } from "viem";

const BATCH_SIZE = 2_000n;
const POLL_INTERVAL_MS = 30_000;

export class EventIndexer {
  private pool:            Pool;
  private startBlock:      bigint;
  private lastScannedBlock: bigint;
  private timer:           NodeJS.Timeout | null = null;

  constructor(pool: Pool, startBlock: bigint) {
    this.pool             = pool;
    this.startBlock       = startBlock;
    this.lastScannedBlock = startBlock - 1n;
  }

  start() {
    console.log(`[EventIndexer] Starting from block ${this.startBlock}`);
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      await this.scan();
    } catch (err) {
      console.error("[EventIndexer] scan error:", err);
    }
  }

  private async scan() {
    if (!ESCROW_ADDRESS) return;
    const client = createPublic();

    const head = await client.getBlockNumber();
    let from   = this.lastScannedBlock + 1n;

    if (from > head) return;

    const to = from + BATCH_SIZE - 1n < head ? from + BATCH_SIZE - 1n : head;

    console.log(`[EventIndexer] Scanning blocks ${from}–${to} (head: ${head})`);

    const logs = await client.getLogs({
      address:   ESCROW_ADDRESS,
      fromBlock: from,
      toBlock:   to,
    });

    for (const log of logs) {
      await this.indexLog(log as Log);
    }

    this.lastScannedBlock = to;
  }

  private async indexLog(log: Log) {
    const txHash   = log.transactionHash;
    const logIndex = log.logIndex;
    if (txHash === null || logIndex === null) return;

    // Skip if already indexed
    const { rows } = await this.pool.query(
      "SELECT id FROM task_events WHERE tx_hash=$1 AND log_index=$2",
      [txHash, logIndex],
    );
    if (rows.length > 0) return;

    // Attempt to match event to a DB task via onchain_task_id
    // We try to decode each known event type
    const eventNames = ["TaskCreated", "ResultSubmitted", "TaskPaid", "TaskRefunded"] as const;
    for (const eventName of eventNames) {
      try {
        const { decodeEventLog } = await import("viem");
        const decoded = decodeEventLog({
          abi:       escrowAbi,
          data:      log.data,
          topics:    log.topics as [`0x${string}`, ...`0x${string}`[]],
          eventName,
        });

        const args = decoded.args as Record<string, unknown>;
        const taskIdBigInt = args.taskId as bigint | undefined;
        if (taskIdBigInt === undefined) continue;

        // Find matching DB task
        const { rows: taskRows } = await this.pool.query(
          "SELECT id FROM tasks WHERE onchain_task_id = $1",
          [taskIdBigInt.toString()],
        );
        const taskId = taskRows[0]?.id as string | undefined;
        if (!taskId) continue;

        await this.pool.query(
          `INSERT INTO task_events
            (id, task_id, source, event_type, tx_hash, block_number, log_index, payload, created_at)
            VALUES ($1, $2, 'chain', $3, $4, $5, $6, $7, NOW())
            ON CONFLICT (tx_hash, log_index) DO NOTHING`,
          [
            uuidv4(),
            taskId,
            eventName,
            txHash,
            log.blockNumber ? Number(log.blockNumber) : null,
            logIndex,
            JSON.stringify(
              Object.fromEntries(
                Object.entries(args).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
              ),
            ),
          ],
        );

        console.log(`[EventIndexer] Indexed ${eventName} for task ${taskId}`);
        break;
      } catch { /* not this event type */ }
    }
  }
}
