"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { TxLink } from "@/components/TxLink";
import { isActive } from "@agetbazar/shared";
import type { Task, TaskEvent, AuditReport, AuditFinding, AuditSeverity, FindingOrigin } from "@agetbazar/shared";
import {
  CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp,
  Code2, FileSearch, Activity, ExternalLink, Shield, ShieldAlert, ShieldCheck,
  Bot, Wrench, Zap, Info,
} from "lucide-react";
import clsx from "clsx";

const EXPLORER = "https://explorer.testnet.arc.io";

// ─── Severity / origin config ────────────────────────────────────────────────
const SEV_CONFIG: Record<AuditSeverity, { badge: string; card: string }> = {
  critical: { badge: "bg-red-700 text-red-100",       card: "border-red-800 bg-red-950/30" },
  high:     { badge: "bg-orange-700 text-orange-100", card: "border-orange-800 bg-orange-950/30" },
  medium:   { badge: "bg-yellow-700 text-yellow-100", card: "border-yellow-800 bg-yellow-950/30" },
  low:      { badge: "bg-blue-700 text-blue-100",     card: "border-blue-800 bg-blue-950/30" },
  info:     { badge: "bg-slate-700 text-slate-300",   card: "border-slate-700 bg-slate-800/30" },
};

const ORIGIN_CONFIG: Record<FindingOrigin, { label: string; color: string; icon: React.ElementType }> = {
  corroborated:   { label: "Corroborated",  color: "bg-violet-900/60 text-violet-300 border-violet-700", icon: Zap },
  tool_confirmed: { label: "Tool",          color: "bg-sky-900/60 text-sky-300 border-sky-700",           icon: Wrench },
  ai_identified:  { label: "AI",            color: "bg-emerald-900/60 text-emerald-300 border-emerald-700", icon: Bot },
  unverified:     { label: "Unverified",    color: "bg-slate-800/60 text-slate-400 border-slate-600",     icon: Info },
};

