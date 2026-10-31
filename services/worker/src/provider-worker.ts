/**
 * ProviderWorker — polls for funded escrow tasks and runs the unified AuditOrchestrator.
 *
 * All analysis logic lives in audit-orchestrator.ts.
 * This file handles: DB polling, on-chain submitResult, task status updates.
 */
import { Pool } from "pg";
import { keccak256, toBytes, decodeEventLog, type Log } from "viem";
import stableStringify from "fast-json-stable-stringify";
import { v4 as uuidv4 } from "uuid";
import type { AcceptanceCriteria } from "@agetbazar/shared";
import { escrowAbi } from "@agetbazar/shared";
import { createPublic, createProviderWallet, networkForChainId } from "./chain/client";
import { runAudit } from "./audit-orchestrator";

const POLL_INTERVAL_MS = 5_000;

export class ProviderWorker {
  private pool:            Pool;
  private providerAgentId: string;
  private timer:           NodeJS.Timeout | null = null;

  constructor(pool: Pool, providerAgentId: string) {
    this.pool            = pool;
    this.providerAgentId = providerAgentId;
  }

  start() {
    console.log("[ProviderWorker] Starting poll loop");
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try { await this.processNextTask(); }
    catch (err) { console.error("[ProviderWorker] tick error:", err); }
  }

  private async processNextTask() {
    const { rows } = await this.pool.query<{
      id:              string;
      onchain_task_id: string;
      chain_id:        number;
      contract_address:`0x${string}`;
      input_json:      { sourceCode: string };
      criteria_json:   AcceptanceCriteria;
    }>(
      `UPDATE tasks SET
        status = 'processing', worker_claimed_at = NOW(), updated_at = NOW()
      WHERE id = (
        SELECT id FROM tasks
        WHERE status = 'funded'
          AND provider_agent_id = $1
          AND (worker_claimed_at IS NULL OR worker_claimed_at < NOW() - INTERVAL '10 minutes')
        ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
      )
      RETURNING id, onchain_task_id, chain_id, contract_address, input_json, criteria_json`,
      [this.providerAgentId],
    );
    if (rows.length === 0) return;
    const task = rows[0];
    console.log(`[ProviderWorker] Claimed task ${task.id}`);
    try {
      await this.executeTask(task.id, task.onchain_task_id, task.chain_id, task.contract_address, task.input_json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ProviderWorker] Task ${task.id} failed:`, msg);
      await this.pool.query(
        "UPDATE tasks SET status='funded', last_error=$1, worker_claimed_at=NULL, updated_at=NOW() WHERE id=$2",
        [msg, task.id],
      );
    }
  }

  private async executeTask(
    taskId:        string,
    onchainTaskId: string,
    chainId:       number,
    escrowAddress: `0x${string}`,
    input:         { sourceCode: string },
  ) {
    const network = networkForChainId(chainId);
    console.log(`[ProviderWorker] Running AuditOrchestrator for task ${taskId}…`);

    const report = await runAudit({
      sourceCode: input.sourceCode,
      taskId,
      entryPoint: "escrow_task",
      onProgress: (evt) => {
        console.log(`[ProviderWorker][${taskId}] ${evt.stage}: ${evt.message}`);
      },
    });

    const resultJson    = stableStringify(report);
    const resultHashHex = keccak256(toBytes(resultJson)) as `0x${string}`;

    await this.pool.query(
      `UPDATE tasks SET result_json=$1::jsonb, result_hash=$2, updated_at=NOW() WHERE id=$3`,
      [resultJson, resultHashHex, taskId],
    );

    // Persist to audit_runs
    await this.pool.query(
      `INSERT INTO audit_runs
         (id, task_id, entry_point, source_hash, score, verdict, report_json, blockrun_receipt, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,NOW())
       ON CONFLICT DO NOTHING`,
      [
        report.auditId, taskId, "escrow_task", report.sourceHash,
        report.score, report.verdict,
        resultJson,
        report.blockrunReceipt ? JSON.stringify(report.blockrunReceipt) : null,
      ],
    ).catch((e: unknown) => {
      // audit_runs table may not exist if migration 005 hasn't been run — non-fatal
      console.warn("[ProviderWorker] audit_runs insert skipped:", (e as Error).message);
    });

    const publicClient   = createPublic(network);
    const providerWallet = createProviderWallet(network);

    console.log(`[ProviderWorker] Submitting result on-chain for task ${taskId}…`);
    const submitHash = await providerWallet.writeContract({
      address:      escrowAddress,
      abi:          escrowAbi,
      functionName: "submitResult",
      args:         [BigInt(onchainTaskId), resultHashHex],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: submitHash });
    if (receipt.status !== "success") throw new Error(`submitResult reverted: ${submitHash}`);

    let reviewDeadline: string | null = null;
    for (const log of receipt.logs as Log[]) {
      try {
        const decoded = decodeEventLog({
          abi: escrowAbi, data: log.data, topics: log.topics, eventName: "ResultSubmitted",
        });
        reviewDeadline = new Date(Number(decoded.args.reviewDeadline as bigint) * 1000).toISOString();
        break;
      } catch { /* not this event */ }
    }

    await this.pool.query(
      `UPDATE tasks SET status='submitted', submit_tx_hash=$1, review_deadline=$2, updated_at=NOW() WHERE id=$3`,
      [submitHash, reviewDeadline, taskId],
    );

    await this.pool.query(
      `INSERT INTO task_events (id, task_id, source, event_type, tx_hash, payload, created_at)
       VALUES ($1,$2,'chain','ResultSubmitted',$3,$4,NOW())`,
      [uuidv4(), taskId, submitHash, JSON.stringify({
        resultHash: resultHashHex,
        score:      report.score,
        verdict:    report.verdict,
        auditId:    report.auditId,
      })],
    );

    console.log(
      `[ProviderWorker] Task ${taskId} submitted. Score: ${report.score}/100 (${report.verdict}). Tx: ${submitHash}`,
    );
  }
}
