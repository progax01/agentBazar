import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { parseUnits } from "viem";
import { getPool } from "@/lib/db/pool";
import { getTaskByIdempotencyKey, listTasks } from "@/lib/db/tasks";
import { getAgentById } from "@/lib/db/agents";
import { canonicalHash } from "@/lib/chain/hashing";
import { fundTask } from "@/lib/buyer-agent";
import { getEscrowAddress } from "@/lib/chain/client";
import { ARC_NETWORKS, parseArcNetwork, type CreateTaskRequest } from "@agetbazar/shared";

const BUDGET_MIN = 0.01;
const BUDGET_MAX = parseFloat(process.env.TASK_BUDGET_MAX_USDC ?? "0.10");
const SOURCE_MAX_BYTES = parseInt(process.env.TASK_SOURCE_MAX_BYTES ?? "100000");
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit  = Math.min(parseInt(url.searchParams.get("limit")  ?? "20"), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0"),  0);
  try {
    const result = await listTasks(limit, offset);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[GET /api/tasks]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: CreateTaskRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ---- Validate ----
  const { taskType, title, input, budgetUsdc, deadlineSeconds,
          providerAgentId, acceptanceCriteria, idempotencyKey } = body;
  const network = body.network ?? "testnet";
  const networkConfig = parseArcNetwork(network);
  if (!networkConfig)
    return NextResponse.json({ error: "Unsupported Arc network" }, { status: 400 });
  const chain = ARC_NETWORKS[networkConfig];

  if (taskType !== "solidity-source-report")
    return NextResponse.json({ error: "Unsupported task type" }, { status: 400 });
  if (!title?.trim())
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  if (!input?.sourceCode)
    return NextResponse.json({ error: "input.sourceCode is required" }, { status: 400 });
  if (Buffer.byteLength(input.sourceCode, "utf8") > SOURCE_MAX_BYTES)
    return NextResponse.json({ error: "Source code too large" }, { status: 400 });
  if (!budgetUsdc)
    return NextResponse.json({ error: "budgetUsdc is required" }, { status: 400 });

  const budget = parseFloat(budgetUsdc);
  if (isNaN(budget) || budget < BUDGET_MIN || budget > BUDGET_MAX)
    return NextResponse.json(
      { error: `budgetUsdc must be between ${BUDGET_MIN} and ${BUDGET_MAX}` },
      { status: 400 },
    );

  if (!Number.isInteger(deadlineSeconds) || deadlineSeconds < 60 || deadlineSeconds > 86_400 * 7)
    return NextResponse.json({ error: "deadlineSeconds must be between 60 and 604800" }, { status: 400 });
  if (!idempotencyKey)
    return NextResponse.json({ error: "idempotencyKey is required" }, { status: 400 });

  // ---- Idempotency ----
  const existing = await getTaskByIdempotencyKey(idempotencyKey).catch(() => null);
  if (existing) {
    return NextResponse.json(existing, { status: 200 });
  }

  // ---- Provider ----
  const provider = await getAgentById(providerAgentId).catch(() => null);
  if (!provider || provider.role !== "provider" || !provider.isActive)
    return NextResponse.json({ error: "Unknown or inactive provider agent" }, { status: 400 });

  // ---- Config ----
  const escrowAddress = getEscrowAddress(networkConfig);
  if (!escrowAddress)
    return NextResponse.json(
      { error: `${networkConfig === "mainnet" ? "AGETBAZAR_MAINNET_ESCROW_ADDRESS" : "AGETBAZAR_TESTNET_ESCROW_ADDRESS"} is not configured on the server` },
      { status: 503 },
    );

  // ---- Build specification hash ----
  const specification = {
    taskType,
    title,
    input,
    budgetUsdc,
    acceptanceCriteria,
    chainId: chain.chainId,
    contractAddress: escrowAddress,
    providerAddress: provider.walletAddress,
  };
  const specificationHash = canonicalHash(specification);
  const budgetRaw = parseUnits(budgetUsdc, 6).toString();

  // ---- Insert task as 'creating' ----
  const taskId = uuidv4();
  const deadline = new Date(Date.now() + deadlineSeconds * 1000).toISOString();
  const pool = getPool();

  try {
    await pool.query(
      `INSERT INTO tasks (
        id, chain_id, contract_address,
        buyer_agent_id, provider_agent_id,
        task_type, title, input_json, criteria_json,
        specification_hash, budget_usdc, budget_raw,
        deadline, status, idempotency_key,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, 'creating', $14, NOW(), NOW()
      )`,
      [
        taskId, chain.chainId, escrowAddress,
        /* buyer_agent_id — use the first buyer from agents or placeholder */
        await (async () => {
          const { rows } = await pool.query(
            "SELECT id FROM agents WHERE role='buyer' AND is_active=true LIMIT 1",
          );
          return rows[0]?.id ?? uuidv4();
        })(),
        providerAgentId,
        taskType, title,
        JSON.stringify(input),
        JSON.stringify(acceptanceCriteria),
        specificationHash,
        budgetUsdc,
        budgetRaw,
        deadline,
        idempotencyKey,
      ],
    );
  } catch (err) {
    console.error("[POST /api/tasks] insert error", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // ---- Fund on-chain ----
  let fundResult;
  try {
    fundResult = await fundTask(
      provider.walletAddress as `0x${string}`,
      budgetUsdc,
      deadlineSeconds,
      specificationHash as `0x${string}`,
      networkConfig,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(
      "UPDATE tasks SET status='failed', last_error=$1, updated_at=NOW() WHERE id=$2",
      [msg, taskId],
    );
    return NextResponse.json({ error: `Funding failed: ${msg}` }, { status: 502 });
  }

  // ---- Mark funded ----
  await pool.query(
    `UPDATE tasks SET
      status          = 'funded',
      onchain_task_id = $1,
      approve_tx_hash = $2,
      create_tx_hash  = $3,
      updated_at      = NOW()
    WHERE id = $4`,
    [
      fundResult.onchainTaskId.toString(),
      fundResult.approveTxHash,
      fundResult.createTxHash,
      taskId,
    ],
  );

  // Emit a chain event row
  await pool.query(
    `INSERT INTO task_events
      (id, task_id, source, event_type, tx_hash, payload, created_at)
      VALUES ($1, $2, 'chain', 'TaskCreated', $3, $4, NOW())`,
    [
      uuidv4(),
      taskId,
      fundResult.createTxHash,
      JSON.stringify({ onchainTaskId: fundResult.onchainTaskId.toString() }),
    ],
  );

  return NextResponse.json({
    id:              taskId,
    onchainTaskId:   fundResult.onchainTaskId.toString(),
    status:          "funded",
    budgetUsdc,
    chainId:         chain.chainId,
    contractAddress: escrowAddress,
    transactions: {
      approve:    fundResult.approveTxHash,
      create:     fundResult.createTxHash,
      submit:     null,
      settlement: null,
    },
  }, { status: 201 });
}
