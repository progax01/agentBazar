/**
 * Provider worker — polls for funded tasks, runs static analysis, submits result hash on-chain.
 *
 * Analysis pipeline (all deterministic, no AI for pass/fail):
 *  1. solc compilation check with OZ remappings
 *  2. AST-level pattern scan:  tx.origin, delegatecall, selfdestruct, block.timestamp comparisons,
 *     inline assembly, unchecked arithmetic, missing access control on state-mutating functions
 *  3. Solidity source-text heuristic scan (regex-level, catches what AST misses at this tooling tier)
 * Each finding has severity (critical/high/medium/low/info), title, description, and line numbers.
 */
import { Pool } from "pg";
import { keccak256, toBytes, decodeEventLog, type Log } from "viem";
import stableStringify from "fast-json-stable-stringify";
import { v4 as uuidv4 } from "uuid";
import { execFileSync } from "child_process";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { AcceptanceCriteria } from "@agetbazar/shared";
import { escrowAbi } from "@agetbazar/shared";
import { createPublic, createProviderWallet, ESCROW_ADDRESS } from "./chain/client";

const POLL_INTERVAL_MS  = 5_000;
const WORKER_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Severity = "critical" | "high" | "medium" | "low" | "info";

interface Finding {
  severity:    Severity;
  title:       string;
  description: string;
  line?:       number | null;
  context?:    string;
}