// ─── Score ring ──────────────────────────────────────────────────────────────
function ScoreRing({ score, verdict }: { score: number; verdict: string }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const color = verdict === "PASS" ? "#22c55e" : verdict === "REVIEW_REQUIRED" ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-24 h-24">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 82 82">
          <circle cx="41" cy="41" r={r} fill="none" stroke="#1e293b" strokeWidth="7" />
          <circle cx="41" cy="41" r={r} fill="none" stroke={color} strokeWidth="7"
            strokeLinecap="round" strokeDasharray={circ}
            strokeDashoffset={((100 - score) / 100) * circ}
            style={{ transition: "stroke-dashoffset 1s ease" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-white">{score}</span>
          <span className="text-[10px] text-slate-400">/100</span>
        </div>
      </div>
      <span className={clsx(
        "px-2 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase",
        verdict === "PASS"            && "bg-green-900/50 text-green-300 border border-green-700",
        verdict === "REVIEW_REQUIRED" && "bg-yellow-900/50 text-yellow-300 border border-yellow-700",
        verdict === "FAIL"            && "bg-red-900/50 text-red-300 border border-red-700",
        !verdict && "bg-slate-800 text-slate-400 border border-slate-600",
      )}>
        {verdict?.replace("_", " ") ?? "—"}
      </span>
    </div>
  );
}

// ─── Finding card (v2) ───────────────────────────────────────────────────────
function FindingCardV2({ f, idx }: { f: AuditFinding; idx: number }) {
  const [open, setOpen] = useState(idx < 2);
  const sev  = SEV_CONFIG[f.severity];
  const orig = ORIGIN_CONFIG[f.origin ?? "unverified"];
  const OrigIcon = orig.icon;
  return (
    <div className={clsx("rounded-xl border p-4 space-y-3", sev.card)}>
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between gap-3 text-left">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className={clsx("flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", sev.badge)}>{f.severity}</span>
          <span className={clsx("flex-shrink-0 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border", orig.color)}>
            <OrigIcon className="w-2.5 h-2.5" />{orig.label}
          </span>
          {f.detectorId && <span className="font-mono text-[10px] bg-slate-800 text-slate-500 rounded px-1.5 py-0.5">{f.detectorId}</span>}
          <span className="text-sm font-semibold text-slate-100">{f.title}</span>
          {f.line != null && <span className="text-xs text-slate-500">line {f.line}</span>}
        </div>
        {open ? <ChevronUp className="w-4 h-4 flex-shrink-0 text-slate-500" /> : <ChevronDown className="w-4 h-4 flex-shrink-0 text-slate-500" />}
      </button>
      {open && (
        <div className="space-y-3 pt-1 border-t border-white/5">
          <p className="text-sm text-slate-300">{f.description}</p>
          {f.context && (
            <pre className="rounded-lg bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs font-mono text-slate-400 overflow-x-auto whitespace-pre-wrap">{f.context}</pre>
          )}
          {f.exploitScenario && (
            <div className="rounded-lg bg-red-950/30 border border-red-900/50 p-3 space-y-1">
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />Exploit Scenario
              </p>
              <p className="text-sm text-red-200/80">{f.exploitScenario}</p>
            </div>
          )}
          {f.remediation && (
            <div className="rounded-lg bg-green-950/30 border border-green-900/50 p-3 space-y-1">
              <p className="text-xs font-semibold text-green-400 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />Remediation
              </p>
              <p className="text-sm text-green-200/80">{f.remediation}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Legacy finding card (v1 schema) ────────────────────────────────────────
interface LegacyFinding {
  severity: AuditSeverity; title: string; description: string; line?: number | null; context?: string;
}
function FindingCardV1({ f, idx }: { f: LegacyFinding; idx: number }) {
  const [open, setOpen] = useState(idx < 3);
  const sev = SEV_CONFIG[f.severity];
  return (
    <div className={clsx("rounded-xl border p-4 space-y-2", sev.card)}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 text-left">
        <div className="flex items-center gap-2 min-w-0">
          <span className={clsx("flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", sev.badge)}>{f.severity}</span>
          <span className="text-sm font-semibold text-slate-100 truncate">{f.title}</span>
          {f.line != null && <span className="text-xs text-slate-500">line {f.line}</span>}
        </div>
        {open ? <ChevronUp className="w-4 h-4 flex-shrink-0 text-slate-500" /> : <ChevronDown className="w-4 h-4 flex-shrink-0 text-slate-500" />}
      </button>
      {open && (
        <div className="space-y-2 pt-1">
          <p className="text-sm text-slate-300">{f.description}</p>
          {f.context && <pre className="rounded-lg bg-slate-900/60 border border-slate-700 px-3 py-2 text-xs font-mono text-slate-400 overflow-x-auto whitespace-pre-wrap">{f.context}</pre>}
        </div>
      )}
    </div>
  );
}

// ─── Timeline ────────────────────────────────────────────────────────────────
const EVENT_LABELS: Record<string, string> = {
  TaskCreated:     "Task funded on-chain",
  ResultSubmitted: "Result submitted by provider",
  TaskPaid:        "Payment released to provider",
  TaskRefunded:    "Escrowed USDC refunded",
};

function Timeline({ events }: { events: TaskEvent[] }) {
  if (!events.length) return <p className="text-sm text-slate-500">No on-chain events yet.</p>;
  return (
    <ol className="relative border-l border-slate-700 space-y-5 pl-6">
      {events.map((ev) => (
        <li key={ev.id} className="relative">
          <span className="absolute -left-[26px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-sky-700 ring-4 ring-slate-950" />
          <p className="text-sm font-medium text-slate-200">{EVENT_LABELS[ev.eventType] ?? ev.eventType}</p>
          <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2">
            <span>{new Date(ev.createdAt).toLocaleString()}</span>
            {ev.txHash && (
              <a href={`${EXPLORER}/tx/${ev.txHash}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-sky-400 hover:text-sky-300">
                {ev.txHash.slice(0,10)}…{ev.txHash.slice(-8)}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {(ev.payload as { score?: number; verdict?: string }).score != null && (
              <span className="text-slate-400">
                Score: {(ev.payload as { score: number }).score}/100 · {(ev.payload as { verdict: string }).verdict}
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type Tab = "report" | "code" | "timeline";

export default function TaskDetailPage() {
  const { id }     = useParams<{ id: string }>();
  const [task,     setTask]    = useState<Task | null>(null);
  const [events,   setEvents]  = useState<TaskEvent[]>([]);
  const [loading,  setLoading] = useState(true);
  const [tab,      setTab]     = useState<Tab>("report");

  const refresh = useCallback(async () => {
    const [taskRes, evRes] = await Promise.all([
      fetch(`/api/tasks/${id}`), fetch(`/api/tasks/${id}/events`),
    ]);
    if (taskRes.ok) setTask(await taskRes.json() as Task);
    if (evRes.ok) { const d = await evRes.json() as { events: TaskEvent[] }; setEvents(d.events); }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    refresh();
    const iv = setInterval(() => {
      setTask((t) => {
        if (t && !isActive(t.status)) { clearInterval(iv); return t; }
        refresh();
        return t;
      });
    }, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  if (loading) return <div className="py-20 text-center text-slate-400">Loading task…</div>;
  if (!task)   return <div className="py-20 text-center text-slate-400">Task not found.</div>;

  // Support both schemaVersion 2 (AuditReport) and 1 (legacy Report)
  const rawReport  = task.resultJson as (AuditReport & { schemaVersion?: number; analysis?: { findings?: LegacyFinding[]; counts?: Record<string, number>; compilerStatus?: string; toolName?: string; toolVersion?: string } }) | null;
  const isV2       = rawReport?.schemaVersion === 2;
  const v2Report   = isV2 ? (rawReport as unknown as AuditReport) : null;
  const v2Findings = v2Report?.findings ?? [];
  const v1Findings = !isV2 ? ((rawReport?.analysis?.findings as LegacyFinding[] | undefined) ?? []) : [];
  const score      = v2Report?.score ?? null;
  const verdict    = v2Report?.verdict ?? null;
  const counts     = v2Report?.counts ?? (rawReport?.analysis?.counts as Record<AuditSeverity, number> | undefined);
  const sourceCode = (task.inputJson as { sourceCode?: string } | undefined)?.sourceCode ?? null;
  const allFindings = isV2 ? v2Findings : v1Findings;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{task.title}</h1>
          <p className="text-xs text-slate-500 mt-1 font-mono">
            {task.id}{task.onchainTaskId && <> · on-chain #{task.onchainTaskId}</>}
          </p>
        </div>
        <StatusBadge status={task.status} />
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Budget",       value: `${task.budgetUsdc} USDC` },
          { label: "Deadline",     value: new Date(task.deadline).toLocaleDateString() },
          { label: "Findings",     value: allFindings.length ? `${allFindings.length} total` : "—" },
          { label: "Critical/High",value: String(allFindings.filter((f) => f.severity === "critical" || f.severity === "high").length) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-3">
            <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
            <p className="text-lg font-bold text-white mt-0.5 tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {/* Score ring + verdict (v2 only) */}
      {score !== null && verdict && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 flex items-center gap-6">
          <ScoreRing score={score} verdict={verdict} />
          <div className="flex-1 space-y-2">
            <p className="text-sm text-slate-300 leading-relaxed">{v2Report?.summary}</p>
            {counts && (
              <div className="flex flex-wrap gap-2 mt-2">
                {(["critical","high","medium","low","info"] as AuditSeverity[]).map((s) => (
                  counts[s] > 0 && (
                    <span key={s} className={clsx("rounded-full px-2 py-0.5 text-xs font-bold", SEV_CONFIG[s].badge)}>
                      {counts[s]} {s}
                    </span>
                  )
                ))}
              </div>
            )}
          </div>
          {/* BlockRun receipt */}
          {v2Report?.blockrunReceipt && (
            <div className="flex-shrink-0 rounded-xl bg-slate-800 border border-slate-700 p-3 space-y-1 text-xs text-slate-400 min-w-[140px]">
              <p className="flex items-center gap-1 font-semibold text-slate-300"><Bot className="w-3.5 h-3.5 text-emerald-400" />BlockRun AI</p>
              <p>{v2Report.blockrunReceipt.model}</p>
              <p>{v2Report.blockrunReceipt.latencyMs}ms{v2Report.blockrunReceipt.tokensUsed != null ? ` · ${v2Report.blockrunReceipt.tokensUsed} tokens` : ""}</p>
              {v2Report.blockrunReceipt.txHash && (
                <a href={`${EXPLORER}/tx/${v2Report.blockrunReceipt.txHash}`} target="_blank" rel="noopener noreferrer"
                  className="text-sky-400 hover:text-sky-300 font-mono truncate block">
                  {v2Report.blockrunReceipt.txHash.slice(0,16)}…
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Verification banner */}
      {task.verification && (
        <div className={clsx(
          "flex items-start gap-3 rounded-xl border p-4",
          task.verification.passed === true  && "bg-green-950/30 border-green-700",
          task.verification.passed === false && "bg-red-950/30 border-red-800",
          task.verification.passed == null   && "bg-yellow-950/30 border-yellow-800",
        )}>
          {task.verification.passed === true  && <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />}
          {task.verification.passed === false && <XCircle      className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />}
          {task.verification.passed == null   && <Clock        className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />}
          <div>
            <p className={clsx("font-semibold text-sm",
              task.verification.passed === true  && "text-green-300",
              task.verification.passed === false && "text-red-300",
              task.verification.passed == null   && "text-yellow-300",
            )}>
              {task.verification.passed === true  ? "Verification passed — payment released"  :
               task.verification.passed === false ? "Verification failed — USDC refunded"     :
               "Verification pending"}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">{task.verification.message}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-900 border border-slate-800 p-1">
        {([
          ["report",   "Analysis Report",  <FileSearch key="r" className="w-4 h-4" />],
          ["code",     "Contract Code",    <Code2      key="c" className="w-4 h-4" />],
          ["timeline", "Timeline",         <Activity   key="t" className="w-4 h-4" />],
        ] as [Tab, string, React.ReactNode][]).map(([t, label, icon]) => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx(
              "flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              tab === t ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-300",
            )}>
            {icon}{label}
          </button>
        ))}
      </div>

      {/* Tab: Report */}
      {tab === "report" && (
        <div className="space-y-5">
          {!rawReport ? (
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-8 text-center space-y-2">
              <Shield className="w-8 h-8 mx-auto text-slate-600" />
              <p className="text-slate-400 font-medium">Analysis report not yet available</p>
              <p className="text-sm text-slate-600">The provider agent will submit a report once the task is processed.</p>
            </div>
          ) : (
            <>
              {/* Schema / compiler info */}
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 space-y-2">
                <p className="text-xs text-slate-500 uppercase tracking-wider">Report metadata</p>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  {isV2 && <span className="text-slate-300"><span className="text-slate-500">Schema</span> v2</span>}
                  <span className="text-slate-300">
                    <span className="text-slate-500">Compiler</span>{" "}
                    <span className={rawReport.analysis?.compilerStatus === "error" ? "text-red-400" :
                      rawReport.analysis?.compilerStatus === "unavailable" ? "text-yellow-400" : "text-green-400"}>
                      {isV2 ? v2Report?.compilerStatus : rawReport.analysis?.compilerStatus}
                    </span>
                  </span>
                  <span className="text-slate-300"><span className="text-slate-500">Tool</span>{" "}
                    {isV2 ? v2Report?.solcVersion : rawReport.analysis?.toolName}
                  </span>
                  {isV2 && v2Report?.scoringPolicyVersion && (
                    <span className="text-slate-300"><span className="text-slate-500">Scoring</span> policy {v2Report.scoringPolicyVersion}</span>
                  )}
                </div>
              </div>

              {/* Findings */}
              <div className="space-y-3">
                {isV2 ? (
                  v2Findings.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                      <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-green-500" />
                      <p className="text-green-400 font-medium">No findings detected</p>
                    </div>
                  ) : (
                    v2Findings.map((f, i) => <FindingCardV2 key={f.id ?? i} f={f} idx={i} />)
                  )
                ) : (
                  v1Findings.length === 0 ? (
                    <p className="text-center py-8 text-slate-500">No findings in report.</p>
                  ) : (
                    v1Findings.map((f, i) => <FindingCardV1 key={i} f={f} idx={i} />)
                  )
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab: Contract code */}
      {tab === "code" && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
          {!sourceCode ? (
            <p className="text-center py-8 text-slate-500">Source code not available.</p>
          ) : (
            <div className="overflow-auto max-h-[600px]">
              <div className="p-4 min-w-0">
                {sourceCode.split("\n").map((line, i) => {
                  const lineNum = i + 1;
                  const flag = allFindings.find((f) => (f as { line?: number | null }).line === lineNum);
                  return (
                    <div key={i} className={clsx(
                      "flex gap-3 font-mono text-xs leading-5 px-1 rounded",
                      flag && "bg-yellow-950/20",
                    )}>
                      <span className="select-none text-slate-600 w-8 text-right flex-shrink-0">{lineNum}</span>
                      <span className={clsx("flex-1 whitespace-pre", flag ? "text-yellow-200" : "text-slate-300")}>
                        {line || " "}
                      </span>
                      {flag && (
                        <span className={clsx("flex-shrink-0 text-[10px] font-bold rounded px-1", SEV_CONFIG[(flag as { severity: AuditSeverity }).severity].badge)}>
                          {(flag as { severity: AuditSeverity }).severity.toUpperCase()}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Timeline */}
      {tab === "timeline" && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-4 border-b border-slate-800">
            {[
              { label: "Approve",  tx: task.transactions.approve },
              { label: "Create",   tx: task.transactions.create },
              { label: "Submit",   tx: task.transactions.submit },
              { label: "Settle",   tx: task.transactions.settlement },
            ].map(({ label, tx }) => (
              <div key={label} className="text-xs">
                <p className="text-slate-500 uppercase tracking-wide">{label}</p>
                {tx ? <TxLink hash={tx} /> : <span className="text-slate-600">—</span>}
              </div>
            ))}
          </div>
          <Timeline events={events} />
        </div>
      )}
    </div>
  );
}
