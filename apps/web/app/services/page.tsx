"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Zap, Network, Lock, ExternalLink, CheckCircle,
  XCircle, Loader2, ArrowRight, Info, FileCode2, FileSearch, Shield,
  ChevronDown, ChevronUp, Bot, Wrench, Clock,
} from "lucide-react";
import type { AuditReport, PaymentReceipt, Service } from "@agetbazar/shared";
import { ARC_NETWORKS } from "@agetbazar/shared";
import { AuditReportViewer, isAuditReport } from "@/components/AuditReportViewer";
import { useArcNetwork } from "@/components/ArcNetworkProvider";
import clsx from "clsx";

const EXPLORER_TESTNET = "https://explorer.testnet.arc.io";
const EXPLORER_MAINNET = "https://explorer.arc.io";

/** Pick the right explorer based on a network string (eip155:5042 = mainnet, 5042002 = testnet) */
function explorerForNetwork(network?: string): string {
  if (!network) return EXPLORER_TESTNET;
  return network.includes("5042002") ? EXPLORER_TESTNET : EXPLORER_MAINNET;
}

const DEFAULT_CONTRACT = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract VulnerableVault {
    mapping(address => uint256) public balances;
    address public owner;

    constructor() {
        owner = tx.origin; // tx.origin authentication vulnerability
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "insufficient");
        // reentrancy: state updated AFTER external call
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        balances[msg.sender] -= amount;
    }

    function adminWithdraw(address to, uint256 amount) external {
        // missing access control
        (bool ok,) = to.call{value: amount}("");
        require(ok, "failed");
    }
}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MODE_META: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  x402:               { label: "x402",    cls: "bg-violet-500/15 text-violet-300 border-violet-500/30", icon: <Zap     className="w-3 h-3" /> },
  gateway_nanopayment:{ label: "Gateway", cls: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",       icon: <Network className="w-3 h-3" /> },
  escrow:             { label: "Escrow",  cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",    icon: <Lock   className="w-3 h-3" /> },
};

function PaymentModeBadge({ mode }: { mode: string }) {
  const m = MODE_META[mode] ?? { label: mode, cls: "bg-slate-700 text-slate-300 border-slate-600", icon: null };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${m.cls}`}>
      {m.icon}{m.label}
    </span>
  );
}

function verdictColor(v: string) {
  if (v === "PASS") return "text-green-400";
  if (v === "FAIL") return "text-red-400";
  return "text-yellow-400";
}

const SEV_BADGE: Record<string, string> = {
  critical: "bg-red-700/70 text-red-200",
  high:     "bg-orange-700/70 text-orange-200",
  medium:   "bg-yellow-700/70 text-yellow-200",
  low:      "bg-blue-700/70 text-blue-200",
  info:     "bg-slate-600/70 text-slate-300",
};

const ORIGIN_BADGE: Record<string, string> = {
  corroborated:  "bg-violet-700/60 text-violet-200",
  tool_confirmed:"bg-sky-700/60 text-sky-200",
  ai_identified: "bg-pink-700/60 text-pink-200",
  unverified:    "bg-slate-600/60 text-slate-400",
};

// ─── Step tracker ─────────────────────────────────────────────────────────────

const INVOKE_STEPS_AUDIT = [
  { key: "checking",  label: "Validating service & spend policy"              },
  { key: "paying",    label: "Signing EIP-3009 x402 USDC authorization"       },
  { key: "executing", label: "BlockRun AI + solc + Slither running (10-20s)"  },
  { key: "receiving", label: "Correlating findings & calculating risk score"  },
  { key: "done",      label: "Audit complete"                                 },
];
const INVOKE_STEPS_DEFAULT = [
  { key: "checking",  label: "Validating service & spend policy"  },
  { key: "paying",    label: "Signing EIP-3009 x402 authorization" },
  { key: "executing", label: "Executing paid request on provider"  },
  { key: "receiving", label: "Processing response"                 },
  { key: "done",      label: "Complete"                            },
];

type InvokeStep = "idle" | "checking" | "paying" | "executing" | "receiving" | "done" | "failed";

function StepRow({ label, state }: { label: string; state: "idle"|"active"|"done"|"fail" }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className={clsx(
        "w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center",
        state === "done"   && "bg-green-600",
        state === "active" && "bg-violet-600 animate-pulse",
        state === "fail"   && "bg-red-600",
        state === "idle"   && "bg-slate-700 ring-1 ring-slate-600",
      )}>
        {state === "done" && <CheckCircle className="w-3 h-3 text-white" />}
        {state === "fail" && <XCircle     className="w-3 h-3 text-white" />}
        {state === "active" && <Loader2   className="w-3 h-3 text-white animate-spin" />}
      </div>
      <span className={clsx(
        "text-sm",
        state === "done"   && "text-green-400",
        state === "active" && "text-white font-medium",
        state === "fail"   && "text-red-400",
        state === "idle"   && "text-slate-500",
      )}>{label}</span>
    </div>
  );
}

// ─── Audit result viewer ──────────────────────────────────────────────────────

interface AuditFinding {
  severity:      string;
  title:         string;
  description:   string;
  origin?:       string;
  line?:         number | null;
  context?:      string;
  exploitScenario?: string;
  remediation?:  string;
}

function FindingRow({ f }: { f: AuditFinding }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2.5 p-3 text-left hover:bg-slate-800 transition-colors"
      >
        <span className={clsx("flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase", SEV_BADGE[f.severity] ?? SEV_BADGE.info)}>
          {f.severity}
        </span>
        {f.origin && (
          <span className={clsx("flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase", ORIGIN_BADGE[f.origin] ?? ORIGIN_BADGE.unverified)}>
            {f.origin === "corroborated" ? <><Bot className="w-2.5 h-2.5 inline mr-0.5" /><Wrench className="w-2.5 h-2.5 inline mr-0.5" /></> : null}
            {f.origin.replace("_", " ")}
          </span>
        )}
        <span className="flex-1 text-sm text-slate-200 truncate">{f.title}</span>
        {f.line != null && <span className="text-xs text-slate-500 flex-shrink-0">L{f.line}</span>}
        {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-700">
          <p className="text-xs text-slate-300 pt-2 text-pretty">{f.description}</p>
          {f.exploitScenario && (
            <div className="rounded bg-red-950/30 border border-red-800/40 p-2">
              <p className="text-[10px] font-semibold text-red-400 mb-0.5">Exploit scenario</p>
              <p className="text-xs text-slate-300">{f.exploitScenario}</p>
            </div>
          )}
          {f.remediation && (
            <div className="rounded bg-green-950/30 border border-green-800/40 p-2">
              <p className="text-[10px] font-semibold text-green-400 mb-0.5">Remediation</p>
              <p className="text-xs text-slate-300">{f.remediation}</p>
            </div>
          )}
          {f.context && (
            <pre className="rounded bg-slate-900 border border-slate-700 px-2 py-1.5 text-[10px] font-mono text-slate-400 overflow-x-auto whitespace-pre-wrap">
              {f.context}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

interface AuditResultData {
  ok?:          boolean;
  score?:       number;
  verdict?:     string;
  summary?:     string;
  findings?:    AuditFinding[];
  counts?:      Record<string, number>;
  coverage?:    Record<string, unknown>;
  blockrunReceipt?: {
    gateway?: string;
    model?: string;
    amountUsdc?: string;
    network?: string;
    txHash?: string;
    tokensUsed?: number;
    latencyMs?: number;
  };
  // also accept PascalCase variant (older schema)
  blockRunReceipt?: {
    gateway?: string;
    model?: string;
    amountUsdc?: string;
    network?: string;
    txHash?: string;
    tokensUsed?: number;
    latencyMs?: number;
  };
  // capabilities endpoint response
  capabilities?: string[];
  serviceId?:   string;
  pricingUsdc?: Record<string, string>;
  scoringPolicy?: unknown;
  // generic
  [key: string]: unknown;
}

function AuditResultPanel({ data }: { data: AuditResultData }) {
  const isAudit = typeof data.score === "number";
  const findings = data.findings ?? [];

  if (!isAudit) {
    // Capabilities or other non-audit response
    return (
      <div className="rounded-xl bg-green-950/20 border border-green-700/40 p-4">
        <p className="text-xs font-semibold text-green-400 mb-2">Service response</p>
        <pre className="text-xs text-slate-300 overflow-auto max-h-48 whitespace-pre-wrap font-mono">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    );
  }

  const scoreColor = data.score != null
    ? data.score >= 70 ? "text-green-400" : data.score >= 40 ? "text-yellow-400" : "text-red-400"
    : "text-slate-400";

  return (
    <div className="space-y-4">
      {/* Score + verdict */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 flex items-center gap-4">
        <div className="text-center">
          <div className={clsx("text-4xl font-black tabular-nums", scoreColor)}>{data.score ?? "—"}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">/100</div>
        </div>
        <div className="flex-1">
          {data.verdict && (
            <div className={clsx("text-base font-bold mb-0.5", verdictColor(data.verdict))}>{data.verdict}</div>
          )}
          <p className="text-xs text-slate-400 text-pretty">{data.summary}</p>
        </div>
      </div>

      {/* Counts */}
      {data.counts && (
        <div className="grid grid-cols-5 gap-1.5">
          {(["critical","high","medium","low","info"] as const).map(s => (
            <div key={s} className="rounded-lg bg-slate-800 border border-slate-700 p-2 text-center">
              <div className="text-xs font-bold text-white tabular-nums">{data.counts![s] ?? 0}</div>
              <div className="text-[9px] text-slate-500 capitalize">{s}</div>
            </div>
          ))}
        </div>
      )}

      {/* BlockRun receipt */}
      {(data.blockrunReceipt ?? data.blockRunReceipt) && (() => {
        const br = data.blockrunReceipt ?? data.blockRunReceipt!;
        return (
          <div className="rounded-lg bg-violet-950/20 border border-violet-700/40 p-3 flex items-start gap-2">
            <Bot className="w-4 h-4 text-violet-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs space-y-0.5 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-violet-300 font-semibold">BlockRun AI</p>
                <span className="text-slate-500">arc.blockrun.ai · Arc mainnet</span>
              </div>
              <p className="text-slate-400">
                Model: <span className="text-slate-300">{br.model ?? "deepseek/deepseek-chat"}</span>
                {br.tokensUsed && <> · <span className="text-slate-300">{br.tokensUsed} tokens</span></>}
                {br.latencyMs && <> · <span className="text-slate-300">{(br.latencyMs/1000).toFixed(1)}s</span></>}
              </p>
              {br.txHash ? (
                <a
                  href={`${explorerForNetwork(br.network ?? "eip155:5042")}/tx/${br.txHash}`}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  Settlement tx: {br.txHash.slice(0, 16)}…{br.txHash.slice(-6)}
                </a>
              ) : (
                <p className="text-slate-500 italic">Settlement pending (usually ~30s after inference)</p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Findings */}
      {findings.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            {findings.length} Finding{findings.length !== 1 ? "s" : ""}
          </p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
            {findings.map((f, i) => <FindingRow key={i} f={f} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Invoke modal ─────────────────────────────────────────────────────────────

function InvokeModal({ service, onClose }: { service: Service; onClose: () => void }) {
  const isAuditService = service.endpointMethod === "POST" &&
    (service.endpointUrl.includes("/audit") || service.capabilities.some(c => c.includes("audit")));
  const requiresSourceCode = isAuditService;
  const INVOKE_STEPS = isAuditService ? INVOKE_STEPS_AUDIT : INVOKE_STEPS_DEFAULT;

  const [maxPer,      setMaxPer]      = useState(String(service.priceUsdc));
  const [budget,      setBudget]      = useState("1.00");
  const [sourceCode,  setSourceCode]  = useState(isAuditService ? DEFAULT_CONTRACT : "");
  const [showCode,    setShowCode]    = useState(isAuditService);
  const [step,        setStep]        = useState<InvokeStep>("idle");
  const [result,      setResult]      = useState<AuditResultData | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [txHash,      setTxHash]      = useState<string | null>(null);
  const [paymentReceipt, setPaymentReceipt] = useState<PaymentReceipt | null>(null);
  const [warning,     setWarning]     = useState<string | null>(null);
  const [showReport,  setShowReport]  = useState(false);
  const [elapsed,     setElapsed]     = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const auditReport: AuditReport | null = isAuditReport(result) ? result : null;
  const loading = step !== "idle" && step !== "done" && step !== "failed";

  async function invoke() {
    if (requiresSourceCode && sourceCode.trim().length < 10) {
      setStep("failed");
      setError("Enter at least 10 characters of Solidity source before paying.");
      return;
    }
    setError(null);
    setResult(null);
    setTxHash(null);
    setShowReport(false);
    setPaymentReceipt(null);
    setWarning(null);
    setElapsed(0);

    // Start elapsed timer
    const startTs = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTs) / 1000)), 500);

    setStep("checking");

    const body: Record<string, unknown> = { maxPerPaymentUsdc: maxPer, budgetUsdc: budget };
    if (isAuditService && sourceCode.trim()) body.input = { sourceCode: sourceCode.trim() };

    try {
      const res = await fetch(`/api/services/${service.id}/invoke`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });

      // Server returns SSE (text/event-stream)
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !contentType.includes("text/event-stream")) {
        // Fallback: non-SSE error response
        if (timerRef.current) clearInterval(timerRef.current);
        let errMsg = `HTTP ${res.status}`;
        try {
          const ct = res.headers.get("content-type") ?? "";
          if (ct.includes("application/json")) {
            const j = await res.json() as { error?: string };
            errMsg = j.error ?? errMsg;
          }
        } catch { /* ignore */ }
        setStep("failed");
        setError(errMsg);
        return;
      }

      // Parse SSE stream
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Process complete SSE events (terminated by \n\n)
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.trim()) continue;
          const eventLine = part.match(/^event: (.+)$/m)?.[1]?.trim();
          const dataLine  = part.match(/^data: (.+)$/ms)?.[1]?.trim();
          if (!dataLine) continue;

          let parsed: Record<string, unknown> | null = null;
          try { parsed = JSON.parse(dataLine) as Record<string, unknown>; } catch { continue; }

          if (eventLine === "heartbeat") continue; // keep-alive, ignore

          if (eventLine === "progress") {
            const s = (parsed as { step?: string }).step as InvokeStep | undefined;
            if (s) setStep(s);
          }
          if (eventLine === "result") {
            if (timerRef.current) clearInterval(timerRef.current);
            setStep("done");
            const data = parsed as Record<string, unknown>;
            const auditData = (data.data ?? data) as AuditResultData;
            setResult(auditData);
            const receipt = data.receipt as PaymentReceipt | undefined;
            setPaymentReceipt(receipt ?? null);
            setWarning(typeof data.warning === "string" ? data.warning : null);
            setTxHash(receipt?.transactionHash ?? null);
          }
          if (eventLine === "error") {
            if (timerRef.current) clearInterval(timerRef.current);
            setStep("failed");
            setError((parsed as { error?: string }).error ?? "Unknown error");
          }
        }
      }
    } catch (err) {
      if (timerRef.current) clearInterval(timerRef.current);
      setStep("failed");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  function stepState(key: string): "idle"|"active"|"done"|"fail" {
    const order  = INVOKE_STEPS.map(s => s.key);
    const curIdx = order.indexOf(step as string);
    const myIdx  = order.indexOf(key);
    if (step === "done")                           return "done";
    if (step === "failed" && myIdx === curIdx - 1) return "fail";
    if (myIdx < curIdx)                            return "done";
    if (myIdx === curIdx)                          return "active";
    return "idle";
  }

  const isPost = service.endpointMethod === "POST";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50">

        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between p-5 pb-4 border-b border-slate-800 bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-600/20 flex items-center justify-center">
              {isAuditService ? <Shield className="w-4 h-4 text-violet-400" /> : <Zap className="w-4 h-4 text-violet-400" />}
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">{service.name}</h2>
              <p className="text-xs text-slate-500">{service.endpointMethod} {service.endpointUrl.split("/").slice(-3).join("/")}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors text-2xl leading-none ml-4">×</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Payment info */}
          <div className="rounded-xl bg-slate-800 border border-slate-700 p-4 flex items-start gap-3">
            <Info className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-slate-400 space-y-0.5 flex-1">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>Price: <span className="text-white font-semibold">{service.priceUsdc} USDC</span></span>
                <span>Network: <span className="text-slate-300">{service.network}</span></span>
                <span>Pay-to: <span className="font-mono text-slate-300 text-[10px]">{service.payToAddress.slice(0,10)}…{service.payToAddress.slice(-6)}</span></span>
              </div>
              <p>Facilitator: <span className="text-slate-300 font-mono text-[10px]">{service.facilitatorUrl}</span></p>
            </div>
          </div>

          {isPost && (
            <div className="space-y-2">
              <button
                onClick={() => setShowCode(value => !value)}
                className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                <FileCode2 className="w-3.5 h-3.5" />
                {isAuditService ? "Contract source (required for audit)" : "Request body (optional)"}
                {showCode ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {showCode && <textarea
                value={sourceCode}
                onChange={e => setSourceCode(e.target.value)}
                disabled={loading}
                rows={10}
                spellCheck={false}
                placeholder={isAuditService ? "// Paste your Solidity contract here…" : "// Optional: request body"}
                className="w-full min-h-40 max-h-64 resize-y rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-violet-500 disabled:opacity-50"
              />}
            </div>
          )}

          {/* Spend controls */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Max per payment (USDC)</label>
              <input
                type="number" step="0.01" min={service.priceUsdc}
                value={maxPer} onChange={e => setMaxPer(e.target.value)} disabled={loading}
                className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Session budget (USDC)</label>
              <input
                type="number" step="0.01" min={service.priceUsdc}
                value={budget} onChange={e => setBudget(e.target.value)} disabled={loading}
                className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500 disabled:opacity-50"
              />
            </div>
          </div>

          {/* Step tracker */}
          {step !== "idle" && (
            <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-4 space-y-1">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Payment &amp; execution</p>
                {loading && (
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <Clock className="w-3 h-3" />{elapsed}s
                  </span>
                )}
                {step === "done" && elapsed > 0 && (
                  <span className="text-xs text-green-400">Done in {elapsed}s</span>
                )}
              </div>
              {INVOKE_STEPS.map(s => (
                <StepRow key={s.key} label={s.label} state={stepState(s.key)} />
              ))}
              {/* BlockRun note for audit services */}
              {isAuditService && step === "executing" && (
                <p className="text-[10px] text-slate-500 mt-2 pl-8">
                  Calling <span className="text-violet-400">arc.blockrun.ai</span> via x402 on Arc mainnet — payment settles on-chain after the AI responds.
                </p>
              )}
            </div>
          )}

          {/* Settlement tx (uses mainnet explorer for BlockRun Arc gateway) */}
          {txHash && (
            <a
              href={`${explorerForNetwork(paymentReceipt?.network ?? service.network)}/tx/${txHash}`}
              target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Settlement tx: {txHash.slice(0, 18)}…{txHash.slice(-8)}
            </a>
          )}
          {step === "done" && paymentReceipt && (
            <p className="text-xs text-slate-400">
              Payment status: <span className="text-slate-200">{paymentReceipt.status === "settled" ? "settled" : "service returned; settlement not confirmed"}</span>
            </p>
          )}

          {/* Result */}
          {step === "done" && result && (
            <div className="space-y-3">
              {warning && <p className="rounded-md border border-amber-700/50 bg-amber-950/30 p-3 text-xs text-amber-200">{warning}</p>}
              <AuditResultPanel data={result} />
              {auditReport && (
                <button onClick={() => setShowReport(true)} className="inline-flex items-center gap-2 rounded-md border border-green-700/60 px-3 py-2 text-xs font-semibold text-green-200 hover:bg-green-900/30">
                  <FileSearch className="h-4 w-4" /> View full report
                </button>
              )}
            </div>
          )}

          {/* Error */}
          {step === "failed" && error && (
            <div className="rounded-xl bg-red-950/20 border border-red-700/40 p-4">
              <p className="text-xs font-semibold text-red-400 mb-1">Invocation failed</p>
              <p className="text-xs text-slate-400">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={invoke}
              disabled={loading || step === "done" || (isAuditService && !sourceCode.trim())}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 text-sm transition-colors"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                : step === "done"
                ? <><CheckCircle className="w-4 h-4" /> Done</>
                : <>
                    {isAuditService ? <Shield className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                    Pay {service.priceUsdc} USDC &amp; {isAuditService ? "Audit" : "Call"}
                  </>}
            </button>
            <button
              onClick={onClose}
              className="px-4 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 text-sm transition-colors"
            >
              Close
            </button>
          </div>

          {isAuditService && !sourceCode.trim() && step === "idle" && (
            <p className="text-xs text-amber-400 text-center">Paste your Solidity contract above to enable the audit</p>
          )}
        </div>
      </div>
      {showReport && auditReport && (
        <AuditReportViewer report={auditReport} sourceCode={sourceCode} onClose={() => setShowReport(false)} />
      )}
    </div>
  );
}

// ─── Service card ─────────────────────────────────────────────────────────────

function ServiceCard({ svc, onInvoke }: { svc: Service; onInvoke: () => void }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 flex flex-col gap-4 hover:border-slate-700 transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white text-sm truncate group-hover:text-sky-300 transition-colors">{svc.name}</h3>
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 text-pretty">{svc.description}</p>
        </div>
        <PaymentModeBadge mode={svc.paymentMode} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-slate-800 px-3 py-2.5">
          <p className="text-slate-500 mb-0.5">Price per call</p>
          <p className="text-white font-bold">{svc.priceUsdc} USDC</p>
        </div>
        <div className="rounded-lg bg-slate-800 px-3 py-2.5">
          <p className="text-slate-500 mb-0.5">Method</p>
          <p className="text-white font-bold">{svc.endpointMethod}</p>
        </div>
        <div className="rounded-lg bg-slate-800 px-3 py-2.5 col-span-2">
          <p className="text-slate-500 mb-0.5">Endpoint</p>
          <p className="text-violet-300 font-mono text-[11px] truncate">{svc.endpointUrl}</p>
        </div>
      </div>

      {svc.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {svc.capabilities.map(cap => (
            <span key={cap} className="rounded-full bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
              {cap}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2 mt-auto pt-1">
        <button
          onClick={onInvoke}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold py-2 transition-colors"
        >
          <Zap className="w-3.5 h-3.5" />
          Pay &amp; invoke
        </button>
        <a
          href={`/api/services/${svc.id}/quote`}
          target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 px-3 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 text-xs transition-colors"
        >
          Quote <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ServicesPage() {
  const { network } = useArcNetwork();
  const networkConfig = ARC_NETWORKS[network];
  const [services, setServices] = useState<Service[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [invoking, setInvoking] = useState<Service | null>(null);

  useEffect(() => {
    fetch(`/api/services?network=${network}`)
      .then(r => r.json() as Promise<{ services: Service[] }>)
      .then(d => setServices(d.services ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [network]);

  return (
    <div className="space-y-8">
      {invoking && <InvokeModal service={invoking} onClose={() => setInvoking(null)} />}

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Agent Services</h1>
          <p className="text-slate-400 text-sm mt-1">
            Paid API endpoints — pay per call via x402 or Gateway nanopayments on {networkConfig.label}.
          </p>
        </div>
        <Link
          href="/payments"
          className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
        >
          Payment history <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-3 text-slate-400 py-16">
          <Loader2 className="w-5 h-5 animate-spin" />Loading services…
        </div>
      )}

      {!loading && services.length === 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center space-y-3">
          <p className="text-slate-400 text-sm">No services registered yet.</p>
          <p className="text-slate-600 text-xs">
            Run migrations 003 and 004, then start the x402 server with{" "}
            <code className="bg-slate-800 px-1.5 py-0.5 rounded text-violet-400 font-mono">bun run dev:x402</code>
          </p>
        </div>
      )}

      {services.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map(svc => (
            <ServiceCard key={svc.id} svc={svc} onInvoke={() => setInvoking(svc)} />
          ))}
        </div>
      )}
    </div>
  );
}
