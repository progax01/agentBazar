/**
 * X402PaymentAdapter
 *
 * Buyer-side x402 client using the VERIFIED export paths for @x402/* v2.28.0:
 *   @x402/fetch           → x402Client, wrapFetchWithPayment
 *   @x402/evm/exact/client → ExactEvmScheme  (client/buyer side)
 *
 * The server/seller side uses @x402/evm/exact/server (see x402-server.ts).
 */
import type { ServicePaymentAdapter, InvokePolicy, InvokeResult } from "./adapter";
import type { PaymentReceipt } from "@agetbazar/shared";

const ARC_NETWORK = process.env.ARC_NETWORK ?? "eip155:5042002";

function normalizeKey(raw: string): `0x${string}` {
  return raw.startsWith("0x") ? (raw as `0x${string}`) : `0x${raw}`;
}

export class X402PaymentAdapter implements ServicePaymentAdapter {
  readonly mode = "x402" as const;

  async invoke(
    url:    string,
    method: string,
    input:  unknown,
    policy: InvokePolicy,
  ): Promise<InvokeResult> {
    const rawKey = process.env.BUYER_AGENT_PRIVATE_KEY;
    if (!rawKey) throw new Error("BUYER_AGENT_PRIVATE_KEY not set");

    const ARC_USDC = process.env.ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";

    // Lazy-import to keep the server bundle lean.
    const { privateKeyToAccount } = await import("viem/accounts");
    const { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } =
      await import("@x402/fetch") as typeof import("@x402/fetch");

    // Use the buyer/client sub-path — NOT the root export which is the server scheme.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { ExactEvmScheme } = await import("@x402/evm/exact/client") as any;

    const signer = privateKeyToAccount(normalizeKey(rawKey));

    const maxAmountRaw = String(
      Math.round(parseFloat(policy.maxPerPaymentUsdc) * 1_000_000),
    );

    const client = x402Client.fromConfig({
      schemes: [
        {
          network: ARC_NETWORK as `${string}:${string}`,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          client:  new ExactEvmScheme(signer) as any,
        },
      ],
      spendControls: {
        allowedAssets: [
          {
            network:             ARC_NETWORK as `${string}:${string}`,
            asset:               ARC_USDC,
            maxAmountPerPayment: maxAmountRaw,
          },
        ],
      },
    });

    const paidFetch = wrapFetchWithPayment(fetch, client);

    const isPost  = method.toUpperCase() === "POST";
    const hasBody = isPost && input != null;

    const res = await paidFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(hasBody ? { body: JSON.stringify(input) } : {}),
    });

    const httpStatus = res.status;
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.clone().json() as Record<string, unknown>;
        const reason = body.errorMessage ?? body.errorReason ?? body.error ?? body.message;
        if (typeof reason === "string") detail = `: ${reason.slice(0, 500)}`;
        else detail = `: ${JSON.stringify(body).slice(0, 500)}`;
      } catch {
        const text = await res.clone().text().catch(() => "");
        if (text) detail = `: ${text.slice(0, 500)}`;
      }
      throw Object.assign(
        new Error(`Paid service returned ${httpStatus}${detail}`),
        { httpStatus },
      );
    }

    const data = await res.json() as unknown;

    // Extract settlement evidence from response headers when available.
    const paymentResponseHeader = res.headers.get("PAYMENT-RESPONSE") ??
                                  res.headers.get("X-PAYMENT-RESPONSE");
    let settlement: ReturnType<typeof decodePaymentResponseHeader> | undefined;
    if (paymentResponseHeader) {
      try {
        settlement = decodePaymentResponseHeader(paymentResponseHeader);
      } catch (err) {
        console.warn("[X402PaymentAdapter] Could not decode PAYMENT-RESPONSE:", err);
      }
    }
    const txHash = (settlement?.success ? settlement.transaction : undefined) ??
                   res.headers.get("x-transaction-hash") ??
                   res.headers.get("x-payment-receipt")  ??
                   undefined;
    const settled = settlement?.success === true || Boolean(txHash);

    const receipt: PaymentReceipt = {
      mode:            "x402",
      network:         ARC_NETWORK,
      amountUsdc:      policy.maxPerPaymentUsdc,
      payerAddress:    signer.address,
      payToAddress:    res.headers.get("x-pay-to") ?? undefined,
      transactionHash: txHash ?? undefined,
      status:          settled ? "settled" : "payment_verified",
      facilitator:     "facilitator.arcusnetwork.co",
    };

    return { data, receipt };
  }
}
