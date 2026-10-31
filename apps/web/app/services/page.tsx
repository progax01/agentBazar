"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Zap, Network, Lock, ExternalLink, CheckCircle, FileSearch,
  XCircle, Loader2, ArrowRight, Info,
} from "lucide-react";
import type { AuditReport, Service } from "@agetbazar/shared";
import { AuditReportViewer, isAuditReport } from "@/components/AuditReportViewer";

const EXPLORER = "https://explorer.testnet.arc.io";

// ─── Payment mode badge ──────────────────────────────────────────────────────
const MODE_META: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  x402: {
    label: "x402",
    cls:   "bg-violet-500/15 text-violet-300 border-violet-500/30",
    icon:  <Zap className="w-3 h-3" />,
  },
  gateway_nanopayment: {
    label: "Gateway",
    cls:   "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    icon:  <Network className="w-3 h-3" />,
  },
  escrow: {
    label: "Escrow",
    cls:   "bg-amber-500/15 text-amber-300 border-amber-500/30",
    icon:  <Lock className="w-3 h-3" />,
  },
};

function PaymentModeBadge({ mode }: { mode: string }) {
  const m = MODE_META[mode] ?? { label: mode, cls: "bg-slate-700 text-slate-300 border-slate-600", icon: null };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${m.cls}`}>
      {m.icon}
      {m.label}
    </span>
  );
}

// ─── Invoke step tracker ─────────────────────────────────────────────────────
const INVOKE_STEPS = [
  { key: "quote",     label: "Fetching service quote"          },
  { key: "auth",      label: "Signing x402 authorization"       },
  { key: "executing", label: "Executing paid request"           },
  { key: "done",      label: "Service response received"         },
];

type InvokeStep = "idle" | "quote" | "auth" | "executing" | "done" | "failed";

function StepRow({ label, state }: { label: string; state: "idle"|"active"|"done"|"fail" }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold
        ${state === "done"   ? "bg-green-600 text-white"
        : state === "active" ? "bg-violet-600 text-white animate-pulse"
        : state === "fail"   ? "bg-red-600 text-white"
        :                      "bg-slate-700 text-slate-500"}`}>
        {state === "done" ? <CheckCircle className="w-3.5 h-3.5" /> :
         state === "fail" ? <XCircle     className="w-3.5 h-3.5" /> : null}
      </div>
      <span className={`text-sm ${
        state === "done"   ? "text-green-400" :
        state === "active" ? "text-white" :
        state === "fail"   ? "text-red-400" :
                             "text-slate-500"}`}>
        {label}
      </span>
    </div>
  );
}

