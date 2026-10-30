"use client";
import { useState, useRef, useCallback } from "react";
import {
  Shield, ShieldAlert, ShieldCheck, ShieldX,
  Loader2, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  Bot, Wrench, Zap, Clock, Code2, Activity,
  AlertTriangle, Info, Copy, Check,
} from "lucide-react";
import clsx from "clsx";
import type { AuditReport, AuditFinding, AuditSeverity, FindingOrigin } from "@agetbazar/shared";

// ─── Default vulnerable contract ────────────────────────────────────────────
const DEFAULT_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract VulnerableVault {
    mapping(address => uint256) public balances;
    address public owner;

    constructor() {
        owner = tx.origin; // vulnerability: tx.origin
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "insufficient");
        // vulnerability: state update after external call (reentrancy)
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        balances[msg.sender] -= amount;
    }

    function adminWithdraw(address to, uint256 amount) external {
        // vulnerability: no access control
        (bool ok,) = to.call{value: amount}("");
        require(ok, "failed");
    }

    function setOwner(address newOwner) external {
        // vulnerability: no access control, no zero-address check
        owner = newOwner;
    }
}`;

// ─── Severity helpers ────────────────────────────────────────────────────────
const SEV_CONFIG: Record<AuditSeverity, {
  label: string; ring: string; badge: string; card: string; icon: React.ElementType;
}> = {
  critical: { label: "Critical", ring: "ring-red-500",    badge: "bg-red-700 text-red-100",     card: "border-red-800 bg-red-950/30",     icon: ShieldX },
  high:     { label: "High",     ring: "ring-orange-500", badge: "bg-orange-700 text-orange-100", card: "border-orange-800 bg-orange-950/30", icon: ShieldAlert },
  medium:   { label: "Medium",   ring: "ring-yellow-500", badge: "bg-yellow-700 text-yellow-100", card: "border-yellow-800 bg-yellow-950/30", icon: AlertTriangle },
  low:      { label: "Low",      ring: "ring-blue-500",   badge: "bg-blue-700 text-blue-100",    card: "border-blue-800 bg-blue-950/30",    icon: Shield },
  info:     { label: "Info",     ring: "ring-slate-500",  badge: "bg-slate-700 text-slate-300",  card: "border-slate-700 bg-slate-800/30",  icon: Info },
};

const ORIGIN_CONFIG: Record<FindingOrigin, { label: string; color: string; icon: React.ElementType }> = {
  corroborated:  { label: "Corroborated",  color: "bg-violet-900/60 text-violet-300 border-violet-700", icon: Zap },
  tool_confirmed:{ label: "Tool",          color: "bg-sky-900/60 text-sky-300 border-sky-700",           icon: Wrench },
  ai_identified: { label: "AI",            color: "bg-emerald-900/60 text-emerald-300 border-emerald-700", icon: Bot },
  unverified:    { label: "Unverified",    color: "bg-slate-800/60 text-slate-400 border-slate-600",     icon: Info },
};

// ─── Score ring component ────────────────────────────────────────────────────
function ScoreRing({ score, verdict }: { score: number; verdict: string }) {
  const r = 44;
  const circ = 2 * Math.PI * r;
  const progress = ((100 - score) / 100) * circ;
  const color =
    verdict === "PASS"            ? "#22c55e" :
    verdict === "REVIEW_REQUIRED" ? "#f59e0b" : "#ef4444";
  const trackColor = "#1e293b";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-28 h-28">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke={trackColor} strokeWidth="8" />
          <circle
            cx="50" cy="50" r={r} fill="none"
            stroke={color} strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={progress}
            style={{ transition: "stroke-dashoffset 1s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-white">{score}</span>
          <span className="text-xs text-slate-400 font-medium">/100</span>
        </div>
      </div>
      <span className={clsx(
        "px-3 py-1 rounded-full text-xs font-bold tracking-widest uppercase",
        verdict === "PASS"            && "bg-green-900/50 text-green-300 border border-green-700",
        verdict === "REVIEW_REQUIRED" && "bg-yellow-900/50 text-yellow-300 border border-yellow-700",
        verdict === "FAIL"            && "bg-red-900/50 text-red-300 border border-red-700",
      )}>
        {verdict?.replace("_", " ")}
      </span>
    </div>
  );
}

// ─── Finding card ────────────────────────────────────────────────────────────
function FindingCard({ f, idx }: { f: AuditFinding; idx: number }) {
  const [open, setOpen] = useState(idx < 2);
  const sev = SEV_CONFIG[f.severity];
  const orig = ORIGIN_CONFIG[f.origin];
  const OrigIcon = orig.icon;

  return (
    <div className={clsx("rounded-xl border p-4 space-y-3 transition-all", sev.card)}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between gap-3 text-left"
      >
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className={clsx("flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", sev.badge)}>
            {f.severity}
          </span>
          <span className={clsx("flex-shrink-0 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border", orig.color)}>
            <OrigIcon className="w-2.5 h-2.5" /> {orig.label}
          </span>
          {f.detectorId && (
            <span className="flex-shrink-0 font-mono text-[10px] text-slate-500 bg-slate-800 rounded px-1.5 py-0.5">
              {f.detectorId}
            </span>
          )}
          <span className="text-sm font-semibold text-slate-100 break-words">{f.title}</span>
          {f.line != null && (
            <span className="flex-shrink-0 text-xs text-slate-500">line {f.line}</span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 flex-shrink-0 text-slate-500 mt-0.5" /> : <ChevronDown className="w-4 h-4 flex-shrink-0 text-slate-500 mt-0.5" />}
      </button>

      {open && (
        <div className="space-y-3 pt-1 border-t border-white/5">
          <p className="text-sm text-slate-300 leading-relaxed">{f.description}</p>

          {f.context && (
            <pre className="rounded-lg bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs font-mono text-slate-400 overflow-x-auto whitespace-pre-wrap">
              {f.context}
            </pre>
          )}

          {f.exploitScenario && (
            <div className="rounded-lg bg-red-950/30 border border-red-900/50 p-3 space-y-1">
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" /> Exploit Scenario
              </p>
              <p className="text-sm text-red-200/80 leading-relaxed">{f.exploitScenario}</p>
            </div>
          )}

          {f.remediation && (
            <div className="rounded-lg bg-green-950/30 border border-green-900/50 p-3 space-y-1">
              <p className="text-xs font-semibold text-green-400 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" /> Remediation
              </p>
              <p className="text-sm text-green-200/80 leading-relaxed">{f.remediation}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Coverage row ────────────────────────────────────────────────────────────
function CoverageRow({ icon: Icon, label, status, detail }: {
  icon: React.ElementType; label: string; status: "ok" | "warn" | "skip"; detail: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className={clsx(
        "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0",
        status === "ok"   && "bg-green-900/50 text-green-400",
        status === "warn" && "bg-yellow-900/50 text-yellow-400",
        status === "skip" && "bg-slate-800 text-slate-500",
      )}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-200">{label}</p>
        <p className="text-xs text-slate-500 truncate">{detail}</p>
      </div>
    </div>
  );
}

// ─── Progress step ────────────────────────────────────────────────────────────
interface ProgressStep { stage: string; message: string; done?: boolean; error?: boolean; }

// ─── Main page ───────────────────────────────────────────────────────────────
export default function AnalyzePage() {
  const [source,       setSource]       = useState(DEFAULT_SOURCE);
  const [phase,        setPhase]        = useState<"idle" | "running" | "done" | "error">("idle");
  const [steps,        setSteps]        = useState<ProgressStep[]>([]);
  const [report,       setReport]       = useState<AuditReport | null>(null);
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null);
  const [activeTab,    setActiveTab]    = useState<"findings" | "code" | "coverage">("findings");
  const [copied,       setCopied]       = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const addStep = useCallback((step: ProgressStep) => {
    setSteps((prev) => [...prev, step]);
  }, []);

  async function handleAnalyze() {
    if (!source.trim() || phase === "running") return;
    abortRef.current = new AbortController();
    setPhase("running");
    setSteps([]);
    setReport(null);
    setErrorMsg(null);
    setActiveTab("findings");

    try {
      const resp = await fetch("/api/audit", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ sourceCode: source }),
        signal:  abortRef.current.signal,
      });

      if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(() => "Unknown error");
        throw new Error(text);
      }

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line) as {
              type: string;
              stage?: string; message?: string; done?: boolean; error?: boolean;
              report?: AuditReport;
              message_text?: string;
            };
            if (evt.type === "progress") {
              addStep({ stage: evt.stage ?? "", message: evt.message ?? "", done: evt.done, error: evt.error });
            } else if (evt.type === "complete" && evt.report) {
              setReport(evt.report);
              setPhase("done");
            } else if (evt.type === "error") {
              setErrorMsg(evt.message ?? "Analysis failed");
              setPhase("error");
            }
          } catch { /* malformed SSE line */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(source).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const TABS = [
    { id: "findings", label: `Findings ${report ? `(${report.findings.length})` : ""}`,   icon: ShieldAlert },
    { id: "code",     label: "Contract Source",    icon: Code2 },
    { id: "coverage", label: "Coverage",            icon: Activity },
  ] as const;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-sky-400" />
            Solidity Security Analyzer
          </h1>
          <p className="text-slate-400 text-sm">
            One engine — BlockRun AI inference + Solc + Slither — correlated findings, 0–100 risk score.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Left: source editor */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-300">Contract Source</label>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <textarea
              value={source}
              onChange={(e) => setSource(e.target.value)}
              disabled={phase === "running"}
              rows={28}
              spellCheck={false}
              className="w-full rounded-xl bg-slate-900 border border-slate-700 text-sm font-mono text-slate-200 p-4 resize-none focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500/50 disabled:opacity-60 transition-all"
              placeholder="// Paste your Solidity contract here…"
            />
            <button
              onClick={handleAnalyze}
              disabled={phase === "running" || !source.trim()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-600 to-violet-600 text-white font-semibold text-sm hover:from-sky-500 hover:to-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {phase === "running" ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing…</>
              ) : (
                <><Shield className="w-4 h-4" /> Run Security Audit</>
              )}
            </button>
          </div>

          {/* Right: progress + results */}
          <div className="space-y-4">
            {/* Progress log */}
            {(phase === "running" || steps.length > 0) && (
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 space-y-2 max-h-64 overflow-y-auto">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Analysis Progress
                </p>
                {steps.map((s, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-xs">
                    {s.error ? (
                      <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                    ) : s.done ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-400 mt-0.5 flex-shrink-0" />
                    ) : (
                      <div className="w-3.5 h-3.5 rounded-full bg-sky-500/30 border border-sky-500 mt-0.5 flex-shrink-0 animate-pulse" />
                    )}
                    <div className="min-w-0">
                      <span className="text-slate-500 font-mono">[{s.stage}]</span>{" "}
                      <span className={s.error ? "text-red-300" : "text-slate-300"}>{s.message}</span>
                    </div>
                  </div>
                ))}
                {phase === "running" && (
                  <div className="flex items-center gap-2 text-xs text-sky-400 pt-1">
                    <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                    Running in parallel…
                  </div>
                )}
              </div>
            )}

            {/* Error state */}
            {phase === "error" && errorMsg && (
              <div className="rounded-xl bg-red-950/40 border border-red-800 p-4 flex gap-3">
                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-300">Analysis failed</p>
                  <p className="text-xs text-red-400 mt-1">{errorMsg}</p>
                </div>
              </div>
            )}

            {/* Score ring + counts */}
            {report && (
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-5">
                <div className="flex items-center justify-between gap-4">
                  <ScoreRing score={report.score} verdict={report.verdict} />
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    {(["critical","high","medium","low","info"] as AuditSeverity[]).map((sev) => (
                      <div key={sev} className={clsx(
                        "rounded-lg p-2 text-center border",
                        SEV_CONFIG[sev].card,
                      )}>
                        <p className="text-lg font-bold text-white">{report.counts[sev] ?? 0}</p>
                        <p className={clsx("text-[10px] font-semibold uppercase tracking-wider mt-0.5", SEV_CONFIG[sev].badge.split(" ")[1])}>
                          {sev}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-4 leading-relaxed">{report.summary}</p>
              </div>
            )}
          </div>
        </div>

        {/* Tabbed report section */}
        {report && (
          <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
            {/* Tab bar */}
            <div className="flex border-b border-slate-800">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={clsx(
                      "flex items-center gap-2 px-5 py-3.5 text-sm font-medium transition-colors",
                      activeTab === tab.id
                        ? "text-sky-400 border-b-2 border-sky-500 bg-sky-950/20"
                        : "text-slate-400 hover:text-slate-200",
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="p-5">
              {/* Findings tab */}
              {activeTab === "findings" && (
                <div className="space-y-3">
                  {report.findings.length === 0 ? (
                    <div className="text-center py-12 text-slate-500">
                      <ShieldCheck className="w-10 h-10 mx-auto mb-3 text-green-500" />
                      <p className="font-medium text-green-400">No findings detected</p>
                      <p className="text-sm mt-1">The contract passed all checks.</p>
                    </div>
                  ) : (
                    report.findings.map((f, i) => <FindingCard key={f.id} f={f} idx={i} />)
                  )}
                </div>
              )}

              {/* Contract source tab */}
              {activeTab === "code" && (
                <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-auto max-h-[600px]">
                  <div className="p-4">
                    {source.split("\n").map((line, i) => {
                      const lineNum = i + 1;
                      const findingsOnLine = report.findings.filter((f) => f.line === lineNum);
                      const maxSev = findingsOnLine.length > 0
                        ? (findingsOnLine.find((f) => f.severity === "critical") ? "critical"
                          : findingsOnLine.find((f) => f.severity === "high") ? "high"
                          : findingsOnLine.find((f) => f.severity === "medium") ? "medium"
                          : findingsOnLine.find((f) => f.severity === "low") ? "low" : "info")
                        : null;

                      return (
                        <div key={i} className={clsx(
                          "flex gap-3 font-mono text-xs leading-5 px-1 rounded",
                          maxSev && "bg-yellow-950/30",
                        )}>
                          <span className="select-none text-slate-600 w-8 text-right flex-shrink-0">{lineNum}</span>
                          <span className={clsx(
                            "flex-1 whitespace-pre",
                            maxSev ? SEV_CONFIG[maxSev].badge.split(" ")[1] : "text-slate-300",
                          )}>{line || " "}</span>
                          {findingsOnLine.length > 0 && (
                            <span className={clsx(
                              "flex-shrink-0 text-[10px] font-bold rounded px-1",
                              maxSev && SEV_CONFIG[maxSev].badge,
                            )}>
                              {findingsOnLine[0].severity.toUpperCase()}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Coverage tab */}
              {activeTab === "coverage" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Solc */}
                    <div className="rounded-xl bg-slate-800/50 border border-slate-700 p-4 space-y-2">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Wrench className="w-3.5 h-3.5" /> Solc
                      </p>
                      <CoverageRow
                        icon={CheckCircle2}
                        label="Compiler"
                        status={report.coverage.solc.compiled ? "ok" : report.coverage.solc.ran ? "warn" : "skip"}
                        detail={report.solcVersion}
                      />
                      <p className="text-xs text-slate-500">
                        {report.coverage.solc.findings} finding(s) from solc
                      </p>
                    </div>

                    {/* Slither */}
                    <div className="rounded-xl bg-slate-800/50 border border-slate-700 p-4 space-y-2">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5" /> Slither
                      </p>
                      <CoverageRow
                        icon={report.coverage.slither.installed ? CheckCircle2 : XCircle}
                        label={report.coverage.slither.installed ? "Installed" : "Not installed"}
                        status={report.coverage.slither.installed ? "ok" : "skip"}
                        detail={`${report.coverage.slither.findings} detector result(s)`}
                      />
                      {report.coverage.slither.detectors.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {report.coverage.slither.detectors.slice(0, 4).map((d) => (
                            <span key={d} className="text-[10px] font-mono bg-slate-700 text-slate-400 rounded px-1.5 py-0.5">{d.replace("slither-","")}</span>
                          ))}
                          {report.coverage.slither.detectors.length > 4 && (
                            <span className="text-[10px] text-slate-500">+{report.coverage.slither.detectors.length - 4} more</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* BlockRun AI */}
                    <div className="rounded-xl bg-slate-800/50 border border-slate-700 p-4 space-y-2">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Bot className="w-3.5 h-3.5" /> BlockRun AI
                      </p>
                      <CoverageRow
                        icon={report.coverage.blockrunAi.ran ? CheckCircle2 : XCircle}
                        label={report.coverage.blockrunAi.ran ? "Inference complete" : "Skipped"}
                        status={report.coverage.blockrunAi.ran ? "ok" : "skip"}
                        detail={report.coverage.blockrunAi.ran
                          ? `${report.coverage.blockrunAi.model}`
                          : (report.coverage.blockrunAi.skipReason ?? "BLOCKRUN_AI_PAYER_KEY not set")}
                      />
                      {report.blockrunReceipt && (
                        <div className="space-y-0.5 mt-1">
                          <p className="text-xs text-slate-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {report.blockrunReceipt.latencyMs}ms
                            {report.blockrunReceipt.tokensUsed != null && ` · ${report.blockrunReceipt.tokensUsed} tokens`}
                          </p>
                          {report.blockrunReceipt.txHash && (
                            <a
                              href={`https://explorer.testnet.arc.io/tx/${report.blockrunReceipt.txHash}`}
                              target="_blank" rel="noopener noreferrer"
                              className="text-xs text-sky-400 hover:text-sky-300 font-mono truncate block"
                            >
                              {report.blockrunReceipt.txHash.slice(0, 20)}…
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Score breakdown */}
                  {report.scoreBreakdown.findings.length > 0 && (
                    <div className="rounded-xl bg-slate-800/50 border border-slate-700 p-4 space-y-3">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Score Breakdown</p>
                      <p className="text-sm text-slate-300">
                        Base: <strong>100</strong> − Penalties: <strong>{report.scoreBreakdown.totalPenalty}</strong> = <strong className="text-white">{report.score}</strong>
                      </p>
                      <div className="space-y-1.5">
                        {report.scoreBreakdown.findings.map((item) => (
                          <div key={item.findingId} className="flex items-center justify-between text-xs">
                            <span className="text-slate-400 truncate flex-1 pr-4">{item.title}</span>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className={clsx("rounded px-1.5 py-0.5 font-bold text-[10px]", SEV_CONFIG[item.severity].badge)}>
                                {item.severity}
                              </span>
                              <span className="text-red-400 font-mono w-8 text-right">−{item.penalty}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Idle state hint */}
        {phase === "idle" && (
          <div className="rounded-xl bg-slate-900/50 border border-slate-800 p-8 text-center space-y-2">
            <Shield className="w-8 h-8 mx-auto text-slate-600" />
            <p className="text-slate-500 text-sm">Paste a Solidity contract above and click Run Security Audit.</p>
            <p className="text-slate-600 text-xs">Runs BlockRun AI + Solc + Slither in parallel. Results include exploit scenarios, remediations, and a 0–100 risk score.</p>
          </div>
        )}
      </div>
    </div>
  );
}
