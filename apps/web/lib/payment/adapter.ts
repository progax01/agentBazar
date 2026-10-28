/**
 * ServicePaymentAdapter — base interface for all payment modes.
 * Concrete implementations: X402PaymentAdapter (this file), GatewayNanopaymentAdapter (future).
 */
import type { PaymentReceipt, PaymentMode } from "@agetbazar/shared";

export interface InvokePolicy {
  maxPerPaymentUsdc: string;
  budgetUsdc:        string;
}

export interface InvokeResult {
  data:     unknown;
  receipt?: PaymentReceipt;
}

export interface ServicePaymentAdapter {
  mode: PaymentMode;
  invoke(
    url:    string,
    method: string,
    input:  unknown,
    policy: InvokePolicy,
  ): Promise<InvokeResult>;
}
