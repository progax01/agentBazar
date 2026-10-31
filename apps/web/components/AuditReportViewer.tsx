"use client";

import { useState } from "react";
import {
  Activity, Bot, CheckCircle2, Code2, ExternalLink, FileSearch,
  ShieldAlert, X, XCircle,
} from "lucide-react";
import type { AuditReport, AuditSeverity } from "@agetbazar/shared";

type ReportTab = "summary" | "findings" | "source" | "coverage";

const SEVERITY_CLS: Record<AuditSeverity, string> = {
  critical: "border-red-700 bg-red-950/40 text-red-300",
  high:     "border-orange-700 bg-orange-950/40 text-orange-300",
  medium:   "border-yellow-700 bg-yellow-950/40 text-yellow-300",
  low:      "border-blue-700 bg-blue-950/40 text-blue-300",
  info:     "border-slate-700 bg-slate-800 text-slate-300",
};

function explorerTxUrl(network: string, hash: string): string | null {
  const base = network === "eip155:5042"
    ? "https://explorer.arc.network"
    : network === "eip155:5042002"
    ? "https://explorer.testnet.arc.io"
    : null;
  return base ? `${base}/tx/${hash}` : null;
}

export function isAuditReport(value: unknown): value is AuditReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<AuditReport>;
  return report.schemaVersion === 2 &&
    typeof report.auditId === "string" &&
    typeof report.score === "number" &&
    Array.isArray(report.findings) &&
    typeof report.coverage === "object" && report.coverage !== null;
}

