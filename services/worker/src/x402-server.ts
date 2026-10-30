/**
 * x402 paid Express server — provider/seller side.
 *
 * Paid endpoints (all settled in USDC via Arcus facilitator):
 *   POST /api/paid/audit          — 0.50 USDC — runs full AuditOrchestrator pipeline
 *   GET  /api/paid/capabilities   — 0.01 USDC — returns capability manifest
 *
 * Free endpoints:
 *   GET  /health
 *
 * Env vars required:
 *   PROVIDER_PAY_TO   — EVM address receiving USDC per call
 *   ARC_NETWORK       — defaults to eip155:5042002
 *   ARC_USDC_ADDRESS  — defaults to Arc Testnet USDC
 */
import express from "express";
import type { Request, Response } from "express";
import { runAudit } from "./audit-orchestrator";

const PORT            = parseInt(process.env.X402_SERVER_PORT ?? "4021");
const NETWORK         = process.env.ARC_NETWORK ?? "eip155:5042002";
// arc-studio-allow-onchain-literal — Arc Testnet USDC, public constant
const USDC            = process.env.ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
const FACILITATOR_URL = "https://facilitator.arcusnetwork.co";

async function startX402Server() {
  const payTo = process.env.PROVIDER_PAY_TO?.trim();
  if (!payTo) {
    console.error("[x402-server] ❌  PROVIDER_PAY_TO is not set.");
    process.exit(1);
  }

  // ── Import packages (verified exports for @x402/* v2.28.0) ──────────────
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { paymentMiddleware, x402ResourceServer } = require("@x402/express") as {
    paymentMiddleware:  (...args: unknown[]) => express.RequestHandler;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    x402ResourceServer: new (facilitators?: unknown) => any;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const { HTTPFacilitatorClient } = require("@x402/core/http") as { HTTPFacilitatorClient: new (opts: { url: string }) => any };
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const { ExactEvmScheme } = require("@x402/evm/exact/server") as { ExactEvmScheme: new () => any };

  const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const resourceServer    = new x402ResourceServer([facilitatorClient]);
  resourceServer.register(NETWORK, new ExactEvmScheme());

  // ── Route price config ───────────────────────────────────────────────────
  // Backward-compat: old DB records reference /api/paid/analysis-capabilities;
  // register both the canonical path and the legacy alias at the same price.
  const capabilityAccepts = [{
    scheme: "exact", network: NETWORK, payTo,
    price: "0.01",   // 0.01 USDC for capability manifest
    asset: USDC,
    extra: { name: "USDC", version: "2" },
  }];

  const routes = {
    "POST /api/paid/audit": {
      accepts: [{
        scheme: "exact", network: NETWORK, payTo,
        price: "0.50",   // 0.50 USDC per full audit
        asset: USDC,
        extra: { name: "USDC", version: "2" },
      }],
    },
    "GET /api/paid/capabilities": {
      accepts: capabilityAccepts,
    },
    // Legacy alias kept for existing DB service records
    "GET /api/paid/analysis-capabilities": {
      accepts: capabilityAccepts,
    },
  };

  // ── Express app ──────────────────────────────────────────────────────────
  const app = express();
  app.use(express.json({ limit: "500kb" }));
  app.use(paymentMiddleware(routes, resourceServer));

  // ── POST /api/paid/audit — Full audit (paid, 0.50 USDC) ─────────────────
  app.post("/api/paid/audit", async (req: Request, res: Response) => {
    const { sourceCode, taskId } = req.body as { sourceCode?: string; taskId?: string };

    if (!sourceCode || typeof sourceCode !== "string" || sourceCode.trim().length < 10) {
      res.status(400).json({ error: "sourceCode is required (min 10 chars)" });
      return;
    }

    try {
      const report = await runAudit({
        sourceCode,
        taskId,
        entryPoint: "x402_service",
        onProgress: (evt) =>
          console.log(`[x402-server][audit] ${evt.stage}: ${evt.message}`),
      });

      res.json({
        ok:           true,
        auditId:      report.auditId,
        score:        report.score,
        verdict:      report.verdict,
        summary:      report.summary,
        counts:       report.counts,
        findings:     report.findings,
        coverage:     report.coverage,
        blockrunReceipt: report.blockrunReceipt,
        schemaVersion: report.schemaVersion,
        createdAt:    report.createdAt,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[x402-server] Audit error:", msg);
      res.status(500).json({ error: `Audit failed: ${msg}` });
    }
  });

  // ── GET /api/paid/capabilities — capability manifest (paid, 0.01 USDC) ──
  app.get("/api/paid/capabilities", (_req: Request, res: Response) => {
    res.json({
      serviceId:           "agetbazar-solidity-audit",
      version:             "2.0.0",
      schemaVersion:       2,
      network:             NETWORK,
      facilitator:         FACILITATOR_URL,
      pricingUsdc: {
        "POST /api/paid/audit":         "0.50",
        "GET  /api/paid/capabilities":  "0.01",
      },
      capabilities: [
        "solidity-security-audit",
        "blockrun-ai-analysis",
        "slither-static-analysis",
        "solc-compilation-check",
        "finding-correlation",
        "risk-scoring",
      ],
      detectors: [
        "reentrancy", "tx-origin-auth", "delegatecall-usage", "selfdestruct",
        "timestamp-dependence", "assembly-usage", "unchecked-arithmetic",
        "floating-pragma", "missing-zero-address-check", "unguarded-function",
        "compiler-warning", "transfer-limitation",
      ],
      scoringPolicy: {
        version:   "v1",
        verdicts:  { PASS: "score >= 70", REVIEW_REQUIRED: "score >= 40", FAIL: "score < 40" },
        penalties: { critical: 40, high: 20, medium: 8, low: 2, info: 0 },
      },
    });
  });

  // ── GET /api/paid/analysis-capabilities — legacy alias (paid, 0.01 USDC) ─
  // Existing DB service records may still reference this older path.
  app.get("/api/paid/analysis-capabilities", (_req: Request, res: Response) => {
    res.json({
      serviceId:           "agetbazar-solidity-audit",
      version:             "2.0.0",
      schemaVersion:       2,
      network:             NETWORK,
      facilitator:         FACILITATOR_URL,
      note:                "This path is a legacy alias. Canonical: GET /api/paid/capabilities",
      capabilities: [
        "solidity-security-audit", "blockrun-ai-analysis",
        "slither-static-analysis", "solc-compilation-check",
        "finding-correlation", "risk-scoring",
      ],
    });
  });

  // ── GET /health — free ───────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status:      "ok",
      network:     NETWORK,
      facilitator: FACILITATOR_URL,
      payTo,
      endpoints: {
        "POST /api/paid/audit":        "0.50 USDC",
        "GET  /api/paid/capabilities": "0.01 USDC",
      },
    });
  });

  app.listen(PORT, () => {
    console.log(`[x402-server] ✅  Listening on port ${PORT}`);
    console.log(`[x402-server]    Paid: POST http://localhost:${PORT}/api/paid/audit (0.50 USDC)`);
    console.log(`[x402-server]    Paid: GET  http://localhost:${PORT}/api/paid/capabilities (0.01 USDC)`);
    console.log(`[x402-server]    Free: GET  http://localhost:${PORT}/health`);
    console.log(`[x402-server]    Network: ${NETWORK} | Pay-to: ${payTo}`);
  });
}

startX402Server().catch((err: unknown) => {
  console.error("[x402-server] Fatal startup error:", err);
  process.exit(1);
});
