"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Loader2, ExternalLink, ArrowLeft, ArrowRight, Coins } from "lucide-react";
import type { ServicePayment } from "@agetbazar/shared";

const EXPLORER = "https://explorer.testnet.arc.io";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:               { label: "Pending",    cls: "text-slate-400  bg-slate-700/40 border-slate-600"      },
  quote_received:        { label: "Quoted",     cls: "text-blue-400   bg-blue-500/10 border-blue-500/30"     },
  authorization_created: { label: "Authorized", cls: "text-violet-400 bg-violet-500/10 border-violet-500/30" },
  payment_verified:      { label: "Verified",   cls: "text-cyan-400   bg-cyan-500/10 border-cyan-500/30"     },
  executing:             { label: "Executing",  cls: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30" },
  gateway_accepted:      { label: "Accepted",   cls: "text-teal-400   bg-teal-500/10 border-teal-500/30"     },
  settlement_pending:    { label: "Settling",   cls: "text-orange-400 bg-orange-500/10 border-orange-500/30" },
  settled:               { label: "Settled",    cls: "text-green-400  bg-green-500/10 border-green-500/30"   },
  failed:                { label: "Failed",     cls: "text-red-400    bg-red-500/10 border-red-500/30"       },
};

const PIPELINE = ["pending","quote_received","authorization_created","payment_verified","executing","settled"];

const MODE_CLS: Record<string, string> = {
  x402:                "bg-violet-500/15 text-violet-300 border-violet-500/30",
  gateway_nanopayment: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  escrow:              "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

function PaymentStatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, cls: "text-slate-400 bg-slate-700 border-slate-600" };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${m.cls}`}>
      {m.label}
    </span>
  );
}

function PaymentRow({ p }: { p: ServicePayment }) {
  const amount = (parseInt(p.amountRaw) / 1_000_000).toFixed(4);
  const curPipelineIdx = PIPELINE.indexOf(p.status);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3 hover:border-slate-700 transition-colors">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white text-sm truncate">{p.serviceName ?? p.serviceId}</span>
            <PaymentStatusBadge status={p.status} />
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${MODE_CLS[p.paymentMode] ?? "bg-slate-700 text-slate-300 border-slate-600"}`}>
              {p.paymentMode === "gateway_nanopayment" ? "Gateway" : p.paymentMode}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {new Date(p.createdAt).toLocaleString()}
            {p.settledAt && <> · settled {new Date(p.settledAt).toLocaleString()}</>}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-base font-bold text-white tabular-nums">{amount}</p>
          <p className="text-xs text-slate-500">USDC</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg bg-slate-800 px-3 py-2">
          <p className="text-slate-500 mb-0.5">Network</p>
          <p className="text-slate-300 font-mono truncate">{p.network}</p>
        </div>
        <div className="rounded-lg bg-slate-800 px-3 py-2">
          <p className="text-slate-500 mb-0.5">HTTP</p>
          <p className={`font-semibold ${p.httpStatus === 200 ? "text-green-400" : p.httpStatus ? "text-red-400" : "text-slate-600"}`}>
            {p.httpStatus ?? "—"}
          </p>
        </div>
        <div className="rounded-lg bg-slate-800 px-3 py-2">
          <p className="text-slate-500 mb-0.5">Facilitator</p>
          <p className="text-slate-300 truncate text-[10px]">{p.facilitator ?? "—"}</p>
        </div>
      </div>

      {/* Pipeline dots */}
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
        {PIPELINE.map((key, i) => {
          const done   = p.status === "settled" || curPipelineIdx >= i;
          const isFail = p.status === "failed"  && i === curPipelineIdx;
          return (
            <div key={key} className="flex items-center gap-1 flex-shrink-0">
              {i > 0 && (
                <div className={`h-px w-5 ${done ? "bg-violet-500" : "bg-slate-700"}`} />
              )}
              <div
                title={STATUS_META[key]?.label ?? key}
                className={`w-2 h-2 rounded-full ${
                  isFail  ? "bg-red-500"     :
                  done    ? "bg-violet-500"  : "bg-slate-700"
                }`}
              />
            </div>
          );
        })}
        <span className="text-[10px] text-slate-500 ml-2 whitespace-nowrap">
          {STATUS_META[p.status]?.label ?? p.status}
        </span>
      </div>

      {/* Settlement tx */}
      {p.txHash && (
        <a
          href={`${EXPLORER}/tx/${p.txHash}`}
          target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Settlement: <span className="font-mono">{p.txHash.slice(0, 16)}…{p.txHash.slice(-6)}</span>
        </a>
      )}

      {/* Error */}
      {p.errorMessage && (
        <div className="rounded-lg bg-red-950/20 border border-red-700/30 px-3 py-2">
          <p className="text-xs text-red-400">{p.errorMessage}</p>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PaymentsPage() {
  const [payments, setPayments] = useState<ServicePayment[]>([]);
  const [total,    setTotal]    = useState(0);
  const [offset,   setOffset]   = useState(0);
  const [loading,  setLoading]  = useState(true);
  const LIMIT = 15;

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/payments?limit=${LIMIT}&offset=${offset}`)
      .then(r => r.json() as Promise<{ payments: ServicePayment[]; total: number }>)
      .then(d => { setPayments(d.payments ?? []); setTotal(d.total ?? 0); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [offset]);

  useEffect(() => { load(); }, [load]);

  const settled    = payments.filter(p => p.status === "settled").length;
  const totalUsdc  = payments
    .filter(p => p.status === "settled")
    .reduce((acc, p) => acc + parseInt(p.amountRaw) / 1_000_000, 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Payment History</h1>
          <p className="text-slate-400 text-sm mt-1">
            x402 service calls, Gateway nanopayments, and escrow settlements.
          </p>
        </div>
        <Link
          href="/services"
          className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Services
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total payments",   value: String(total)               },
          { label: "Settled",          value: String(settled)             },
          { label: "USDC transferred", value: `$${totalUsdc.toFixed(4)}`  },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-center">
            <p className="text-xl font-bold text-white tabular-nums">{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center gap-3 text-slate-400 py-16">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading payments…
        </div>
      )}

      {/* Empty */}
      {!loading && payments.length === 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center space-y-2">
          <Coins className="w-8 h-8 text-slate-700 mx-auto" />
          <p className="text-slate-400 text-sm">No payments recorded yet.</p>
          <p className="text-slate-600 text-xs">
            Use the{" "}
            <Link href="/services" className="text-violet-400 hover:text-violet-300">Services</Link>
            {" "}page to invoke a paid endpoint.
          </p>
        </div>
      )}

      {/* List */}
      <div className="space-y-3">
        {payments.map(p => <PaymentRow key={p.id} p={p} />)}
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setOffset(o => Math.max(0, o - LIMIT))}
            disabled={offset === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-700 text-sm text-slate-300 hover:text-white disabled:opacity-30 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Previous
          </button>
          <span className="text-xs text-slate-500">
            {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
          </span>
          <button
            onClick={() => setOffset(o => o + LIMIT)}
            disabled={offset + LIMIT >= total}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-700 text-sm text-slate-300 hover:text-white disabled:opacity-30 transition-colors"
          >
            Next <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