// ---------------------------------------------------------------------------
// Pattern-based heuristic scanner
// Runs on raw source text — catches issues that don't need a full AST.
// ---------------------------------------------------------------------------
function heuristicScan(source: string): Finding[] {
  const findings: Finding[] = [];
  const lines = source.split("\n");

  const patterns: Array<{
    re:          RegExp;
    severity:    Severity;
    title:       string;
    description: string;
  }> = [
    {
      re:          /\btx\.origin\b/,
      severity:    "high",
      title:       "tx.origin used for authentication",
      description:
        "Using tx.origin for authentication allows phishing attacks. An intermediate contract can impersonate the original caller. Use msg.sender instead.",
    },
    {
      re:          /\bdelegatecall\b/,
      severity:    "high",
      title:       "delegatecall detected",
      description:
        "delegatecall executes external code in the caller's storage context. A malicious callee can overwrite critical storage slots. Verify the callee is trusted and immutable.",
    },
    {
      re:          /\bselfdestruct\b/,
      severity:    "high",
      title:       "selfdestruct present",
      description:
        "selfdestruct permanently destroys the contract and forcibly sends its ETH balance to an arbitrary address. Verify this is intentional and properly access-controlled.",
    },
    {
      re:          /\bsuicide\b/,
      severity:    "high",
      title:       "suicide (deprecated selfdestruct) present",
      description: "suicide is the deprecated alias for selfdestruct. See selfdestruct finding.",
    },
    {
      re:          /block\.(timestamp|number)\s*(==|!=|<|>|<=|>=)/,
      severity:    "medium",
      title:       "block.timestamp / block.number used in comparison",
      description:
        "Miners can manipulate block.timestamp by ±15 seconds. block.number is predictable. Avoid using these for randomness or strict deadline enforcement.",
    },
    {
      re:          /\bassembly\s*\{/,
      severity:    "medium",
      title:       "Inline assembly block",
      description:
        "Inline assembly bypasses Solidity safety checks. Ensure the assembly is audited and necessary. Common mistakes: incorrect memory layout, missing return-value checks.",
    },
    {
      re:          /\bunchecked\s*\{/,
      severity:    "medium",
      title:       "Unchecked arithmetic block",
      description:
        "unchecked blocks disable Solidity 0.8 overflow/underflow protection. Verify that every arithmetic expression inside cannot overflow or underflow with realistic inputs.",
    },
    {
      re:          /\.call\{.*value.*\}|\.call\.value\(/,
      severity:    "medium",
      title:       "Low-level ETH transfer via .call",
      description:
        "Low-level .call with value forwards all gas and may enable reentrancy. Apply checks-effects-interactions: update state before calling, or use a reentrancy guard.",
    },
    {
      re:          /\btransfer\s*\(\s*[^)]+\)/,
      severity:    "low",
      title:       ".transfer() used",
      description:
        ".transfer() forwards only 2300 gas and may fail for contract recipients (e.g. gnosis safe, smart wallets). Prefer .call{value:...}(\"\") with reentrancy protection.",
    },
    {
      re:          /\bsend\s*\(\s*[^)]+\)/,
      severity:    "low",
      title:       ".send() used",
      description:
        ".send() forwards only 2300 gas and silently returns false on failure. Check the return value or prefer .call{value:...}(\"\").",
    },
    {
      re:          /\bfloat\b|pragma solidity\s+\^/,
      severity:    "low",
      title:       "Floating pragma",
      description:
        "A caret (^) version pragma allows the contract to compile with any compatible version. Pin to an exact version (e.g. =0.8.28) for reproducible builds.",
    },
    {
      re:          /\bconstructor\b.*public/,
      severity:    "low",
      title:       "public constructor (pre-0.7 style)",
      description:
        "Constructors marked public are valid pre-Solidity 0.7 but have no effect in 0.7+. Remove the visibility modifier.",
    },
    {
      re:          /\bevent\s+\w+\s*\([^)]*\)\s*;/,
      severity:    "info",
      title:       "Events declared",
      description: "Events found — ensure critical state transitions emit events for off-chain indexers and auditors.",
    },
    {
      re:          /mapping\s*\(\s*address\s*=>/,
      severity:    "info",
      title:       "Address mapping found",
      description: "Address-keyed mappings are common for balances and allowances. Confirm all writes are properly access-controlled.",
    },
  ];

  // Reentrancy: state write after external call heuristic
  // Look for lines with `.call` followed by a state-write pattern within 10 lines
  let lastCallLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\.(call|send|transfer)\s*[\({]/.test(line)) lastCallLine = i;
    if (
      lastCallLine >= 0 &&
      i > lastCallLine &&
      i <= lastCallLine + 10 &&
      /\b\w+\s*[\[\(].*\]\s*[+\-]?=/.test(line) &&
      !/\/\//.test(line.trimStart())
    ) {
      findings.push({
        severity:    "high",
        title:       "Potential reentrancy: state write after external call",
        description:
          "A state variable appears to be written after an external call. An attacker may re-enter the function before the state is updated. Apply checks-effects-interactions or a ReentrancyGuard.",
        line:        i + 1,
        context:     lines.slice(Math.max(0, lastCallLine), i + 1).join("\n").trim(),
      });
      lastCallLine = -1; // only flag once per call site
    }
  }

  // Run per-line pattern checks
  for (const { re, severity, title, description } of patterns) {
    for (let i = 0; i < lines.length; i++) {
      const stripped = lines[i].replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      if (re.test(stripped)) {
        // De-duplicate by title+line
        const alreadySeen = findings.some((f) => f.title === title && f.line === i + 1);
        if (!alreadySeen) {
          findings.push({
            severity,
            title,
            description,
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
// AST-level scan via solc --ast-compact-json
// ---------------------------------------------------------------------------
function astScan(astJson: string, _sourceLines: string[]): Finding[] {
  const findings: Finding[] = [];
  let ast: unknown;
  try {
    ast = JSON.parse(astJson);
  } catch {
    return findings;
  }

  // Walk the AST recursively
  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;

    // Missing zero-address check on address parameters
    if (n.nodeType === "FunctionDefinition") {
      const params = (n.parameters as Record<string, unknown[]>)?.parameters ?? [];
      const hasAddressParam = (params as Record<string, unknown>[]).some(
        (p) => (p.typeDescriptions as Record<string, unknown>)?.typeString === "address",
      );
      const body = n.body as Record<string, unknown> | null;
      if (hasAddressParam && body) {
        const bodyStr = JSON.stringify(body);
        const hasZeroCheck =
          bodyStr.includes("address(0)") || bodyStr.includes("0x0000000000000000000000000000000000000000");
        if (!hasZeroCheck) {
          const src = (n.src as string) ?? "";
          const lineNum = src ? parseInt(src.split(":")[0], 10) : null;
          findings.push({
            severity:    "low",
            title:       `Missing zero-address check in "${n.name as string}"`,
            description:
              `Function "${n.name as string}" accepts an address parameter but does not validate it against address(0). A zero address can lead to locked funds or broken logic.`,
            line:        lineNum,
          });
        }
      }
    }

    // Detect public/external state-mutating functions with no modifier (access control)
    if (
      n.nodeType === "FunctionDefinition" &&
      (n.visibility === "public" || n.visibility === "external") &&
      n.stateMutability !== "view" &&
      n.stateMutability !== "pure" &&
      !(n.modifiers as unknown[] | undefined)?.length &&
      n.kind !== "constructor" &&
      n.name !== "receive" &&
      n.name !== "fallback"
    ) {
      findings.push({
        severity:    "info",
        title:       `Unguarded public/external function: "${n.name as string}"`,
        description: `"${n.name as string}" is ${n.visibility as string} and state-mutating but has no modifiers. Confirm that no access control is required, or add an onlyOwner / role check.`,
      });
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
// ProviderWorker class
// ---------------------------------------------------------------------------
export class ProviderWorker {
  private pool:            Pool;
  private providerAgentId: string;
  private timer:           NodeJS.Timeout | null = null;

  constructor(pool: Pool, providerAgentId: string) {
    this.pool            = pool;
    this.providerAgentId = providerAgentId;
  }

  start() {
    console.log("[ProviderWorker] Starting poll loop");
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try { await this.processNextTask(); }
    catch (err) { console.error("[ProviderWorker] tick error:", err); }
  }

  private async processNextTask() {
    const { rows } = await this.pool.query<{
      id:              string;
      onchain_task_id: string;
      input_json:      { sourceCode: string };
      criteria_json:   AcceptanceCriteria;
    }>(
      `UPDATE tasks SET
        status = 'processing', worker_claimed_at = NOW(), updated_at = NOW()
      WHERE id = (
        SELECT id FROM tasks
        WHERE status = 'funded'
          AND provider_agent_id = $1
          AND (worker_claimed_at IS NULL OR worker_claimed_at < NOW() - INTERVAL '10 minutes')
        ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
      )
      RETURNING id, onchain_task_id, input_json, criteria_json`,
      [this.providerAgentId],
    );
    if (rows.length === 0) return;
    const task = rows[0];
    console.log(`[ProviderWorker] Claimed task ${task.id}`);
    try {
      await this.executeTask(task.id, task.onchain_task_id, task.input_json, task.criteria_json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ProviderWorker] Task ${task.id} failed:`, msg);
      await this.pool.query(
        "UPDATE tasks SET status='funded', last_error=$1, worker_claimed_at=NULL, updated_at=NOW() WHERE id=$2",
        [msg, task.id],
      );
    }
  }

  private async executeTask(
    taskId:        string,
    onchainTaskId: string,
    input:         { sourceCode: string },
    _criteria:     AcceptanceCriteria,
  ) {
    const sourceCode  = input.sourceCode;
    const sourceLines = sourceCode.split("\n");
    const dir         = mkdtempSync(join(tmpdir(), "agetbazar-"));
    const srcFile     = join(dir, "Contract.sol");

    let compilerStatus = "success";
    let compilerOutput = "";
    let solcVersion    = "unavailable";
    const findings:    Finding[] = [];

    try {
      writeFileSync(srcFile, sourceCode, "utf8");

      const ozLib    = process.env.OZ_CONTRACTS_PATH ??
        "/home/user/app/contracts/lib/openzeppelin-contracts/contracts";
      const ozRemap  = `@openzeppelin/contracts/=${ozLib}/`;

      // Determine solc version
      try {
        const verOut = execFileSync("solc", ["--version"], { timeout: 5_000 }).toString();
        solcVersion  = verOut.trim().split("\n").pop()?.trim() ?? "unknown";
      } catch {
        compilerStatus = "unavailable";
        findings.push({
          severity:    "info",
          title:       "Compiler unavailable",
          description: "solc is not installed; compilation and AST analysis were skipped.",
        });
      }

      if (compilerStatus !== "unavailable") {
        // --- Step 1: compile ---
        try {
          execFileSync(
            "solc",
            ["--no-cbor-metadata", ozRemap, srcFile, "--overwrite"],
            { timeout: WORKER_TIMEOUT_MS, cwd: dir },
          );
        } catch (solcErr) {
          compilerStatus = "error";
          compilerOutput = String(solcErr instanceof Error ? solcErr.message : solcErr);
          findings.push({
            severity:    "high",
            title:       "Compilation failed",
            description: compilerOutput,
          });
        }

        // --- Step 2: AST scan (only on success) ---
        if (compilerStatus === "success") {
          try {
            const astOut = execFileSync(
              "solc",
              ["--ast-compact-json", ozRemap, srcFile, "--overwrite"],
              { timeout: WORKER_TIMEOUT_MS, cwd: dir },
            ).toString();
            // solc outputs AST after "======= <file> ======="
            const astMatch = astOut.match(/=======.*?=======\n([\s\S]+)/);
            if (astMatch) {
              const astFindings = astScan(astMatch[1], sourceLines);
              findings.push(...astFindings);
            }
          } catch {
            // AST scan failed — not blocking
          }

          // --- Step 3: solc warnings from --bin run ---
          try {
            const warnOut = execFileSync(
              "solc",
              ["--bin", ozRemap, srcFile, "--overwrite"],
              { timeout: WORKER_TIMEOUT_MS, cwd: dir, encoding: "utf8" },
            );
            // Parse Warning: lines
            const warnRe = /Warning:\s*([^\n]+)\n(?:.*\n)*?.*--> [^:]+:(\d+):/g;
            let m: RegExpExecArray | null;
            while ((m = warnRe.exec(warnOut)) !== null) {
              findings.push({
                severity:    "low",
                title:       `Solc warning`,
                description: m[1].trim(),
                line:        parseInt(m[2], 10),
              });
            }
          } catch {
            // warnings parse failure — not blocking
          }
        }

        // --- Step 4: heuristic pattern scan (always) ---
        const heuristics = heuristicScan(sourceCode);
        findings.push(...heuristics);
      }

      // Deduplicate findings: same title+line = keep first
      const seen = new Set<string>();
      const deduped: Finding[] = [];
      for (const f of findings) {
        const key = `${f.title}|${f.line ?? ""}`;
        if (!seen.has(key)) { seen.add(key); deduped.push(f); }
      }

      // Sort by severity weight
      const weight: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      deduped.sort((a, b) => weight[a.severity] - weight[b.severity]);

      // Remove the temp dir before building the report
      rmSync(dir, { recursive: true, force: true });

      // Build counts
      const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
      for (const f of deduped) counts[f.severity]++;

      const sourceHashHex = keccak256(toBytes(sourceCode));
      const report = {
        schemaVersion: 1,
        taskId,
        sourceHash:    sourceHashHex,
        analysis: {
          compilerStatus,
          compilerOutput: compilerOutput || null,
          toolName:       "solc",
          toolVersion:    solcVersion,
          findings:       deduped,
          counts,
        },
        summary: this.buildSummary(deduped, compilerStatus),
        createdAt: new Date().toISOString(),
      };

      const resultJson    = stableStringify(report);
      const resultHashHex = keccak256(toBytes(resultJson)) as `0x${string}`;

      await this.pool.query(
        `UPDATE tasks SET result_json=$1::jsonb, result_hash=$2, updated_at=NOW() WHERE id=$3`,
        [resultJson, resultHashHex, taskId],
      );

      if (!ESCROW_ADDRESS) throw new Error("ESCROW_ADDRESS not configured");
      const publicClient   = createPublic();
      const providerWallet = createProviderWallet();

      const submitHash = await providerWallet.writeContract({
        address:      ESCROW_ADDRESS,
        abi:          escrowAbi,
        functionName: "submitResult",
        args:         [BigInt(onchainTaskId), resultHashHex],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: submitHash });
      if (receipt.status !== "success") throw new Error(`submitResult reverted: ${submitHash}`);

      let reviewDeadline: string | null = null;
      for (const log of receipt.logs as Log[]) {
        try {
          const decoded = decodeEventLog({ abi: escrowAbi, data: log.data, topics: log.topics, eventName: "ResultSubmitted" });
          reviewDeadline = new Date(Number(decoded.args.reviewDeadline as bigint) * 1000).toISOString();
          break;
        } catch { /* not this event */ }
      }

      await this.pool.query(
        `UPDATE tasks SET status='submitted', submit_tx_hash=$1, review_deadline=$2, updated_at=NOW() WHERE id=$3`,
        [submitHash, reviewDeadline, taskId],
      );

      await this.pool.query(
        `INSERT INTO task_events (id, task_id, source, event_type, tx_hash, payload, created_at)
         VALUES ($1,$2,'chain','ResultSubmitted',$3,$4,NOW())`,
        [uuidv4(), taskId, submitHash, JSON.stringify({ resultHash: resultHashHex })],
      );

      console.log(`[ProviderWorker] Task ${taskId} submitted. Hash: ${submitHash}`);
    } catch (err) {
      rmSync(dir, { recursive: true, force: true });
      throw err;
    }
  }

  private buildSummary(findings: Finding[], compilerStatus: string): string {
    if (compilerStatus === "error") return "Compilation failed — no security analysis could be performed.";
    if (compilerStatus === "unavailable") return "Compiler unavailable — heuristic scan only.";
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of findings) counts[f.severity as Severity]++;
    const issues = [
      counts.critical && `${counts.critical} critical`,
      counts.high     && `${counts.high} high`,
      counts.medium   && `${counts.medium} medium`,
      counts.low      && `${counts.low} low`,
    ].filter(Boolean);
    if (issues.length === 0) return "No significant vulnerabilities detected. Review info findings for best-practice improvements.";
    return `Found ${issues.join(", ")} severity issue(s). Review each finding carefully before deploying to production.`;
  }
}

// Suppress unused import warning — readFileSync kept for future artifact reads
void readFileSync;
