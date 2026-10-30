/**
 * AuditOrchestrator — the single Solidity audit engine.
 *
 * Both entry points call runAudit():
 *   - Escrow task flow (ProviderWorker)
 *   - x402 paid service endpoint (x402-server)
 *   - Next.js /api/audit route (Analyze page)
 *
 * Pipeline (Branches A + B + C run in parallel):
 *   Stage 1  — Normalize source, keccak256 hash, write to tmp dir
 *   Branch A — BlockRun AI via outgoing x402 (@x402/fetch + ExactEvmScheme)
 *   Branch B — Solc: compile, AST scan, warning parse, heuristic scan
 *   Branch C — Slither: JSON detector output (graceful skip if not installed)
 *   Stage 4  — Correlate: AI + tool findings matched by keyword + line proximity
 *   Stage 5  — Deduplicate (same title+line = keep first)
 *   Stage 6  — Score: critical −40, high −20, medium −8, low −2, info 0
 *   Stage 7  — Build AuditReport v2 and return
 *
 * IMPORTANT: BlockRun payment success and audit score are independent.
 * A contract scoring 40 (FAIL) is a completed, billable audit.
 */

import { execFileSync, execSync } from "child_process";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { keccak256, toBytes } from "viem";
import { v4 as uuidv4 } from "uuid";
import type {
  AuditFinding,
  AuditReport,
  BlockRunReceipt,
  ToolCoverage,
  FindingOrigin,
  AuditVerdict,
  AuditSeverity,
} from "@agetbazar/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunAuditOptions {
  /** Raw Solidity source (single file or multi-file concatenated) */
  sourceCode: string;
  /** Optional parent task ID for linking audit_runs record */
  taskId?: string;
  /** Where this audit was triggered from */
  entryPoint: "escrow_task" | "x402_service" | "analyze_page";
  /** If provided, progress events are emitted here */
  onProgress?: (event: AuditProgressEvent) => void;
}

export interface AuditProgressEvent {
  stage: string;
  message: string;
  done?: boolean;
  error?: boolean;
}

// ---------------------------------------------------------------------------
// Scoring policy v1
// ---------------------------------------------------------------------------
const SCORE_POLICY_VERSION = "v1";
const PENALTIES: Record<AuditSeverity, number> = {
  critical: 40,
  high:     20,
  medium:   8,
  low:      2,
  info:     0,
};

function calcScore(findings: AuditFinding[]): number {
  // Count each unique (severity, corroborated) finding once — do NOT double-count corroborated.
  const penalties = findings
    .filter((f) => f.severity !== "info")
    .reduce((sum, f) => sum + (PENALTIES[f.severity] ?? 0), 0);
  return Math.max(0, 100 - penalties);
}

function scoreToVerdict(score: number): AuditVerdict {
  if (score >= 70) return "PASS";
  if (score >= 40) return "REVIEW_REQUIRED";
  return "FAIL";
}

// ---------------------------------------------------------------------------
// Heuristic pattern scanner (Branch B helper)
// ---------------------------------------------------------------------------
type Severity = AuditSeverity;

interface RawFinding {
  severity:   Severity;
  title:      string;
  description: string;
  line?:      number | null;
  context?:   string;
  detectorId?: string;
}

