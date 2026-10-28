/**
 * x402 paid Express server — provider/seller side.
 *
 * Uses the ACTUAL @x402/express + @x402/evm/exact/server exports
 * (verified against the installed 2.28.0 packages).
 *
 * Env vars required:
 *   PROVIDER_PAY_TO          — EVM address that receives USDC per call
 *   ARC_USDC_ADDRESS         — defaults to Arc Testnet USDC
 *   ARC_NETWORK              — defaults to eip155:5042002
 *   X402_SERVER_PORT         — defaults to 4021
 */
import express from "express";
import type { Request, Response } from "express";

const PORT             = parseInt(process.env.X402_SERVER_PORT ?? "4021");
const NETWORK          = process.env.ARC_NETWORK ?? "eip155:5042002";
// arc-studio-allow-onchain-literal — Arc Testnet USDC, public constant
const USDC             = process.env.ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
const FACILITATOR_URL  = "https://facilitator.arcusnetwork.co";

async function startX402Server() {
  const payTo = process.env.PROVIDER_PAY_TO?.trim();
  if (!payTo) {
    console.error("[x402-server] ❌  PROVIDER_PAY_TO is not set.");
    console.error("[x402-server]     Set it to your provider agent wallet address in services/worker/.env");
    process.exit(1);
  }

  // ── Import packages (verified exports for @x402/* v2.28.0) ──────────────
  // paymentMiddleware + x402ResourceServer live in @x402/express
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { paymentMiddleware, x402ResourceServer } = require("@x402/express") as {
    paymentMiddleware:  (...args: unknown[]) => express.RequestHandler;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    x402ResourceServer: new (facilitators?: unknown) => any;
  };

  // HTTPFacilitatorClient lives in @x402/core/http (NOT the root @x402/core export)
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const { HTTPFacilitatorClient } = require("@x402/core/http") as { HTTPFacilitatorClient: new (opts: { url: string }) => any };

  // Server-side verifier scheme lives at @x402/evm/exact/server
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const { ExactEvmScheme } = require("@x402/evm/exact/server") as { ExactEvmScheme: new () => any };

  // ── Build resource server ────────────────────────────────────────────────
  const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const resourceServer    = new x402ResourceServer([facilitatorClient]);
  resourceServer.register(NETWORK, new ExactEvmScheme());

  // ── Route price config ───────────────────────────────────────────────────
  // `price` must be a decimal USDC string (e.g. "0.01"), not a raw integer.
  // `asset` is the ERC-20 token address.
  // `accepts` is an array of payment requirement objects.
  const routes = {
    "GET /api/paid/analysis-capabilities": {
      accepts: [
        {
          scheme:  "exact",
          network: NETWORK,
          payTo,
          price:   "0.01",   // 0.01 USDC
          asset:   USDC,
          extra:   { name: "USDC", version: "2" },
        },
      ],
    },
    "GET /api/paid/analysis-report-schema": {
      accepts: [
        {
          scheme:  "exact",
          network: NETWORK,
          payTo,
          price:   "0.05",   // 0.05 USDC
          asset:   USDC,
          extra:   { name: "USDC", version: "2" },
        },
      ],
    },
  };

  // ── Express app ──────────────────────────────────────────────────────────
  const app = express();
  app.use(express.json());

  // x402 middleware intercepts the protected routes and verifies/settles payment.
  app.use(paymentMiddleware(routes, resourceServer));

  // ── Paid endpoints (only reached after payment verified) ─────────────────
  app.get("/api/paid/analysis-capabilities", (_req: Request, res: Response) => {
    res.json({
      serviceId:          "solidity-report-api",
      version:            "1.0.0",
      network:            NETWORK,
      facilitator:        FACILITATOR_URL,
      capabilities: [
        "solidity-source-report",
        "reentrancy-detection",
        "access-control-audit",
        "compiler-warning-surfacing",
        "ast-pattern-analysis",
      ],
      checks: [
        "reentrancy",
        "tx-origin-auth",
        "delegatecall-usage",
        "selfdestruct-usage",
        "block-timestamp-dependence",
        "integer-overflow-underflow",
        "unprotected-public-function",
        "missing-zero-address-check",
        "unchecked-block",
        "assembly-usage",
        "floating-pragma",
        "transfer-send-limitation",
        "arbitrary-external-call",
        "event-missing",
        "magic-numbers",
      ],
      inputSchemaVersion:  1,
      outputSchemaVersion: 1,
      pricingUsdc: { "analysis-capabilities": "0.01", "analysis-report-schema": "0.05" },
    });
  });

  app.get("/api/paid/analysis-report-schema", (_req: Request, res: Response) => {
    res.json({
      schemaVersion: 1,
      fields: {
        compilerStatus: "string — ok | warning | error",
        compilerOutput: "string | null",
        toolName: "string",
        toolVersion: "string",
        findings: {
          type:  "array",
          items: {
            severity:    "critical | high | medium | low | info",
            title:       "string",
            description: "string",
            line:        "number | null",
            context:     "string | null",
          },
        },
        counts: { type: "object", keys: ["critical","high","medium","low","info","total"] },
        summary: "string",
      },
    });
  });

  // ── Free endpoints ────────────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", network: NETWORK, facilitator: FACILITATOR_URL, payTo });
  });

  app.listen(PORT, () => {
    console.log(`[x402-server] ✅  Listening on port ${PORT}`);
    console.log(`[x402-server]    Paid: GET http://localhost:${PORT}/api/paid/analysis-capabilities (0.01 USDC)`);
    console.log(`[x402-server]    Paid: GET http://localhost:${PORT}/api/paid/analysis-report-schema (0.05 USDC)`);
    console.log(`[x402-server]    Free: GET http://localhost:${PORT}/health`);
    console.log(`[x402-server]    Network: ${NETWORK} | Pay-to: ${payTo}`);
  });
}

startX402Server().catch((err: unknown) => {
  console.error("[x402-server] Fatal startup error:", err);
  process.exit(1);
});
