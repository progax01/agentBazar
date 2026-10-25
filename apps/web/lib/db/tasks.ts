import { getPool } from "./pool";
import type { Task, TaskEvent } from "@agetbazar/shared";
import type { AppStatusType } from "@agetbazar/shared";

// ---------------------------------------------------------------------------
// Map a raw DB row to the Task shape consumed by the frontend.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTask(row: Record<string, any>): Task {
  return {
    id:                row.id,
    onchainTaskId:     row.onchain_task_id ? String(row.onchain_task_id) : null,
    chainId:           row.chain_id,
    contractAddress:   row.contract_address,
    buyerAgentId:      row.buyer_agent_id,
    providerAgentId:   row.provider_agent_id,
    taskType:          row.task_type,
    title:             row.title,
    specificationHash: row.specification_hash,
    budgetUsdc:        row.budget_usdc,
    budgetRaw:         row.budget_raw ? String(row.budget_raw) : "0",
    deadline:          row.deadline,
    reviewDeadline:    row.review_deadline ?? null,
    resultHash:        row.result_hash ?? null,
    inputJson:         row.input_json ?? null,
    verification:      row.verification_json ?? null,
    resultJson:        row.result_json ?? null,
    status:            row.status as AppStatusType,
    transactions: {
      approve:    row.approve_tx_hash ?? null,
      create:     row.create_tx_hash ?? null,
      submit:     row.submit_tx_hash ?? null,
      settlement: row.settlement_tx_hash ?? null,
    },
    lastError:   row.last_error ?? null,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

export async function getTaskById(id: string): Promise<Task | null> {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM tasks WHERE id = $1", [id]);
  return rows[0] ? rowToTask(rows[0]) : null;
}

export async function listTasks(
  limit = 20,
  offset = 0,
): Promise<{ tasks: Task[]; total: number }> {
  const pool = getPool();
  const [{ rows }, countResult] = await Promise.all([
    pool.query(
      "SELECT * FROM tasks ORDER BY created_at DESC LIMIT $1 OFFSET $2",
      [limit, offset],
    ),
    pool.query("SELECT COUNT(*) FROM tasks"),
  ]);
  return {
    tasks: rows.map(rowToTask),
    total: parseInt(countResult.rows[0].count, 10),
  };
}

export async function getTaskEvents(taskId: string): Promise<TaskEvent[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM task_events WHERE task_id = $1 ORDER BY created_at ASC",
    [taskId],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((row: Record<string, any>): TaskEvent => ({
    id:          row.id,
    taskId:      row.task_id,
    source:      row.source,
    eventType:   row.event_type,
    txHash:      row.tx_hash ?? null,
    blockNumber: row.block_number ?? null,
    logIndex:    row.log_index ?? null,
    payload:     row.payload ?? {},
    createdAt:   row.created_at,
  }));
}

export async function getTaskByIdempotencyKey(
  key: string,
): Promise<Task | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM tasks WHERE idempotency_key = $1",
    [key],
  );
  return rows[0] ? rowToTask(rows[0]) : null;
}
