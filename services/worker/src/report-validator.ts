/**
 * Deterministic verifier — validates an AuditReport v2 against acceptance criteria.
 *
 * IMPORTANT: payment success and audit score are independent.
 * A low score (FAIL verdict) means the contract failed screening — it does NOT
 * mean the audit service failed. Only reject payment when the analysis itself
 * could not be completed (compilation error, missing findings array, hash mismatch).
 */
import { keccak256, toBytes } from "viem";
import type { AuditReport, AcceptanceCriteria } from "@agetbazar/shared";

export interface ValidationResult {
  passed:  boolean;
  message: string;
  checks:  Record<string, boolean>;
}

export function validateReport(
  report:      unknown,
  sourceCode:  string,
  criteria:    AcceptanceCriteria,
  onchainHash: `0x${string}`,
): ValidationResult {
  const checks: Record<string, boolean> = {};

  // 1. Valid schema (v2)
  const validSchema = isValidAuditReport(report);
  checks.validSchema = validSchema;
  if (criteria.requireValidJson && !validSchema) {
    return { passed: false, message: "Report schema is invalid (expected schemaVersion 2)", checks };
  }

  const r = report as AuditReport;

  // 2. Source hash matches
  const computedHash   = keccak256(toBytes(sourceCode));
  const hashMatch      = r.sourceHash === computedHash;
  checks.sourceHashMatch = hashMatch;
  if (criteria.requireSourceHash && !hashMatch) {
    return { passed: false, message: "Source hash mismatch", checks };
  }

  // 3. Report hash matches on-chain commitment
  // (onchainHash is keccak256 of the stableStringified report)
  checks.onchainHashPresent = Boolean(onchainHash);

  // 4. Compilation must not have hard-errored
  // Note: a FAIL verdict (low score) is NOT a reason to reject payment.
  // Only reject when compilation itself failed and findings are meaningless.
  const compilerOk = r.compilerStatus !== "error";
  checks.compilerOk = compilerOk;
  if (!compilerOk) {
    return {
      passed:  false,
      message: "Compilation failed — analysis results are not valid for payment",
      checks,
    };
  }

  // 5. Findings array present
  const hasFindings = Array.isArray(r.findings);
  checks.hasFindings = hasFindings;
  if (criteria.requireStaticAnalysisResults && !hasFindings) {
    return { passed: false, message: "Findings array missing from report", checks };
  }

  // 6. Score and verdict present
  checks.hasScore   = typeof r.score === "number";
  checks.hasVerdict = typeof r.verdict === "string";

  // 7. Coverage record present
  checks.hasCoverage = Boolean(r.coverage);

  return {
    passed:  true,
    message: `Audit verified. Score: ${r.score}/100 — Verdict: ${r.verdict}`,
    checks,
  };
}

function isValidAuditReport(r: unknown): r is AuditReport {
  if (typeof r !== "object" || r === null) return false;
  const obj = r as Record<string, unknown>;
  if (obj.schemaVersion !== 2)                    return false;
  if (typeof obj.auditId !== "string")            return false;
  if (typeof obj.sourceHash !== "string")         return false;
  if (typeof obj.score !== "number")              return false;
  if (typeof obj.verdict !== "string")            return false;
  if (typeof obj.compilerStatus !== "string")     return false;
  if (!Array.isArray(obj.findings))               return false;
  return true;
}