export function AuditReportViewer({
  report,
  sourceCode,
  onClose,
}: {
  report: AuditReport;
  sourceCode: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<ReportTab>("summary");
  const tabs: Array<{ id: ReportTab; label: string; icon: typeof FileSearch }> = [
    { id: "summary",  label: "Summary",  icon: Activity },
    { id: "findings", label: `Findings (${report.findings.length})`, icon: ShieldAlert },
    { id: "source",   label: "Source",   icon: Code2 },
    { id: "coverage", label: "Coverage", icon: Bot },
  ];
  const verdictCls = report.verdict === "PASS"
    ? "text-green-300 border-green-700 bg-green-950/40"
    : report.verdict === "REVIEW_REQUIRED"
    ? "text-yellow-300 border-yellow-700 bg-yellow-950/40"
    : "text-red-300 border-red-700 bg-red-950/40";

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/80 p-3 sm:p-6">
      <section className="mx-auto my-4 w-full max-w-5xl overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4 sm:px-7">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white">Security audit report</h2>
            <p className="mt-1 truncate font-mono text-xs text-slate-500">Audit {report.auditId}</p>
          </div>
          <button onClick={onClose} aria-label="Close report" className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid grid-cols-2 gap-3 border-b border-slate-800 p-5 sm:grid-cols-6 sm:px-7">
          <div className="col-span-1 row-span-2 flex flex-col justify-center border-r border-slate-800 pr-3">
            <span className="text-3xl font-bold tabular-nums text-white">{report.score}<span className="text-sm font-normal text-slate-500">/100</span></span>
            <span className={`mt-2 w-fit rounded border px-2 py-1 text-[10px] font-bold uppercase ${verdictCls}`}>{report.verdict.replaceAll("_", " ")}</span>
          </div>
          {(["critical", "high", "medium", "low", "info"] as AuditSeverity[]).map((severity) => (
            <div key={severity} className={`rounded-md border p-2 text-center ${SEVERITY_CLS[severity]}`}>
              <p className="text-lg font-bold tabular-nums">{report.counts[severity] ?? 0}</p>
              <p className="text-[10px] font-semibold uppercase">{severity}</p>
            </div>
          ))}
        </div>

        <nav className="flex overflow-x-auto border-b border-slate-800" aria-label="Audit report sections">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-xs font-medium ${
                tab === id ? "border-sky-500 bg-sky-950/20 text-sky-300" : "border-transparent text-slate-400 hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </nav>

        <div className="max-h-[60vh] overflow-y-auto p-5 sm:p-7">
          {tab === "summary" && (
            <div className="space-y-5">
              <p className="text-sm leading-6 text-slate-300">{report.summary}</p>
              <dl className="grid gap-3 text-xs sm:grid-cols-2">
                <div><dt className="text-slate-500">Compiler</dt><dd className="mt-1 text-slate-200">{report.compilerStatus} · {report.solcVersion}</dd></div>
                <div><dt className="text-slate-500">Scoring policy</dt><dd className="mt-1 text-slate-200">{report.scoringPolicyVersion}</dd></div>
                <div className="sm:col-span-2"><dt className="text-slate-500">Source hash</dt><dd className="mt-1 break-all font-mono text-slate-300">{report.sourceHash}</dd></div>
              </dl>
              {report.compilerOutput && <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-red-900/60 bg-red-950/20 p-3 text-xs text-red-200">{report.compilerOutput}</pre>}
            </div>
          )}

          {tab === "findings" && (
            report.findings.length === 0 ? (
              <div className="py-10 text-center">
                <CheckCircle2 className="mx-auto h-8 w-8 text-green-400" />
                <p className="mt-3 text-sm font-medium text-green-300">No findings reported</p>
              </div>
            ) : (
              <div className="space-y-3">
                {report.findings.map((finding) => (
                  <article key={finding.id} className="border-b border-slate-800 pb-4 last:border-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_CLS[finding.severity]}`}>{finding.severity}</span>
                      <h3 className="text-sm font-semibold text-white">{finding.title}</h3>
                      {finding.line != null && <span className="font-mono text-xs text-slate-500">line {finding.line}</span>}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{finding.description}</p>
                    {finding.context && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-slate-900 p-3 text-xs text-slate-400">{finding.context}</pre>}
                    {finding.exploitScenario && <p className="mt-2 text-xs leading-5 text-slate-400"><strong className="text-slate-300">Exploit scenario:</strong> {finding.exploitScenario}</p>}
                    {finding.remediation && <p className="mt-2 text-xs leading-5 text-slate-400"><strong className="text-slate-300">Remediation:</strong> {finding.remediation}</p>}
                  </article>
                ))}
              </div>
            )
          )}

          {tab === "source" && (
            <div className="max-h-[55vh] overflow-auto rounded-md border border-slate-800 bg-black/30 p-3">
              {sourceCode.split("\n").map((line, index) => {
                const lineNumber = index + 1;
                const lineFindings = report.findings.filter((finding) => finding.line === lineNumber);
                return (
                  <div key={lineNumber} className={`flex gap-3 font-mono text-xs leading-5 ${lineFindings.length ? "bg-yellow-950/30" : ""}`}>
                    <span className="w-8 shrink-0 select-none text-right text-slate-600">{lineNumber}</span>
                    <span className="flex-1 whitespace-pre text-slate-300">{line || " "}</span>
                    {lineFindings.length > 0 && <span className="shrink-0 text-[10px] font-bold text-yellow-300">{lineFindings.length}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {tab === "coverage" && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <CoverageItem title="Solc" status={report.coverage.solc.compiled ? "Compiled" : report.compilerStatus} detail={`${report.coverage.solc.findings} findings`} />
                <CoverageItem title="Slither" status={report.coverage.slither.installed ? "Findings reported" : "No findings / unavailable"} detail={`${report.coverage.slither.findings} detector results`} />
                <CoverageItem title="BlockRun AI" status={report.coverage.blockrunAi.ran ? "Inference complete" : report.coverage.blockrunAi.skipped ? "Skipped" : "Request failed"} detail={report.coverage.blockrunAi.skipReason ?? `${report.coverage.blockrunAi.model} · ${report.coverage.blockrunAi.findings} findings`} />
              </div>
              {report.blockrunReceipt && (
                <div className="border-t border-slate-800 pt-4 text-xs text-slate-400">
                  <p>BlockRun request: {report.blockrunReceipt.latencyMs} ms{report.blockrunReceipt.tokensUsed != null ? ` · ${report.blockrunReceipt.tokensUsed} tokens` : ""}</p>
                  {report.blockrunReceipt.txHash && (
                    <a href={explorerTxUrl(report.blockrunReceipt.network, report.blockrunReceipt.txHash) ?? undefined} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 font-mono text-sky-300 hover:text-sky-200">
                      <ExternalLink className="h-3 w-3" /> BlockRun settlement: {report.blockrunReceipt.txHash}
                    </a>
                  )}
                </div>
              )}
              {report.scoreBreakdown.findings.length > 0 && (
                <div className="border-t border-slate-800 pt-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase text-slate-400">Score breakdown</h3>
                  <div className="space-y-2">
                    {report.scoreBreakdown.findings.map((item) => (
                      <div key={item.findingId} className="flex justify-between gap-4 text-xs">
                        <span className="truncate text-slate-300">{item.title}</span>
                        <span className="shrink-0 font-mono text-red-300">−{item.penalty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CoverageItem({ title, status, detail }: { title: string; status: string; detail: string }) {
  return (
    <div className="border-l-2 border-slate-700 pl-3">
      <h3 className="text-xs font-semibold text-slate-300">{title}</h3>
      <p className="mt-1 text-sm text-white">{status}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}