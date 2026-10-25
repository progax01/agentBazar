"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { TxLink } from "@/components/TxLink";
import { isActive } from "@agetbazar/shared";
import type { Task, TaskEvent } from "@agetbazar/shared";
import {
  CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp,
  Code2, FileSearch, Activity, ExternalLink, Shield, ShieldAlert,
} from "lucide-react";
import clsx from "clsx";

const EXPLORER = "https://explorer.testnet.arc.io";

// ─── Severity helpers ────────────────────────────────────────────────────────
type Sev = "critical" | "high" | "medium" | "low" | "info";

const SEV_COLOR: Record<Sev, string> = {
  critical: "bg-red-950/60 border-red-700 text-red-300",
  high:     "bg-orange-950/60 border-orange-700 text-orange-300",
  medium:   "bg-yellow-950/60 border-yellow-700 text-yellow-300",
  low:      "bg-blue-950/60 border-blue-700 text-blue-300",
  info:     "bg-gray-800/60 border-gray-700 text-gray-400",
};

const SEV_BADGE: Record<Sev, string> = {
  critical: "bg-red-700 text-red-100",
  high:     "bg-orange-700 text-orange-100",
  medium:   "bg-yellow-700 text-yellow-100",
  low:      "bg-blue-700 text-blue-100",
  info:     "bg-gray-700 text-gray-300",
};

// ─── Finding card ────────────────────────────────────────────────────────────
interface Finding {
  severity:    Sev;
  title:       string;
  description: string;
  line?:       number | null;
  context?:    string;
}

