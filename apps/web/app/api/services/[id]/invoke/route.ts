import { NextRequest, NextResponse } from "next/server";
import { getPool }                   from "@/lib/db/pool";
import { invokeService, getServiceById } from "@/lib/payment/router";
import type { InvokeServiceRequest } from "@agetbazar/shared";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: Partial<InvokeServiceRequest>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { maxPerPaymentUsdc, budgetUsdc, taskId, input } = body;

  if (!maxPerPaymentUsdc || isNaN(parseFloat(maxPerPaymentUsdc)))
    return NextResponse.json({ error: "maxPerPaymentUsdc is required" }, { status: 400 });
  if (!budgetUsdc || isNaN(parseFloat(budgetUsdc)))
    return NextResponse.json({ error: "budgetUsdc is required" }, { status: 400 });

  // Validate the service exists before looking up a buyer agent
  let service;
  try {
    service = await getServiceById(id);
  } catch (err) {
    console.error("[POST /api/services/:id/invoke] service lookup failed", err);
    return NextResponse.json({ error: "Service registry is temporarily unavailable" }, { status: 503 });
  }
  if (!service)
    return NextResponse.json({ error: "Service not found" }, { status: 404 });

  const isPaidAudit = service.endpointMethod.toUpperCase() === "POST" &&
    service.endpointUrl.endsWith("/api/paid/audit");
  if (isPaidAudit && (typeof input?.sourceCode !== "string" || input.sourceCode.trim().length < 10)) {
    return NextResponse.json(
      { error: "At least 10 characters of Solidity source are required for this paid audit." },
      { status: 400 },
    );
  }

  // Resolve the buyer agent id
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT id FROM agents WHERE role='buyer' AND is_active=true LIMIT 1",
  );
  const buyerAgentId: string = rows[0]?.id;
  if (!buyerAgentId)
    return NextResponse.json({ error: "No active buyer agent configured" }, { status: 503 });

  try {
    const result = await invokeService(
      { serviceId: id, taskId, input, maxPerPaymentUsdc, budgetUsdc },
      buyerAgentId,
    );

    const status = result.status === "failed" ? 502 : 200;
    return NextResponse.json(result, { status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/services/:id/invoke]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
