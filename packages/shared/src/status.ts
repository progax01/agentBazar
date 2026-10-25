// Application-level workflow statuses (superset of on-chain Status enum).
export const AppStatus = {
  creating:           "creating",
  funded:             "funded",
  processing:         "processing",
  submitted:          "submitted",
  verifying:          "verifying",
  verification_error: "verification_error",
  paid:               "paid",
  refunded:           "refunded",
  failed:             "failed",
} as const;

export type AppStatusType = (typeof AppStatus)[keyof typeof AppStatus];

// On-chain Status enum numeric values (matches Solidity enum order).
export const OnchainStatus = {
  None:      0,
  Funded:    1,
  Submitted: 2,
  Paid:      3,
  Refunded:  4,
} as const;

export type OnchainStatusType = (typeof OnchainStatus)[keyof typeof OnchainStatus];

export const ONCHAIN_STATUS_LABELS: Record<number, string> = {
  0: "None",
  1: "Funded",
  2: "Submitted",
  3: "Paid",
  4: "Refunded",
};

export const APP_STATUS_LABELS: Record<AppStatusType, string> = {
  creating:           "Creating",
  funded:             "Funded",
  processing:         "Processing",
  submitted:          "Submitted",
  verifying:          "Verifying",
  verification_error: "Verification Error",
  paid:               "Paid",
  refunded:           "Refunded",
  failed:             "Failed",
};

export function isTerminal(status: AppStatusType): boolean {
  return status === "paid" || status === "refunded" || status === "failed";
}

export function isActive(status: AppStatusType): boolean {
  return !isTerminal(status);
}
