/**
 * Deterministic verifier — checks the report against acceptance criteria.
 * No AI is involved in pass/fail decisions.
 */
import { keccak256, toBytes } from "viem";
import type { Report, AcceptanceCriteria } from "@agetbazar/shared";

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

  // 1. Valid JSON schema
  const validJson = isValidReport(report);
  checks.validJson = validJson;
  if (criteria.requireValidJson && !validJson) {
    return { passed: false, message: "Report schema is invalid", checks };
  }

  const r = report as Report;

  // 2. Source hash matches
  const computedSourceHash = keccak256(toBytes(sourceCode));
  const sourceHashMatch    = r.sourceHash === computedSourceHash;
  checks.sourceHashMatch   = sourceHashMatch;
  if (criteria.requireSourceHash && !sourceHashMatch) {
    return { passed: false, message: "Source hash mismatch", checks };
  }

  // 3. Compiler must not have errored out — a compilation failure means the
  //    analysis is invalid and no payment should be released.
  const compilerOk = r.analysis?.compilerStatus !== "error";
  checks.compilerOk = compilerOk;
  if (!compilerOk) {
    return {
      passed:  false,
      message: "Compilation failed — analysis results are not valid for payment",
      checks,
    };
  }

  // 4. Static analysis results present
  const hasAnalysis = Array.isArray(r.analysis?.findings);
  checks.hasStaticAnalysis = hasAnalysis;
  if (criteria.requireStaticAnalysisResults && !hasAnalysis) {
    return { passed: false, message: "Static analysis findings missing", checks };
  }

  // 5. Tool name and version present
  checks.hasToolMetadata =
    Boolean(r.analysis?.toolName) && Boolean(r.analysis?.toolVersion);

  return {
    passed:  true,
    message: "All deterministic checks passed",
    checks,
  };
}

function isValidReport(r: unknown): r is Report {
  if (typeof r !== "object" || r === null) return false;
  const obj = r as Record<string, unknown>;
  if (typeof obj.schemaVersion !== "number")     return false;
  if (typeof obj.taskId !== "string")             return false;
  if (typeof obj.sourceHash !== "string")         return false;
  if (typeof obj.analysis !== "object")           return false;
  const a = obj.analysis as Record<string, unknown>;
  if (typeof a.compilerStatus !== "string")       return false;
  if (typeof a.toolName !== "string")             return false;
  if (typeof a.toolVersion !== "string")          return false;
  if (!Array.isArray(a.findings))                 return false;
  return true;
}
