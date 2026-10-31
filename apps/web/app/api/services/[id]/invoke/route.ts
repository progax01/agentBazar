import { NextRequest, NextResponse } from "next/server";
import { getPool }                   from "@/lib/db/pool";
import { invokeService, getServiceById } from "@/lib/payment/router";
import type { InvokeServiceRequest } from "@agetbazar/shared";

export const maxDuration = 60; // Next.js edge/serverless max — keeps the connection alive

// SSE helper
function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: Partial<InvokeServiceRequest>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const { maxPerPaymentUsdc, budgetUsdc, taskId, input } = body;

  if (!maxPerPaymentUsdc || isNaN(parseFloat(maxPerPaymentUsdc)))
    return new Response(JSON.stringify({ error: "maxPerPaymentUsdc is required" }), { status: 400 });
  if (!budgetUsdc || isNaN(parseFloat(budgetUsdc)))
    return new Response(JSON.stringify({ error: "budgetUsdc is required" }), { status: 400 });

  let service;
  try {
    service = await getServiceById(id);
  } catch (err) {
    console.error("[POST /api/services/:id/invoke] service lookup failed", err);
    return NextResponse.json({ error: "Service registry is temporarily unavailable" }, { status: 503 });
  }
  if (!service)
    return new Response(JSON.stringify({ error: "Service not found" }), { status: 404 });

  const isPaidAudit = service.endpointMethod.toUpperCase() === "POST" &&
    service.endpointUrl.endsWith("/api/paid/audit");
  if (isPaidAudit && (typeof input?.sourceCode !== "string" || input.sourceCode.trim().length < 10)) {
    return NextResponse.json(
      { error: "At least 10 characters of Solidity source are required for this paid audit." },
      { status: 400 },
    );
  }

  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT id FROM agents WHERE role='buyer' AND is_active=true LIMIT 1",
  );
  const buyerAgentId: string | undefined = rows[0]?.id;
  if (!buyerAgentId)
    return new Response(JSON.stringify({ error: "No active buyer agent configured" }), { status: 503 });

  // ── SSE stream ────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: unknown) => {
        try { controller.enqueue(encoder.encode(sseEvent(type, data))); } catch { /* closed */ }
      };

      // Heartbeat every 4s to keep the proxy connection alive (beats the ~10s proxy timeout)
      const hb = setInterval(() => send("heartbeat", { ts: Date.now() }), 4_000);

      send("progress", { step: "checking",  message: "Validating service & spend policy…" });
      await new Promise(r => setTimeout(r, 300));
      send("progress", { step: "paying",    message: "Signing EIP-3009 x402 USDC authorization…" });
      await new Promise(r => setTimeout(r, 300));
      send("progress", { step: "executing", message: "Sending paid request to provider — BlockRun AI running…" });

      try {
        const result = await invokeService(
          { serviceId: id, taskId, maxPerPaymentUsdc, budgetUsdc,
            input },
          buyerAgentId,
        );

        if (result.status === "failed") {
          clearInterval(hb);
          send("error", { error: result.error ?? "Paid service failed", paymentId: result.paymentId });
          return;
        }

        clearInterval(hb);
        send("progress", { step: "receiving", message: "Processing audit results…" });
        await new Promise(r => setTimeout(r, 150));
        send("progress", { step: "done",      message: "Complete" });
        send("result",   result);
      } catch (err) {
        clearInterval(hb);
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[SSE /api/services/:id/invoke]", err);
        send("error", { error: msg });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection":    "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering
    },
  });
}
