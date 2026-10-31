import type { AppStatusType } from "./status";

// ---------------------------------------------------------------------------
// Audit Engine v2 types (schemaVersion: 2)
// ---------------------------------------------------------------------------

export type AuditSeverity = "critical" | "high" | "medium" | "low" | "info";
export type FindingOrigin  = "tool_confirmed" | "ai_identified" | "corroborated" | "unverified";
export type AuditVerdict   = "PASS" | "REVIEW_REQUIRED" | "FAIL";

export interface AuditFinding {
  id:              string;
  severity:        AuditSeverity;
  origin:          FindingOrigin;
  detectorId?:     string;
  title:           string;
  description:     string;
  line?:           number | null;
  context?:        string;
  exploitScenario?: string;
  remediation?:    string;
  confidence?:     string;
}

export interface ScoreBreakdown {
  baseScore:    number;
  totalPenalty: number;
  findings:     Array<{
    findingId: string;
    title:     string;
    severity:  AuditSeverity;
    penalty:   number;
  }>;
}

export interface BlockRunReceipt {
  gateway:    string;
  network:    string;
  model:      string;
  amountUsdc: string;
  txHash?:    string;
  tokensUsed?: number;
  latencyMs:  number;
  settledAt:  string;
}

export interface ToolCoverage {
  solc: {
    ran:      boolean;
    version:  string;
    compiled: boolean;
    findings: number;
  };
  slither: {
    ran:       boolean;
    installed: boolean;
    detectors: string[];
    findings:  number;
  };
  blockrunAi: {
    ran:        boolean;
    gateway:    string;
    model:      string;
    findings:   number;
    skipped:    boolean;
    skipReason?: string;
  };
}

export interface AuditReport {
  schemaVersion:        2;
  auditId:              string;
  taskId?:              string;
  entryPoint:           "escrow_task" | "x402_service" | "analyze_page";
  sourceHash:           string;
  scoringPolicyVersion: string;
  score:                number;
  verdict:              AuditVerdict;
  counts:               Record<AuditSeverity, number>;
  findings:             AuditFinding[];
  scoreBreakdown:       ScoreBreakdown;
  coverage:             ToolCoverage;
  solcVersion:          string;
  compilerStatus:       "success" | "error" | "unavailable";
  compilerOutput?:      string | null;
  blockrunReceipt?:     BlockRunReceipt;
  summary:              string;
  createdAt:            string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export interface Agent {
  id:             string;
  name:           string;
  role:           "buyer" | "provider";
  walletAddress:  string;
  capabilities:  string[];
  isActive:       boolean;
  createdAt:      string;
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export interface TaskTransactions {
  approve:    string | null;
  create:     string | null;
  submit:     string | null;
  settlement: string | null;
}

export interface VerificationResult {
  passed:  boolean | null;
  message: string;
  checks?: Record<string, boolean>;
}

export interface ReportAnalysis {
  compilerStatus:  string;
  compilerOutput?: string | null;
  toolName:        string;
  toolVersion:     string;
  findings:        Finding[];
  counts?:         Record<string, number>;
}

export interface Finding {
  severity:    "critical" | "high" | "medium" | "low" | "info";
  title:       string;
  description: string;
  line?:       number | null;
  context?:    string;
  location?:   string;
}

export interface Report {
  schemaVersion: number;
  taskId:        string;
  sourceHash:    string;
  analysis:      ReportAnalysis;
  summary?:      string;
  createdAt:     string;
}

export interface Task {
  id:                string;
  onchainTaskId:     string | null;
  chainId:           number;
  contractAddress:   string;
  buyerAgentId:      string;
  providerAgentId:   string;
  taskType:          string;
  title:             string;
  specificationHash: string;
  budgetUsdc:        string;
  budgetRaw:         string;
  deadline:          string;
  reviewDeadline:    string | null;
  resultHash:        string | null;
  inputJson:         Record<string, unknown> | null;
  verification:      VerificationResult | null;
  resultJson:        Report | null;
  status:            AppStatusType;
  transactions:      TaskTransactions;
  lastError:         string | null;
  createdAt:         string;
  updatedAt:         string;
}

export interface TaskEvent {
  id:          string;
  taskId:      string;
  source:      "chain" | "worker" | "verifier";
  eventType:   string;
  txHash:      string | null;
  blockNumber: number | null;
  logIndex:    number | null;
  payload:     Record<string, unknown>;
  createdAt:   string;
}

// ---------------------------------------------------------------------------
// API request/response shapes
// ---------------------------------------------------------------------------

export interface CreateTaskRequest {
  network?:           import("./chain").ArcNetworkName;
  taskType:           string;
  title:              string;
  input:              { sourceCode: string };
  budgetUsdc:         string;
  deadlineSeconds:    number;
  providerAgentId:    string;
  acceptanceCriteria: AcceptanceCriteria;
  idempotencyKey:     string;
}

export interface AcceptanceCriteria {
  requireSourceHash:           boolean;
  requireValidJson:            boolean;
  requireStaticAnalysisResults:boolean;
}

export interface CreateTaskResponse {
  id:              string;
  onchainTaskId:   string | null;
  status:          AppStatusType;
  budgetUsdc:      string;
  chainId:         number;
  contractAddress: string;
  transactions:    TaskTransactions;
}

export interface ListTasksResponse {
  tasks:  Task[];
  total:  number;
}

export interface HealthResponse {
  status:   "ok" | "degraded";
  db:       boolean;
  rpc:      boolean;
  chainId:  number | null;
}

// ---------------------------------------------------------------------------
// Payment Router
// ---------------------------------------------------------------------------

export type PaymentMode = "x402" | "gateway_nanopayment" | "escrow";

export interface PaymentReceipt {
  mode:             PaymentMode;
  network:          string;
  amountUsdc:       string;
  payerAddress?:    string;
  payToAddress?:    string;
  transactionHash?: string;
  status:           string;
  facilitator?:     string;
}

export type ServicePaymentStatus =
  | "pending"
  | "quote_received"
  | "authorization_created"
  | "payment_verified"
  | "executing"
  | "gateway_accepted"
  | "settlement_pending"
  | "settled"
  | "failed";

export interface Service {
  id:              string;
  name:            string;
  description:     string;
  agentId:         string;
  endpointUrl:     string;
  endpointMethod:  string;
  paymentMode:     PaymentMode;
  network:         string;
  assetAddress:    string;
  priceRaw:        string;
  priceUsdc:       string;
  payToAddress:    string;
  facilitatorUrl:  string;
  isActive:        boolean;
  capabilities:    string[];
  createdAt:       string;
}

export interface ServicePayment {
  id:               string;
  taskId:           string | null;
  buyerAgentId:     string;
  providerAgentId:  string;
  serviceId:        string;
  serviceName?:     string;
  paymentMode:      PaymentMode;
  network:          string;
  assetAddress:     string;
  amountRaw:        string;
  payToAddress:     string;
  status:           ServicePaymentStatus;
  facilitator:      string | null;
  txHash:           string | null;
  httpStatus:       number | null;
  resultReference:  string | null;
  errorMessage:     string | null;
  createdAt:        string;
  settledAt:        string | null;
}

export interface InvokeServiceRequest {
  serviceId:          string;
  taskId?:            string;
  /** Request body forwarded to a paid POST endpoint. */
  input?:             Record<string, unknown>;
  maxPerPaymentUsdc:  string;
  budgetUsdc:         string;
}

export interface InvokeServiceResponse {
  paymentId:  string;
  status:     ServicePaymentStatus;
  receipt?:   PaymentReceipt;
  data?:      unknown;
  error?:     string;
  warning?:   string;
}