function FindingCard({ f, idx }: { f: Finding; idx: number }) {
  const [open, setOpen] = useState(idx < 3); // expand first 3 by default
  return (
    <div className={clsx("rounded-xl border p-4 space-y-2", SEV_COLOR[f.severity])}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={clsx("flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", SEV_BADGE[f.severity])}>
            {f.severity}
          </span>
          <span className="text-sm font-semibold text-gray-100 truncate">{f.title}</span>
          {f.line != null && (
            <span className="flex-shrink-0 text-xs text-gray-500">line {f.line}</span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 flex-shrink-0 text-gray-500" /> : <ChevronDown className="w-4 h-4 flex-shrink-0 text-gray-500" />}
      </button>
      {open && (
        <div className="space-y-2 pt-1">
          <p className="text-sm text-gray-300 text-pretty">{f.description}</p>
          {f.context && (
            <pre className="rounded-lg bg-gray-900/60 border border-gray-700 px-3 py-2 text-xs font-mono text-gray-400 overflow-x-auto whitespace-pre-wrap">
              {f.context}
            </pre>
          )}
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
  if (events.length === 0)
    return <p className="text-sm text-gray-500">No on-chain events yet.</p>;
  return (
    <ol className="relative border-l border-gray-700 space-y-5 pl-6">
      {events.map((ev) => (
        <li key={ev.id} className="relative">
          <span className="absolute -left-[26px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-sky-700 ring-4 ring-gray-900" />
          <p className="text-sm font-medium text-gray-200">
            {EVENT_LABELS[ev.eventType] ?? ev.eventType}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {new Date(ev.createdAt).toLocaleString()}
            {ev.txHash && (
              <>
                {" · "}
                <a
                  href={`${EXPLORER}/tx/${ev.txHash}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-sky-400 hover:text-sky-300"
                >
                  {ev.txHash.slice(0, 10)}…{ev.txHash.slice(-8)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </>
            )}
          </p>
        </li>
      ))}
    </ol>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type Tab = "report" | "code" | "timeline";

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [task,    setTask]    = useState<Task | null>(null);
  const [events,  setEvents]  = useState<TaskEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState<Tab>("report");

  const refresh = useCallback(async () => {
    const [taskRes, evRes] = await Promise.all([
      fetch(`/api/tasks/${id}`),
      fetch(`/api/tasks/${id}/events`),
    ]);
    if (taskRes.ok) setTask(await taskRes.json());
    if (evRes.ok) { const { events: ev } = await evRes.json(); setEvents(ev); }
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

  if (loading) return <div className="py-20 text-center text-gray-400">Loading task…</div>;
  if (!task)   return <div className="py-20 text-center text-gray-400">Task not found.</div>;

  const report   = task.resultJson;
  const findings = (report?.analysis?.findings ?? []) as Finding[];
  const counts   = report?.analysis?.counts as Record<Sev, number> | undefined;
  const sourceCode = (task.inputJson as { sourceCode?: string } | undefined)?.sourceCode ?? null;

  const criticalCount = findings.filter((f) => f.severity === "critical" || f.severity === "high").length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{task.title}</h1>
          <p className="text-xs text-gray-500 mt-1 font-mono">
            {task.id}
            {task.onchainTaskId && <> · on-chain #{task.onchainTaskId}</>}
          </p>
        </div>
        <StatusBadge status={task.status} />
      </div>

      {/* Summary bar ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Budget",   value: `${task.budgetUsdc} USDC` },
          { label: "Deadline", value: new Date(task.deadline).toLocaleDateString() },
          { label: "Findings", value: findings.length ? `${findings.length} total` : "—" },
          { label: "Critical/High", value: criticalCount ? String(criticalCount) : "0" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl bg-gray-900 border border-gray-800 px-4 py-3">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
            <p className="text-lg font-bold text-white mt-0.5 tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {/* Verification banner ── ── ── ── ── ── ── ── ── ── ── ── ── ── */}
      {task.verification && (
        <div className={clsx(
          "flex items-start gap-3 rounded-xl border p-4",
          task.verification.passed === true  && "bg-green-950/30 border-green-700",
          task.verification.passed === false && "bg-red-950/30 border-red-800",
          task.verification.passed == null   && "bg-yellow-950/30 border-yellow-800",
        )}>
          {task.verification.passed === true  && <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />}
          {task.verification.passed === false && <XCircle     className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />}
          {task.verification.passed == null   && <Clock       className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />}
          <div>
            <p className={clsx(
              "font-semibold text-sm",
              task.verification.passed === true  && "text-green-300",
              task.verification.passed === false && "text-red-300",
              task.verification.passed == null   && "text-yellow-300",
            )}>
              {task.verification.passed === true  ? "Verification passed — payment released"  :
               task.verification.passed === false ? "Verification failed — USDC refunded"     :
               "Verification pending"}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{task.verification.message}</p>
          </div>
        </div>
      )}

      {/* Tabs ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── */}
      <div className="flex gap-1 rounded-xl bg-gray-900 border border-gray-800 p-1">
        {([
          ["report",   "Analysis Report",  <FileSearch  key="r" className="w-4 h-4" />],
          ["code",     "Contract Code",    <Code2       key="c" className="w-4 h-4" />],
          ["timeline", "Timeline",         <Activity    key="t" className="w-4 h-4" />],
        ] as [Tab, string, React.ReactNode][]).map(([t, label, icon]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              "flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              tab === t ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-300",
            )}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {/* Tab: Analysis Report ── ── ── ── ── ── ── ── ── ── ── ── ── ── */}
      {tab === "report" && (
        <div className="space-y-5">
          {!report ? (
            <div className="rounded-2xl bg-gray-900 border border-gray-800 p-8 text-center">
              <Shield className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">Analysis pending — the provider is running solc now.</p>
            </div>
          ) : (
            <>
              {/* Compiler status */}
              <div className={clsx(
                "rounded-xl border p-4 flex items-start gap-3",
                report.analysis.compilerStatus === "success"     && "bg-green-950/20 border-green-800",
                report.analysis.compilerStatus === "error"       && "bg-red-950/20 border-red-800",
                report.analysis.compilerStatus === "unavailable" && "bg-gray-800/40 border-gray-700",
              )}>
                {report.analysis.compilerStatus === "success"
                  ? <CheckCircle2  className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                  : <ShieldAlert   className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />}
                <div>
                  <p className="text-sm font-semibold text-gray-200">
                    Compiler: {report.analysis.compilerStatus}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {report.analysis.toolName} {report.analysis.toolVersion}
                    {" · "}generated {new Date(report.createdAt as string).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Severity counts */}
              {counts && (
                <div className="flex flex-wrap gap-2">
                  {(["critical","high","medium","low","info"] as Sev[]).map((s) =>
                    counts[s] > 0 ? (
                      <span key={s} className={clsx("rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide", SEV_BADGE[s])}>
                        {counts[s]} {s}
                      </span>
                    ) : null,
                  )}
                  {findings.length === 0 && (
                    <span className="rounded-full bg-green-800 text-green-100 px-3 py-1 text-xs font-bold">
                      No findings
                    </span>
                  )}
                </div>
              )}

              {/* Summary */}
              {report.summary && (
                <div className="rounded-xl bg-sky-950/20 border border-sky-800/40 p-4">
                  <p className="text-xs font-semibold text-sky-400 uppercase tracking-wide mb-1">Summary</p>
                  <p className="text-sm text-sky-100 text-pretty">{report.summary as string}</p>
                </div>
              )}

              {/* Findings */}
              {findings.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
                    Findings ({findings.length})
                  </h3>
                  {findings.map((f, i) => <FindingCard key={i} f={f} idx={i} />)}
                </div>
              )}

              {/* Hashes */}
              <div className="rounded-xl bg-gray-900 border border-gray-800 divide-y divide-gray-800">
                {[
                  ["Source hash",  task.specificationHash],
                  ["Result hash",  task.resultHash ?? "—"],
                ].map(([label, val]) => (
                  <div key={label} className="flex gap-4 px-4 py-3">
                    <span className="w-28 flex-shrink-0 text-xs text-gray-500">{label}</span>
                    <span className="text-xs font-mono text-gray-300 break-all">{val}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Transactions */}
          <div className="rounded-xl bg-gray-900 border border-gray-800 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-300">Transactions</h3>
            {([
              ["USDC approve", task.transactions.approve],
              ["createTask",   task.transactions.create],
              ["submitResult", task.transactions.submit],
              ["Settlement",   task.transactions.settlement],
            ] as [string, string | null][]).map(([label, hash]) => (
              <div key={label} className="flex items-center justify-between gap-3">
                <span className="text-xs text-gray-500 w-28 flex-shrink-0">{label}</span>
                {hash
                  ? <TxLink hash={hash} />
                  : <span className="text-xs text-gray-700">—</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Contract Code ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── */}
      {tab === "code" && (
        <div className="rounded-2xl bg-gray-950 border border-gray-800 overflow-hidden">
          {!sourceCode ? (
            <div className="p-8 text-center text-gray-500">Source code not available.</div>
          ) : (
            <>
              <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800">
                <div className="flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-300">Contract.sol</span>
                </div>
                <span className="text-xs text-gray-500">{sourceCode.split("\n").length} lines</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs font-mono">
                  <tbody>
                    {sourceCode.split("\n").map((line, i) => {
                      const lineNum = i + 1;
                      // Highlight lines that have findings
                      const hasFinding = findings.some((f) => f.line === lineNum);
                      return (
                        <tr
                          key={i}
                          className={clsx(
                            "group",
                            hasFinding ? "bg-orange-950/30" : "hover:bg-gray-900/40",
                          )}
                        >
                          <td className="select-none w-10 pr-3 pl-4 py-0.5 text-right text-gray-600 border-r border-gray-800">
                            {lineNum}
                          </td>
                          <td className="pl-4 pr-4 py-0.5 text-gray-300 whitespace-pre">
                            {line || " "}
                            {hasFinding && (
                              <span className="ml-3 text-orange-400 text-[10px] align-middle">
                                ← {findings.find((f) => f.line === lineNum)?.severity.toUpperCase()}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab: Timeline ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── */}
      {tab === "timeline" && (
        <div className="rounded-2xl bg-gray-900 border border-gray-800 p-6">
          <Timeline events={events} />
          <div className="mt-6 pt-4 border-t border-gray-800 grid grid-cols-2 gap-3 text-xs text-gray-500">
            <div>
              <p className="text-gray-400 font-medium mb-1">Task deadline</p>
              <p>{new Date(task.deadline).toLocaleString()}</p>
            </div>
            {task.reviewDeadline && (
              <div>
                <p className="text-gray-400 font-medium mb-1">Review deadline</p>
                <p>{new Date(task.reviewDeadline).toLocaleString()}</p>
              </div>
            )}
            <div>
              <p className="text-gray-400 font-medium mb-1">Contract</p>
              <a
                href={`${EXPLORER}/address/${task.contractAddress}`}
                target="_blank" rel="noopener noreferrer"
                className="text-sky-400 hover:underline break-all"
              >
                {task.contractAddress}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