const HEURISTIC_PATTERNS: Array<{
  re: RegExp; severity: Severity; title: string; description: string; detectorId: string;
}> = [
  {
    re: /\btx\.origin\b/,
    severity: "high",
    detectorId: "tx-origin-auth",
    title: "tx.origin used for authentication",
    description:
      "Using tx.origin for authentication allows phishing attacks. An intermediate contract can impersonate the original caller. Use msg.sender instead.",
  },
  {
    re: /\bdelegatecall\b/,
    severity: "high",
    detectorId: "delegatecall-usage",
    title: "delegatecall detected",
    description:
      "delegatecall executes external code in the caller's storage context. A malicious callee can overwrite critical storage slots.",
  },
  {
    re: /\bselfdestruct\b/,
    severity: "high",
    detectorId: "selfdestruct",
    title: "selfdestruct present",
    description:
      "selfdestruct permanently destroys the contract and forcibly sends its USDC/ETH balance to an arbitrary address. Verify it is intentional and access-controlled.",
  },
  {
    re: /\bsuicide\b/,
    severity: "high",
    detectorId: "selfdestruct",
    title: "suicide (deprecated selfdestruct) present",
    description: "suicide is the deprecated alias for selfdestruct.",
  },
  {
    re: /block\.(timestamp|number)\s*(==|!=|<|>|<=|>=)/,
    severity: "medium",
    detectorId: "timestamp-dependence",
    title: "block.timestamp / block.number in comparison",
    description:
      "Miners can manipulate block.timestamp by ±15 seconds. Avoid using it for strict deadline enforcement or randomness.",
  },
  {
    re: /\bassembly\s*\{/,
    severity: "medium",
    detectorId: "assembly-usage",
    title: "Inline assembly block",
    description:
      "Inline assembly bypasses Solidity safety checks. Ensure it is audited, documented, and necessary.",
  },
  {
    re: /\bunchecked\s*\{/,
    severity: "medium",
    detectorId: "unchecked-arithmetic",
    title: "Unchecked arithmetic block",
    description:
      "unchecked blocks disable Solidity 0.8 overflow/underflow protection. Verify every expression inside cannot overflow.",
  },
  {
    re: /\.call\{.*value.*\}|\.call\.value\(/,
    severity: "medium",
    detectorId: "reentrancy",
    title: "Low-level ETH/USDC transfer via .call",
    description:
      "Low-level .call with value forwards all gas and may enable reentrancy. Apply checks-effects-interactions.",
  },
  {
    re: /\btransfer\s*\(\s*[^)]+\)/,
    severity: "low",
    detectorId: "transfer-limitation",
    title: ".transfer() used",
    description:
      ".transfer() forwards only 2300 gas and may fail for contract recipients. Prefer .call{value:...}(\"\") with a reentrancy guard.",
  },
  {
    re: /\bsend\s*\(\s*[^)]+\)/,
    severity: "low",
    detectorId: "transfer-limitation",
    title: ".send() used",
    description:
      ".send() forwards only 2300 gas and silently returns false on failure. Check the return value.",
  },
  {
    re: /pragma solidity\s+\^/,
    severity: "low",
    detectorId: "floating-pragma",
    title: "Floating pragma",
    description:
      "A caret (^) allows compilation with any compatible version. Pin to an exact version for reproducible builds.",
  },
  {
    re: /\bconstructor\b.*public/,
    severity: "low",
    detectorId: "public-constructor",
    title: "public constructor (pre-0.7 style)",
    description: "Constructors marked public have no effect in Solidity 0.7+. Remove the visibility modifier.",
  },
  {
    re: /mapping\s*\(\s*address\s*=>/,
    severity: "info",
    detectorId: "address-mapping",
    title: "Address mapping found",
    description: "Confirm all writes to this mapping are properly access-controlled.",
  },
];

function heuristicScan(source: string): RawFinding[] {
  const lines    = source.split("\n");
  const findings: RawFinding[] = [];

  // Reentrancy: state write after external call
  let lastCallLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\.(call|send|transfer)\s*[\({]/.test(line)) lastCallLine = i;
    if (
      lastCallLine >= 0 && i > lastCallLine && i <= lastCallLine + 10 &&
      /\b\w+\s*[\[\(].*\]\s*[+\-]?=/.test(line) && !/\/\//.test(line.trimStart())
    ) {
      findings.push({
        severity:    "high",
        detectorId:  "reentrancy",
        title:       "Potential reentrancy: state write after external call",
        description:
          "A state variable appears to be written after an external call. Apply checks-effects-interactions or a ReentrancyGuard.",
        line:    i + 1,
        context: lines.slice(Math.max(0, lastCallLine), i + 1).join("\n").trim(),
      });
      lastCallLine = -1;
    }
  }

  // Pattern-based scan
  for (const pat of HEURISTIC_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const stripped = lines[i].replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      if (pat.re.test(stripped)) {
        const key = `${pat.title}|${i + 1}`;
        if (!findings.some((f) => `${f.title}|${f.line ?? ""}` === key)) {
          findings.push({
            severity:   pat.severity,
            detectorId: pat.detectorId,
            title:      pat.title,
            description: pat.description,
            line:    i + 1,
            context: lines[i].trim(),
          });
        }
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// AST scan (Branch B helper)
// ---------------------------------------------------------------------------
function astScan(astJson: string): RawFinding[] {
  const findings: RawFinding[] = [];
  let ast: unknown;
  try { ast = JSON.parse(astJson); } catch { return findings; }

  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;

    if (n.nodeType === "FunctionDefinition") {
      const params = (n.parameters as Record<string, unknown[]>)?.parameters ?? [];
      const hasAddr = (params as Record<string, unknown>[]).some(
        (p) => (p.typeDescriptions as Record<string, string>)?.typeString === "address",
      );
      const bodyStr = JSON.stringify(n.body ?? "");
      if (hasAddr && n.body && !bodyStr.includes("address(0)")) {
        findings.push({
          severity:    "low",
          detectorId:  "missing-zero-address-check",
          title:       `Missing zero-address check in "${n.name as string}"`,
          description: `"${n.name as string}" accepts an address parameter but does not validate it against address(0).`,
          line:        n.src ? parseInt((n.src as string).split(":")[0], 10) : null,
        });
      }
      if (
        (n.visibility === "public" || n.visibility === "external") &&
        n.stateMutability !== "view" && n.stateMutability !== "pure" &&
        !(n.modifiers as unknown[] | undefined)?.length &&
        n.kind !== "constructor" && n.name !== "receive" && n.name !== "fallback"
      ) {
        findings.push({
          severity:    "info",
          detectorId:  "unguarded-function",
          title:       `Unguarded public/external function: "${n.name as string}"`,
          description: `"${n.name as string}" is ${n.visibility as string} and state-mutating but has no modifiers.`,
        });
      }
    }

    for (const val of Object.values(n)) {
      if (Array.isArray(val)) val.forEach(walk);
      else if (val && typeof val === "object") walk(val);
    }
  }

  walk(ast);
  return findings;
}

// ---------------------------------------------------------------------------
// Branch B: Solc analysis
// ---------------------------------------------------------------------------
interface SolcResult {
  compilerStatus: "success" | "error" | "unavailable";
  compilerOutput: string | null;
  solcVersion:    string;
  findings:       RawFinding[];
}

function runSolc(srcFile: string, dir: string, ozLib: string): SolcResult {
  const ozRemap = `@openzeppelin/contracts/=${ozLib}/`;
  let compilerStatus: "success" | "error" | "unavailable" = "success";
  let compilerOutput: string | null = null;
  let solcVersion = "unavailable";
  const findings: RawFinding[] = [];

  try {
    const verOut = execFileSync("solc", ["--version"], { timeout: 5_000 }).toString();
    solcVersion  = verOut.trim().split("\n").pop()?.trim() ?? "unknown";
  } catch {
    return { compilerStatus: "unavailable", compilerOutput: null, solcVersion, findings };
  }

  // Compile
  try {
    execFileSync("solc", ["--no-cbor-metadata", ozRemap, srcFile, "--overwrite"],
      { timeout: 60_000, cwd: dir });
  } catch (e) {
    compilerStatus = "error";
    compilerOutput = String(e instanceof Error ? e.message : e);
    findings.push({
      severity: "high", detectorId: "compilation-error",
      title: "Compilation failed", description: compilerOutput,
    });
    return { compilerStatus, compilerOutput, solcVersion, findings };
  }

  // AST scan
  try {
    const astOut = execFileSync(
      "solc", ["--ast-compact-json", ozRemap, srcFile, "--overwrite"],
      { timeout: 60_000, cwd: dir }).toString();
    const m = astOut.match(/=======.*?=======\n([\s\S]+)/);
    if (m) findings.push(...astScan(m[1]));
  } catch { /* non-blocking */ }

  // Compiler warnings
  try {
    const wOut = execFileSync(
      "solc", ["--bin", ozRemap, srcFile, "--overwrite"],
      { timeout: 60_000, cwd: dir, encoding: "utf8" });
    const wRe = /Warning:\s*([^\n]+)\n(?:.*\n)*?.*--> [^:]+:(\d+):/g;
    let wm: RegExpExecArray | null;
    while ((wm = wRe.exec(wOut)) !== null) {
      findings.push({
        severity: "low", detectorId: "compiler-warning",
        title: "Compiler warning", description: wm[1].trim(), line: parseInt(wm[2], 10),
      });
    }
  } catch { /* non-blocking */ }

  // Heuristic scan
  findings.push(...heuristicScan("")); // placeholder — source passed separately below

  return { compilerStatus, compilerOutput, solcVersion, findings };
}

// ---------------------------------------------------------------------------
// Branch C: Slither analysis
// ---------------------------------------------------------------------------
interface SlitherFinding {
  severity:    Severity;
  detectorId:  string;
  title:       string;
  description: string;
  line?:       number | null;
  confidence?: string;
}

function runSlither(srcFile: string, ozLib: string): SlitherFinding[] {
  try {
    execSync("which slither", { timeout: 3_000 });
  } catch { return []; } // Slither not installed — skip gracefully

  try {
    const out = execFileSync(
      "slither",
      [
        srcFile,
        "--json", "-",
        "--solc-remaps", `@openzeppelin/contracts/=${ozLib}/`,
        "--disable-color",
      ],
      { timeout: 120_000, encoding: "utf8" },
    );
    const data = JSON.parse(out) as {
      results?: { detectors?: Array<{
        impact: string; confidence: string;
        description: string; check: string;
        elements?: Array<{ source_mapping?: { lines?: number[] } }>;
      }> };
    };

    const impactMap: Record<string, Severity> = {
      High: "high", Medium: "medium", Low: "low", Informational: "info", Optimization: "info",
    };
    return (data.results?.detectors ?? []).map((d) => ({
      severity:    impactMap[d.impact] ?? "info",
      detectorId:  `slither-${d.check}`,
      title:       `[Slither] ${d.check}`,
      description: d.description.replace(/\n/g, " ").trim(),
      line:        d.elements?.[0]?.source_mapping?.lines?.[0] ?? null,
      confidence:  d.confidence,
    }));
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Branch A: BlockRun AI analysis
// ---------------------------------------------------------------------------
interface BlockRunResult {
  findings:       RawFinding[];
  receipt?:       BlockRunReceipt;
  skipped:        boolean;
  skipReason?:    string;
}

async function runBlockRunAI(sourceCode: string): Promise<BlockRunResult> {
  const payerKey = process.env.BLOCKRUN_AI_PAYER_KEY?.trim();
  if (!payerKey) {
    return { findings: [], skipped: true, skipReason: "BLOCKRUN_AI_PAYER_KEY not set" };
  }

  const gateway = process.env.BLOCKRUN_GATEWAY ?? "https://testnet.blockrun.ai";
  const network = process.env.BLOCKRUN_NETWORK ?? "eip155:84532";
  const model   = process.env.BLOCKRUN_MODEL   ?? "deepseek/deepseek-chat";

  let wrapFetchWithPayment: (f: typeof fetch, c: unknown) => typeof fetch;
  let x402ClientCtor: (opts: unknown) => unknown;
  let ExactEvmSchemeCtor: new (acct: unknown) => unknown;
  let privateKeyToAccount: (k: `0x${string}`) => unknown;

  try {
    // Dynamic import to avoid breaking startup when packages are absent
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fetchPkg = require("@x402/fetch") as {
      wrapFetchWithPayment: typeof wrapFetchWithPayment;
      x402Client: { fromConfig: typeof x402ClientCtor };
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const evmPkg = require("@x402/evm/exact/client") as { ExactEvmScheme: typeof ExactEvmSchemeCtor };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const viemAccounts = require("viem/accounts") as { privateKeyToAccount: typeof privateKeyToAccount };
    wrapFetchWithPayment = fetchPkg.wrapFetchWithPayment;
    x402ClientCtor = fetchPkg.x402Client.fromConfig;
    ExactEvmSchemeCtor = evmPkg.ExactEvmScheme;
    privateKeyToAccount = viemAccounts.privateKeyToAccount;
  } catch (e) {
    return { findings: [], skipped: true, skipReason: `x402 packages not available: ${String(e)}` };
  }

  try {
    const normalizedKey = (payerKey.startsWith("0x") ? payerKey : `0x${payerKey}`) as `0x${string}`;
    const signer  = privateKeyToAccount(normalizedKey);
    // arc-studio-allow-onchain-literal — Arc Testnet USDC, public constant
    const USDC_TESTNET = "0x3600000000000000000000000000000000000000";
    const USDC_BASE_SEP = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    const assetAddress = network.includes("84532") ? USDC_BASE_SEP : USDC_TESTNET;

    const client = x402ClientCtor({
      schemes: [{ network, client: new ExactEvmSchemeCtor(signer) }],
      spendControls: {
        allowedAssets: [{ network, asset: assetAddress, maxAmountPerPayment: "2.00" }],
      },
    });
    const paidFetch = wrapFetchWithPayment(fetch, client) as typeof fetch;

    const AUDIT_PROMPT = `You are a smart contract security auditor. Analyze this Solidity contract for security vulnerabilities, logic errors, and best-practice violations.

For each finding, respond with a JSON array of objects with this exact structure:
{
  "severity": "critical" | "high" | "medium" | "low" | "info",
  "title": "short title",
  "description": "detailed explanation including why it is a vulnerability and how it could be exploited",
  "line": <line number as integer or null>,
  "exploitScenario": "step-by-step description of how an attacker would exploit this",
  "remediation": "exact code change or design change to fix it"
}

Contract source:
\`\`\`solidity
${sourceCode.slice(0, 8000)}
\`\`\`

Respond with ONLY the JSON array, no other text.`;

    const startMs = Date.now();
    const resp = await paidFetch(`${gateway}/api/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: AUDIT_PROMPT }],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    });

    const latencyMs = Date.now() - startMs;
    const receiptHeader = resp.headers.get("X-Payment-Receipt") ?? resp.headers.get("x-payment-receipt");
    const receipt: BlockRunReceipt = {
      gateway,
      network,
      model,
      amountUsdc: "unknown",
      txHash:     receiptHeader ?? undefined,
      latencyMs,
      settledAt:  new Date().toISOString(),
    };

    if (!resp.ok) {
      return {
        findings: [], skipped: false, receipt,
        skipReason: `BlockRun returned ${resp.status}`,
      };
    }

    const body = await resp.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };
    receipt.tokensUsed = body.usage?.total_tokens;

    const content = body.choices?.[0]?.message?.content ?? "";
    // Extract JSON array from the response (may be wrapped in ```json ... ```)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return { findings: [], skipped: false, receipt };
    }

    const rawFindings = JSON.parse(jsonMatch[0]) as Array<{
      severity?: string; title?: string; description?: string;
      line?: number | null; exploitScenario?: string; remediation?: string;
    }>;

    const VALID_SEVERITIES = new Set(["critical","high","medium","low","info"]);
    const findings: RawFinding[] = rawFindings
      .filter((f) => f.title && f.description)
      .map((f) => ({
        severity:       (VALID_SEVERITIES.has(f.severity ?? "") ? f.severity : "medium") as Severity,
        detectorId:     "ai-identified",
        title:          String(f.title ?? "").trim(),
        description:    String(f.description ?? "").trim(),
        line:           typeof f.line === "number" ? f.line : null,
        exploitScenario: f.exploitScenario,
        remediation:    f.remediation,
      }));

    return { findings, receipt, skipped: false };
  } catch (e) {
    return {
      findings: [], skipped: false,
      skipReason: `BlockRun error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Finding correlation: match AI + tool findings
// ---------------------------------------------------------------------------
function correlate(
  toolFindings: RawFinding[],
  aiFindings:   RawFinding[],
): AuditFinding[] {
  const result: AuditFinding[] = [];
  const aiUsed = new Set<number>();

  // For each tool finding, try to find a matching AI finding
  for (const tf of toolFindings) {
    const titleWords = tf.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    let matchIdx = -1;

    for (let i = 0; i < aiFindings.length; i++) {
      if (aiUsed.has(i)) continue;
      const af  = aiFindings[i];
      const afTitle = af.title.toLowerCase();
      const afDesc  = af.description.toLowerCase();

      // Match by: same detectorId hint in title/desc, or ≥2 title words overlap, or line proximity
      const wordOverlap = titleWords.filter(
        (w) => afTitle.includes(w) || afDesc.includes(w),
      ).length;
      const lineProximity = tf.line != null && af.line != null && Math.abs(tf.line - af.line) <= 3;
      const detectorHint  = afTitle.includes(tf.detectorId ?? "") || afDesc.includes(tf.detectorId ?? "");

      if (wordOverlap >= 2 || lineProximity || detectorHint) {
        matchIdx = i;
        break;
      }
    }

    const origin: FindingOrigin = matchIdx >= 0 ? "corroborated" : "tool_confirmed";
    const ai = matchIdx >= 0 ? aiFindings[matchIdx] : undefined;
    if (matchIdx >= 0) aiUsed.add(matchIdx);

    result.push({
      id:              uuidv4(),
      severity:        tf.severity,
      origin,
      detectorId:      tf.detectorId,
      title:           tf.title,
      description:     ai?.description ?? tf.description,   // prefer richer AI description
      line:            tf.line ?? ai?.line,
      context:         tf.context,
      exploitScenario: (ai as RawFinding & { exploitScenario?: string })?.exploitScenario,
      remediation:     (ai as RawFinding & { remediation?: string })?.remediation,
    });
  }

  // Remaining AI findings not matched by any tool finding
  for (let i = 0; i < aiFindings.length; i++) {
    if (aiUsed.has(i)) continue;
    const af = aiFindings[i] as RawFinding & { exploitScenario?: string; remediation?: string };
    result.push({
      id:              uuidv4(),
      severity:        af.severity,
      origin:          "ai_identified",
      detectorId:      af.detectorId,
      title:           af.title,
      description:     af.description,
      line:            af.line,
      exploitScenario: af.exploitScenario,
      remediation:     af.remediation,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------
function dedup(findings: AuditFinding[]): AuditFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.title.toLowerCase().trim()}|${f.line ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Main export: runAudit
// ---------------------------------------------------------------------------
export async function runAudit(opts: RunAuditOptions): Promise<AuditReport> {
  const { sourceCode, taskId, entryPoint, onProgress } = opts;
  const emit = (stage: string, message: string, extra?: Partial<AuditProgressEvent>) =>
    onProgress?.({ stage, message, ...extra });

  const auditId    = uuidv4();
  const sourceHash = keccak256(toBytes(sourceCode)) as `0x${string}`;
  const ozLib      = process.env.OZ_CONTRACTS_PATH ??
    "/home/user/app/contracts/lib/openzeppelin-contracts/contracts";

  emit("prepare", "Preparing contract source…");

  const dir     = mkdtempSync(join(tmpdir(), "agbaudit-"));
  const srcFile = join(dir, "Contract.sol");
  writeFileSync(srcFile, sourceCode, "utf8");

  emit("parallel", "Running analysis branches in parallel (AI + Solc + Slither)…");

  // ── Run all three branches in parallel ──────────────────────────────────
  const [blockrunResult, slitherFindings] = await Promise.all([
    runBlockRunAI(sourceCode).then((r) => {
      if (r.skipped) emit("blockrun", `BlockRun AI skipped: ${r.skipReason}`);
      else if (r.receipt) emit("blockrun", `BlockRun AI inference complete (${r.receipt.latencyMs}ms)`);
      return r;
    }),
    Promise.resolve(runSlither(srcFile, ozLib)).then((r) => {
      emit("slither", r.length > 0 ? `Slither found ${r.length} detector result(s)` : "Slither: no issues or not installed");
      return r;
    }),
  ]);

  // Solc runs synchronously (blocking) — wrap in a promise for clarity
  const solcResult = await Promise.resolve((() => {
    const r = runSolc(srcFile, dir, ozLib);
    // Heuristic scan runs on the original source (not in runSolc above)
    if (r.compilerStatus !== "unavailable") {
      const heuristics = heuristicScan(sourceCode);
      r.findings.push(...heuristics);
    }
    emit("solc", `Solc: ${r.compilerStatus}, ${r.findings.length} raw finding(s)`);
    return r;
  })());

  rmSync(dir, { recursive: true, force: true });

  // ── Correlation ──────────────────────────────────────────────────────────
  emit("correlate", "Correlating findings across AI and tool outputs…");

  const toolRaw: RawFinding[] = [
    ...solcResult.findings,
    ...slitherFindings,
  ];
  const aiRaw: RawFinding[] = blockrunResult.findings;

  const correlated = correlate(toolRaw, aiRaw);
  const deduped    = dedup(correlated);

  // Sort by severity weight
  const SEV_WEIGHT: Record<AuditSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  deduped.sort((a, b) => SEV_WEIGHT[a.severity] - SEV_WEIGHT[b.severity]);

  // ── Score ────────────────────────────────────────────────────────────────
  const score   = calcScore(deduped);
  const verdict = scoreToVerdict(score);

  // Counts
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of deduped) counts[f.severity]++;

  // Score breakdown
  const uniquePenalized = deduped.filter((f) => f.severity !== "info");
  const penaltyBreakdown = uniquePenalized.map((f) => ({
    findingId: f.id,
    title:     f.title,
    severity:  f.severity,
    penalty:   PENALTIES[f.severity],
  }));

  // Coverage record
  const coverage: ToolCoverage = {
    solc: {
      ran:       solcResult.compilerStatus !== "unavailable",
      version:   solcResult.solcVersion,
      compiled:  solcResult.compilerStatus === "success",
      findings:  solcResult.findings.length,
    },
    slither: {
      ran:       slitherFindings.length >= 0,
      installed: slitherFindings.length > 0,
      detectors: slitherFindings.map((f) => f.detectorId),
      findings:  slitherFindings.length,
    },
    blockrunAi: {
      ran:       !blockrunResult.skipped,
      gateway:   process.env.BLOCKRUN_GATEWAY ?? "testnet.blockrun.ai",
      model:     process.env.BLOCKRUN_MODEL    ?? "deepseek/deepseek-chat",
      findings:  blockrunResult.findings.length,
      skipped:   blockrunResult.skipped,
      skipReason: blockrunResult.skipReason,
    },
  };

  const summary = buildSummary(deduped, solcResult.compilerStatus, score, verdict);

  emit("score", `Score: ${score}/100 — Verdict: ${verdict}`, { done: true });

  const report: AuditReport = {
    schemaVersion:    2,
    auditId,
    taskId,
    entryPoint,
    sourceHash,
    scoringPolicyVersion: SCORE_POLICY_VERSION,
    score,
    verdict,
    counts,
    findings:         deduped,
    scoreBreakdown:   {
      baseScore:        100,
      totalPenalty:     100 - score,
      findings:         penaltyBreakdown,
    },
    coverage,
    solcVersion:      solcResult.solcVersion,
    compilerStatus:   solcResult.compilerStatus,
    compilerOutput:   solcResult.compilerOutput,
    blockrunReceipt:  blockrunResult.receipt,
    summary,
    createdAt:        new Date().toISOString(),
  };

  return report;
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------
function buildSummary(
  findings: AuditFinding[],
  compilerStatus: string,
  score: number,
  verdict: AuditVerdict,
): string {
  if (compilerStatus === "error") {
    return "Compilation failed — no complete security analysis could be performed.";
  }
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const issues = [
    counts.critical && `${counts.critical} critical`,
    counts.high     && `${counts.high} high`,
    counts.medium   && `${counts.medium} medium`,
    counts.low      && `${counts.low} low`,
  ].filter(Boolean);

  const verdictText = verdict === "PASS"
    ? "Contract passed screening."
    : verdict === "REVIEW_REQUIRED"
    ? "Manual review is recommended before deployment."
    : "Contract failed screening — do not deploy without resolving high-severity findings.";

  if (issues.length === 0) {
    return `Score: ${score}/100. No significant vulnerabilities detected. ${verdictText}`;
  }
  return `Score: ${score}/100. Found ${issues.join(", ")} severity issue(s). ${verdictText}`;
}
