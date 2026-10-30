/**
 * POST /api/audit
 *
 * Accepts { sourceCode: string } and streams SSE progress events,
 * then returns the full AuditReport v2 as a final SSE event.
 *
 * Entry point: analyze_page
 */
import { NextRequest } from "next/server";
import { runAudit } from "@worker/audit-orchestrator";
import type { AuditProgressEvent } from "@worker/audit-orchestrator";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: { sourceCode?: unknown };
  try {
    body = await req.json() as { sourceCode?: unknown };
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const sourceCode = body.sourceCode;
  if (typeof sourceCode !== "string" || sourceCode.trim().length < 10) {
    return new Response(JSON.stringify({ error: "sourceCode is required (min 10 chars)" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // SSE stream
  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        const report = await runAudit({
          sourceCode,
          entryPoint: "analyze_page",
          onProgress: (evt: AuditProgressEvent) => {
            send({ type: "progress", ...evt });
          },
        });

        send({ type: "complete", report });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send({ type: "error", message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    },
  });
}
