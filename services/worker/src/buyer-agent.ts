/**
 * Buyer-agent verifier — watches for submitted tasks, reproduces the result
 * hash, validates the report deterministically, and calls approveAndPay or
 * rejectAndRefund.
 */
import { Pool } from "pg";
import { keccak256, toBytes, decodeEventLog, type Log } from "viem";
import stableStringify from "fast-json-stable-stringify";
import { v4 as uuidv4 } from "uuid";
import { escrowAbi } from "@agetbazar/shared";
import { validateReport } from "./report-validator";
import type { AcceptanceCriteria } from "@agetbazar/shared";
import {
  createPublic,
  createBuyerWallet,
  ESCROW_ADDRESS,
} from "./chain/client";

const POLL_INTERVAL_MS = 7_000;

export class BuyerAgent {
  private pool: Pool;
  private timer: NodeJS.Timeout | null = null;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  start() {
    console.log("[BuyerAgent] Starting verification loop");
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      await this.processNextVerification();
    } catch (err) {
      console.error("[BuyerAgent] tick error:", err);
    }
  }

  private async processNextVerification() {
    const { rows } = await this.pool.query<{
      id:               string;
      onchain_task_id:  string;
      input_json:       { sourceCode: string };
      criteria_json:    AcceptanceCriteria;
      result_json:      unknown;
      result_hash:      string;
    }>(
      `UPDATE tasks SET
        status     = 'verifying',
        updated_at = NOW()
      WHERE id = (
        SELECT id FROM tasks
        WHERE status = 'submitted'
        ORDER BY updated_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, onchain_task_id, input_json, criteria_json, result_json, result_hash`,
    );

    if (rows.length === 0) return;
    const task = rows[0];
    console.log(`[BuyerAgent] Verifying task ${task.id}`);

    try {
      await this.verify(task);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[BuyerAgent] Verification infrastructure error ${task.id}:`, msg);
      await this.pool.query(
        "UPDATE tasks SET status='verification_error', last_error=$1, updated_at=NOW() WHERE id=$2",
        [msg, task.id],
      );
    }
  }

  private async verify(task: {
    id:              string;
    onchain_task_id: string;
    input_json:      { sourceCode: string };
    criteria_json:   AcceptanceCriteria;
    result_json:     unknown;
    result_hash:     string;
  }) {
    if (!ESCROW_ADDRESS) throw new Error("ESCROW_ADDRESS not configured");

    const publicClient = createPublic();
    const buyerWallet  = createBuyerWallet();

    // 1. Confirm on-chain state is Submitted
    const onchainTask = await publicClient.readContract({
      address:      ESCROW_ADDRESS,
      abi:          escrowAbi,
      functionName: "tasks",
      args:         [BigInt(task.onchain_task_id)],
    }) as [string, string, bigint, bigint, bigint, number, `0x${string}`, `0x${string}`];
    const [, , , , , onchainStatus, , onchainResultHash] = onchainTask;
    if (onchainStatus !== 2 /* Submitted */) {
      throw new Error(`On-chain status is ${onchainStatus}, expected Submitted`);
    }

    // 2. Re-compute result hash and compare
    const computedHash = keccak256(
      toBytes(stableStringify(task.result_json as object)),
    ) as `0x${string}`;
    if (computedHash !== onchainResultHash) {
      throw new Error(
        `Result hash mismatch. Computed: ${computedHash}, on-chain: ${onchainResultHash}`,
      );
    }

    // 3. Deterministic validation
    const validation = validateReport(
      task.result_json,
      task.input_json.sourceCode,
      task.criteria_json,
      onchainResultHash,
    );

    await this.pool.query(
      "UPDATE tasks SET verification_json=$1, updated_at=NOW() WHERE id=$2",
      [JSON.stringify(validation), task.id],
    );

    // 4. Settle on-chain
    let settleTxHash: string;
    let finalStatus:  "paid" | "refunded";

    if (validation.passed) {
      settleTxHash = await buyerWallet.writeContract({
        address:      ESCROW_ADDRESS,
        abi:          escrowAbi,
        functionName: "approveAndPay",
        args:         [BigInt(task.onchain_task_id)],
      });
      finalStatus = "paid";
    } else {
      settleTxHash = await buyerWallet.writeContract({
        address:      ESCROW_ADDRESS,
        abi:          escrowAbi,
        functionName: "rejectAndRefund",
        args:         [BigInt(task.onchain_task_id)],
      });
      finalStatus = "refunded";
    }

    const receipt = await publicClient.waitForTransactionReceipt({ hash: settleTxHash as `0x${string}` });
    if (receipt.status !== "success") {
      throw new Error(`Settlement tx reverted: ${settleTxHash}`);
    }

    // 5. Confirm final event
    const expectedEvent = validation.passed ? "TaskPaid" : "TaskRefunded";
    for (const log of receipt.logs as Log[]) {
      try {
        decodeEventLog({
          abi:       escrowAbi,
          data:      log.data,
          topics:    log.topics,
          eventName: expectedEvent,
        });
        break;
      } catch { /* not this event */ }
    }

    await this.pool.query(
      `UPDATE tasks SET
        status             = $1,
        settlement_tx_hash = $2,
        updated_at         = NOW()
      WHERE id = $3`,
      [finalStatus, settleTxHash, task.id],
    );

    await this.pool.query(
      `INSERT INTO task_events
        (id, task_id, source, event_type, tx_hash, payload, created_at)
        VALUES ($1, $2, 'verifier', $3, $4, $5, NOW())`,
      [
        uuidv4(),
        task.id,
        expectedEvent,
        settleTxHash,
        JSON.stringify({ passed: validation.passed, message: validation.message }),
      ],
    );

    console.log(`[BuyerAgent] Task ${task.id} settled: ${finalStatus}, tx: ${settleTxHash}`);
  }
}