// ─── Invoke modal ────────────────────────────────────────────────────────────
function InvokeModal({ service, onClose }: { service: Service; onClose: () => void }) {
  const [maxPer,   setMaxPer]   = useState(String(service.priceUsdc));
  const [budget,   setBudget]   = useState("1.00");
  const [sourceCode, setSourceCode] = useState("");
  const [step,     setStep]     = useState<InvokeStep>("idle");
  const [result,   setResult]   = useState<Record<string, unknown> | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [txHash,   setTxHash]   = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const requiresSourceCode = service.endpointUrl.endsWith("/api/paid/audit");
  const auditReport: AuditReport | null = isAuditReport(result?.data) ? result.data : null;
  const paymentReceipt = result?.receipt as Record<string, string> | undefined;
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
    setStep("quote");
    await new Promise(r => setTimeout(r, 350));
    setStep("auth");
    await new Promise(r => setTimeout(r, 450));
    setStep("executing");

    try {
      const res  = await fetch(`/api/services/${service.id}/invoke`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          maxPerPaymentUsdc: maxPer,
          budgetUsdc: budget,
          input: requiresSourceCode ? { sourceCode } : undefined,
        }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        setStep("failed");
        setError((data.error as string) ?? `HTTP ${res.status}`);
        return;
      }
      setStep("done");
      setResult(data);
      const receipt = data.receipt as Record<string, string> | undefined;
      setTxHash(receipt?.transactionHash ?? null);
    } catch (err) {
      setStep("failed");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function stepState(key: string): "idle"|"active"|"done"|"fail" {
    const curIdx = INVOKE_STEPS.findIndex(s => s.key === step);
    const myIdx  = INVOKE_STEPS.findIndex(s => s.key === key);
    if (step === "done")   return "done";
    if (step === "failed" && myIdx === curIdx) return "fail";
    if (myIdx < curIdx)    return "done";
    if (myIdx === curIdx)  return "active";
    return "idle";
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50">

        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-base font-bold text-white">Invoke Service</h2>
            <p className="text-sm text-slate-400 mt-0.5">{service.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors text-xl leading-none mt-0.5">×</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Payment info */}
          <div className="rounded-xl bg-slate-800 border border-slate-700 p-4 flex items-start gap-3">
            <Info className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-slate-400 space-y-0.5">
              <p>Price: <span className="text-white font-semibold">{service.priceUsdc} USDC</span> · {service.endpointMethod} {service.endpointUrl.split("/").slice(-2).join("/")}</p>
              <p>Network: <span className="text-slate-300">{service.network}</span></p>
              <p>Facilitator: <span className="text-slate-300 font-mono text-[10px]">{service.facilitatorUrl}</span></p>
            </div>
          </div>

          {requiresSourceCode && (
            <div>
              <label htmlFor="audit-source" className="block text-xs text-slate-400 mb-1.5">Solidity source</label>
              <textarea
                id="audit-source"
                value={sourceCode}
                onChange={e => setSourceCode(e.target.value)}
                disabled={loading}
                rows={9}
                spellCheck={false}
                placeholder="Paste the Solidity contract to audit"
                className="w-full min-h-40 max-h-64 resize-y rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-violet-500 disabled:opacity-50"
              />
            </div>
          )}

          {/* Spend controls */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Max per payment</label>
              <input
                type="number" step="0.01" min={service.priceUsdc}
                value={maxPer} onChange={e => setMaxPer(e.target.value)} disabled={loading}
                className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Session budget</label>
              <input
                type="number" step="0.01" min={service.priceUsdc}
                value={budget} onChange={e => setBudget(e.target.value)} disabled={loading}
                className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500 disabled:opacity-50"
              />
            </div>
          </div>

          {/* Step tracker */}
          {step !== "idle" && (
            <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-4 space-y-3">
              {INVOKE_STEPS.map(s => (
                <StepRow key={s.key} label={s.label} state={stepState(s.key)} />
              ))}
            </div>
          )}

          {/* Settlement tx */}
          {txHash && (
            <a
              href={`${EXPLORER}/tx/${txHash}`}
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
            <div className="rounded-xl bg-green-950/20 border border-green-700/40 p-4">
                  <p className="text-xs font-semibold text-green-400 mb-2">{auditReport ? "Audit completed" : "Service response"}</p>
              {typeof result.warning === "string" && (
                <p className="text-xs text-amber-300 mb-2">{result.warning}</p>
              )}
                  {auditReport ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{auditReport.score}/100 · {auditReport.verdict.replaceAll("_", " ")}</p>
                        <p className="mt-1 text-xs text-slate-400">{auditReport.findings.length} findings · {auditReport.summary}</p>
                      </div>
                      <button onClick={() => setShowReport(true)} className="inline-flex items-center gap-2 rounded-md border border-green-700/60 px-3 py-2 text-xs font-semibold text-green-200 hover:bg-green-900/30">
                        <FileSearch className="h-4 w-4" /> View full report
                      </button>
                    </div>
                  ) : (
                    <pre className="text-xs text-slate-300 overflow-auto max-h-40 whitespace-pre-wrap font-mono">
                      {JSON.stringify(result.data ?? result, null, 2)}
                    </pre>
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
              disabled={loading || step === "done"}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 text-sm transition-colors"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                : step === "done"
                ? <><CheckCircle className="w-4 h-4" /> Done</>
                : <>Pay {service.priceUsdc} USDC &amp; call</>}
            </button>
            <button
              onClick={onClose}
              className="px-4 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 text-sm transition-colors"
            >
              Close
            </button>
          </div>
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
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white text-sm truncate group-hover:text-sky-300 transition-colors">{svc.name}</h3>
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 text-pretty">{svc.description}</p>
        </div>
        <PaymentModeBadge mode={svc.paymentMode} />
      </div>

      {/* Stats grid */}
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

      {/* Capabilities */}
      {svc.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {svc.capabilities.map(cap => (
            <span key={cap} className="rounded-full bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
              {cap}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
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
  const [services, setServices] = useState<Service[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [invoking, setInvoking] = useState<Service | null>(null);

  useEffect(() => {
    fetch("/api/services")
      .then(r => r.json() as Promise<{ services: Service[] }>)
      .then(d => setServices(d.services ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      {invoking && <InvokeModal service={invoking} onClose={() => setInvoking(null)} />}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Agent Services</h1>
          <p className="text-slate-400 text-sm mt-1">
            Paid API endpoints — pay per call via x402 or Gateway nanopayments on Arc Testnet.
          </p>
        </div>
        <Link
          href="/payments"
          className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
        >
          Payment history <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center gap-3 text-slate-400 py-16">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading services…
        </div>
      )}

      {/* Empty */}
      {!loading && services.length === 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center space-y-3">
          <p className="text-slate-400 text-sm">No services registered yet.</p>
          <p className="text-slate-600 text-xs">
            Run migrations 003 and 004, then start the x402 server with{" "}
            <code className="bg-slate-800 px-1.5 py-0.5 rounded text-violet-400 font-mono">bun run dev:x402</code>
          </p>
        </div>
      )}

      {/* Grid */}
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
