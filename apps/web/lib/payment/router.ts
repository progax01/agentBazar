/**
 * PaymentRouter — chooses the right adapter based on the service's payment_mode,
 * persists every invocation to service_payments, and reconciles the result.
 */
import { v4 as uuidv4 }      from "uuid";
import { getPool }            from "@/lib/db/pool";
import { X402PaymentAdapter } from "./x402-adapter";
import type { ServicePaymentAdapter } from "./adapter";
import type {
  Service, ServicePayment, ServicePaymentStatus,
  InvokeServiceRequest, InvokeServiceResponse,
} from "@agetbazar/shared";

// ---- Adapter registry ----
const adapters = new Map<string, ServicePaymentAdapter>([
  ["x402", new X402PaymentAdapter()],
]);

// ---- DB helpers ----

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToService(row: Record<string, any>): Service {
  return {
    id:             row.id,
    name:           row.name,
    description:    row.description,
    agentId:        row.agent_id,
    endpointUrl:    row.endpoint_url,
    endpointMethod: row.endpoint_method,
    paymentMode:    row.payment_mode,
    network:        row.network,
    assetAddress:   row.asset_address,
    priceRaw:       String(row.price_raw),
    priceUsdc:      String(row.price_usdc),
    payToAddress:   row.pay_to_address,
    facilitatorUrl: row.facilitator_url,
    isActive:       row.is_active,
    capabilities:   Array.isArray(row.capabilities) ? row.capabilities : [],
    createdAt:      row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPayment(row: Record<string, any>): ServicePayment {
  return {
    id:              row.id,
    taskId:          row.task_id   ?? null,
    buyerAgentId:    row.buyer_agent_id,
    providerAgentId: row.provider_agent_id,
    serviceId:       row.service_id,
    serviceName:     row.service_name ?? undefined,
    paymentMode:     row.payment_mode,
    network:         row.network,
    assetAddress:    row.asset_address,
    amountRaw:       String(row.amount_raw),
    payToAddress:    row.pay_to_address,
    status:          row.status as ServicePaymentStatus,
    facilitator:     row.facilitator ?? null,
    txHash:          row.tx_hash    ?? null,
    httpStatus:      row.http_status ?? null,
    resultReference: row.result_reference ?? null,
    errorMessage:    row.error_message   ?? null,
    createdAt:       row.created_at,
    settledAt:       row.settled_at ?? null,
  };
}

export async function listServices(): Promise<Service[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM services WHERE is_active = true ORDER BY created_at DESC",
  );
  return rows.map(rowToService);
}

export async function getServiceById(id: string): Promise<Service | null> {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM services WHERE id = $1", [id]);
  return rows[0] ? rowToService(rows[0]) : null;
}

export async function listPayments(limit = 25, offset = 0): Promise<{ payments: ServicePayment[]; total: number }> {
  const pool = getPool();
  const [{ rows }, countResult] = await Promise.all([
    pool.query(
      `SELECT sp.*, s.name AS service_name
       FROM service_payments sp
       JOIN services s ON s.id = sp.service_id
       ORDER BY sp.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    pool.query("SELECT COUNT(*) FROM service_payments"),
  ]);
  return {
    payments: rows.map(rowToPayment),
    total:    parseInt(countResult.rows[0].count, 10),
  };
}

export async function getPaymentById(id: string): Promise<ServicePayment | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT sp.*, s.name AS service_name
     FROM service_payments sp
     JOIN services s ON s.id = sp.service_id
     WHERE sp.id = $1`,
    [id],
  );
  return rows[0] ? rowToPayment(rows[0]) : null;
}

// ---- Main invoke entry point ----

export async function invokeService(
  request: InvokeServiceRequest,
  buyerAgentId: string,
): Promise<InvokeServiceResponse> {
  const pool = getPool();

  const service = await getServiceById(request.serviceId);
  if (!service) {
    return { paymentId: "", status: "failed", error: "Service not found" };
  }

  const adapter = adapters.get(service.paymentMode);
  if (!adapter) {
    return { paymentId: "", status: "failed", error: `No adapter for payment mode: ${service.paymentMode}` };
  }

  // ---- Spending policy guard ----
  const maxPer = parseFloat(request.maxPerPaymentUsdc);
  const price  = parseFloat(service.priceUsdc);
  if (price > maxPer) {
    return {
      paymentId: "",
      status:    "failed",
      error:     `Service price ${price} USDC exceeds maxPerPaymentUsdc ${maxPer} USDC`,
    };
  }

  // ---- Persist invocation record (before payment so we have an audit trail) ----
  const paymentId = uuidv4();
  await pool.query(
    `INSERT INTO service_payments
      (id, task_id, buyer_agent_id, provider_agent_id, service_id,
       payment_mode, network, asset_address, amount_raw, pay_to_address,
       status, facilitator, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,NOW())`,
    [
      paymentId,
      request.taskId ?? null,
      buyerAgentId,
      service.agentId,
      service.id,
      service.paymentMode,
      service.network,
      service.assetAddress,
      service.priceRaw,
      service.payToAddress,
      service.facilitatorUrl,
    ],
  );

  // ---- Update to quote_received ----
  await pool.query(
    "UPDATE service_payments SET status='quote_received' WHERE id=$1",
    [paymentId],
  );

  // ---- Invoke via adapter ----
  let invokeResult;
  try {
    await pool.query(
      "UPDATE service_payments SET status='authorization_created' WHERE id=$1",
      [paymentId],
    );

    invokeResult = await adapter.invoke(
      service.endpointUrl,
      service.endpointMethod,
      request.input ?? null,
      { maxPerPaymentUsdc: request.maxPerPaymentUsdc, budgetUsdc: request.budgetUsdc },
    );
  } catch (err) {
    const msg        = err instanceof Error ? err.message : String(err);
    const httpStatus = (err as { httpStatus?: number }).httpStatus ?? null;
    await pool.query(
      `UPDATE service_payments
         SET status='failed', error_message=$1, http_status=$2, settled_at=NOW()
       WHERE id=$3`,
      [msg, httpStatus, paymentId],
    );
    return { paymentId, status: "failed", error: msg };
  }

  // ---- Reconcile success ----
  const receipt    = invokeResult.receipt;
  const txHash     = receipt?.transactionHash ?? null;
  const finalStatus: ServicePaymentStatus =
    txHash ? "settled" : receipt?.status === "payment_verified" ? "payment_verified" : "executing";

  await pool.query(
    `UPDATE service_payments
       SET status=$1, tx_hash=$2, http_status=200,
           result_reference=$3,
           settled_at = CASE WHEN $1='settled' THEN NOW() ELSE NULL END
     WHERE id=$4`,
    [
      finalStatus,
      txHash,
      JSON.stringify({ summary: typeof invokeResult.data === "object"
        ? Object.keys(invokeResult.data as object).join(", ")
        : "ok" }),
      paymentId,
    ],
  );

  return {
    paymentId,
    status:  finalStatus,
    receipt,
    data:    invokeResult.data,
  };
}
