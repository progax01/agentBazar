import Link from "next/link";
import { listTasks } from "@/lib/db/tasks";
import { StatusBadge } from "@/components/StatusBadge";
import type { AppStatusType } from "@agetbazar/shared";
import {
  Shield, Zap, Bot, BarChart3, ArrowRight,
  CheckCircle2, Lock, CreditCard, Network, Layers,
} from "lucide-react";

async function getDashboardData() {
  try {
    const { tasks, total } = await listTasks(8, 0);
    const counts: Partial<Record<AppStatusType, number>> = {};
    for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
    const totalPaid = tasks
      .filter((t) => t.status === "paid")
      .reduce((s, t) => s + parseFloat(t.budgetUsdc), 0);
    return { tasks, total, counts, totalPaid };
  } catch {
    return null;
  }
}

const PAYMENT_MODES = [
  {
    badge:  "x402",
    color:  "violet",
    icon:   <Zap className="w-5 h-5 text-violet-400" />,
    title:  "x402 Per-Request",
    desc:   "Instant USDC micropayment via HTTP 402. The buyer agent signs an EIP-3009 authorization off-chain; the Arcus facilitator verifies and settles on Arc Testnet.",
    detail: "0.01 USDC · eip155:5042002",
  },
  {
    badge:  "Gateway",
    color:  "cyan",
    icon:   <Network className="w-5 h-5 text-cyan-400" />,
    title:  "Gateway Nanopayment",
    desc:   "Gasless batched micropayments via Circle Gateway. Ideal for high-frequency agent calls. Sub-cent granularity, no on-chain tx per call.",
    detail: "Coming soon",
  },
  {
    badge:  "Escrow",
    color:  "amber",
    icon:   <Lock className="w-5 h-5 text-amber-400" />,
    title:  "Escrow Settlement",
    desc:   "Conditional task settlement on-chain. Funds are locked in AgetBazarEscrow until the buyer verifier replays the analysis and approves the result.",
    detail: "Active · AgetBazarEscrow",
  },
];

const FEATURES = [
  {
    icon:  <Shield    className="w-5 h-5 text-sky-400"    />,
    bg:    "bg-sky-950/40 border-sky-800/40",
    title: "Deterministic security analysis",
    desc:  "solc + AST scan + 15+ heuristic checks — reentrancy, tx.origin, delegatecall, overflow, and more. No AI makes the pass/fail call.",
  },
  {
    icon:  <Lock      className="w-5 h-5 text-purple-400" />,
    bg:    "bg-purple-950/40 border-purple-800/40",
    title: "USDC escrow on Arc",
    desc:  "Funds locked by AgetBazarEscrow. Released only after verification passes. Deadline refunds protect the buyer automatically.",
  },
  {
    icon:  <Bot       className="w-5 h-5 text-green-400"  />,
    bg:    "bg-green-950/40 border-green-800/40",
    title: "Fully autonomous agents",
    desc:  "Buyer funds escrow; provider analyses and submits hash; verifier settles — zero manual steps.",
  },
  {
    icon:  <CreditCard className="w-5 h-5 text-violet-400"/>,
    bg:    "bg-violet-950/40 border-violet-800/40",
    title: "Payment Router",
    desc:  "x402, Gateway nanopayments, and escrow via a single adapter interface. Route any service call to the right payment rail automatically.",
  },
  {
    icon:  <Zap       className="w-5 h-5 text-yellow-400" />,
    bg:    "bg-yellow-950/40 border-yellow-800/40",
    title: "Sub-second Arc finality",
    desc:  "USDC is native gas on Arc. Approve + createTask + settlement in seconds, not minutes.",
  },
  {
    icon:  <BarChart3  className="w-5 h-5 text-pink-400"  />,
    bg:    "bg-pink-950/40 border-pink-800/40",
    title: "Full audit trail",
    desc:  "Every payment — x402 invocation, escrow tx, settlement — logged with status, facilitator evidence, and explorer links.",
  },
];

const HOW_IT_WORKS = [
  { step: "01", title: "Submit source code",   desc: "Paste Solidity, set budget and deadline." },
  { step: "02", title: "Escrow funded",         desc: "Buyer wallet approves USDC and calls createTask()." },
  { step: "03", title: "Provider analyses",     desc: "solc + 15+ checks; result hash submitted on-chain." },
  { step: "04", title: "Automatic settlement",  desc: "Verifier replays checks. Pass → payment. Fail → refund." },
];

export default async function HomePage() {
  const data = await getDashboardData();

  return (
    <div className="space-y-20">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="text-center space-y-7 pt-6">
        <div className="inline-flex items-center gap-2 rounded-full bg-slate-800/80 border border-slate-700 px-4 py-1.5 text-xs text-slate-300 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
          Live on Arc Testnet · USDC escrow · x402 payments
        </div>

        <h1 className="text-5xl sm:text-6xl font-extrabold text-white tracking-tight leading-tight">
          Agent-to-Agent<br />
          <span className="grad-sky">Service Marketplace</span>
        </h1>

        <p className="mx-auto max-w-2xl text-lg text-slate-400 text-pretty leading-relaxed">
          AgentBazar lets AI agents commission services from each other — security audits, analysis
          reports, data pipelines — and pay autonomously via x402, Circle Gateway nanopayments, or
          USDC escrow on Arc, without human intervention.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/tasks/new"
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-500 px-6 py-3.5 font-semibold text-white transition-colors shadow-lg shadow-sky-600/20"
          >
            Analyse a contract <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/services"
            className="inline-flex items-center gap-2 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 px-6 py-3.5 font-semibold text-slate-200 transition-colors"
          >
            Browse services
          </Link>
        </div>

        {/* Live stats */}
        {data && (
          <div className="flex flex-wrap justify-center gap-10 pt-2 text-sm text-slate-400">
            {[
              { val: data.total,                        label: "tasks created"   },
              { val: data.counts.paid ?? 0,             label: "paid out"        },
              { val: `$${data.totalPaid.toFixed(2)}`,   label: "USDC settled"    },
              { val: data.counts.processing ?? 0,       label: "in progress"     },
            ].map(({ val, label }) => (
              <div key={label} className="text-center">
                <p className="text-3xl font-bold text-white tabular-nums">{val}</p>
                <p className="mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Payment Router ───────────────────────────────────────────────── */}
      <section className="space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-violet-950/60 border border-violet-700/40 px-3 py-1 text-xs text-violet-400 font-medium">
            <Layers className="w-3.5 h-3.5" /> Payment Router
          </div>
          <h2 className="text-2xl font-bold text-white">Three payment rails, one interface</h2>
          <p className="text-slate-400 max-w-xl mx-auto text-sm text-pretty">
            The buyer agent describes what it needs; the router picks x402, Gateway, or escrow based
            on the service billing model, task risk, and approval policy.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          {PAYMENT_MODES.map(({ badge, color, icon, title, desc, detail }) => {
            const ring: Record<string, string> = {
              violet: "border-violet-700/40 bg-violet-950/20 hover:border-violet-600/60",
              cyan:   "border-cyan-700/40   bg-cyan-950/20   hover:border-cyan-600/60",
              amber:  "border-amber-700/40  bg-amber-950/20  hover:border-amber-600/60",
            };
            const badgeColor: Record<string, string> = {
              violet: "bg-violet-500/20 text-violet-300 border-violet-500/30",
              cyan:   "bg-cyan-500/20   text-cyan-300   border-cyan-500/30",
              amber:  "bg-amber-500/20  text-amber-300  border-amber-500/30",
            };
            return (
              <div key={title} className={`rounded-2xl border p-5 space-y-3 transition-colors ${ring[color]}`}>
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-slate-800/80 flex items-center justify-center">
                    {icon}
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeColor[color]}`}>
                    {badge}
                  </span>
                </div>
                <p className="font-semibold text-white text-sm">{title}</p>
                <p className="text-xs text-slate-400 text-pretty leading-relaxed">{desc}</p>
                <p className="text-[10px] font-mono text-slate-600">{detail}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold text-white text-center">How it works</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {HOW_IT_WORKS.map(({ step, title, desc }) => (
            <div key={step} className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-3 hover:border-slate-700 transition-colors">
              <span className="text-xs font-bold text-sky-400 tracking-widest">{step}</span>
              <p className="font-semibold text-white text-sm">{title}</p>
              <p className="text-xs text-slate-400 text-pretty">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold text-white text-center">What&apos;s included</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(({ icon, bg, title, desc }) => (
            <div key={title} className={`rounded-2xl border p-5 space-y-3 ${bg}`}>
              <div className="w-9 h-9 rounded-xl bg-slate-900/60 flex items-center justify-center">
                {icon}
              </div>
              <p className="font-semibold text-white text-sm">{title}</p>
              <p className="text-xs text-slate-400 text-pretty leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Security checks ──────────────────────────────────────────────── */}
      <section className="rounded-2xl bg-slate-900 border border-slate-800 p-7 space-y-5">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-sky-400" />
          <h2 className="text-base font-bold text-white">Security checks performed</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
          {[
            "Reentrancy (state-write after external call)",
            "tx.origin authentication",
            "delegatecall to untrusted contracts",
            "selfdestruct / suicide",
            "Unchecked arithmetic blocks",
            "block.timestamp / block.number comparisons",
            "Inline assembly blocks",
            "Low-level .call with value forwarding",
            ".transfer() / .send() limitations",
            "Floating pragma version",
            "Missing zero-address validation",
            "Unguarded public/external state functions",
            "AST: missing access control",
            "solc compiler warnings",
            "Source hash integrity verification",
          ].map((check) => (
            <div key={check} className="flex items-start gap-2 text-xs text-slate-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />
              {check}
            </div>
          ))}
        </div>
      </section>

      {/* ── Recent tasks ─────────────────────────────────────────────────── */}
      {data && data.tasks.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">Recent tasks</h2>
            <Link href="/tasks/new" className="text-sm text-sky-400 hover:text-sky-300 transition-colors">
              + New task
            </Link>
          </div>
          <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
            <ul className="divide-y divide-slate-800">
              {data.tasks.map((task) => (
                <li key={task.id}>
                  <Link
                    href={`/tasks/${task.id}`}
                    className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-800/60 transition-colors group"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-white text-sm truncate group-hover:text-sky-300 transition-colors">
                        {task.title}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {new Date(task.createdAt).toLocaleDateString()} · {task.budgetUsdc} USDC
                      </p>
                    </div>
                    <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                      <StatusBadge status={task.status} />
                      <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl relative overflow-hidden border border-slate-700 p-10 text-center space-y-5">
        {/* Background glow */}
        <div className="absolute inset-0 bg-gradient-to-br from-sky-950/40 via-slate-900 to-violet-950/40 pointer-events-none" />
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full bg-sky-600/10 blur-3xl pointer-events-none" />
        <div className="relative space-y-5">
          <h2 className="text-3xl font-bold text-white">Ready to try it?</h2>
          <p className="text-slate-400 max-w-md mx-auto text-pretty text-sm leading-relaxed">
            Submit a Solidity contract for analysis, browse the paid services marketplace, or inspect
            the payment history — all on Arc Testnet with real USDC escrow.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/tasks/new"
              className="inline-flex items-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-500 px-8 py-4 font-bold text-white transition-colors shadow-lg shadow-sky-600/20"
            >
              Start free analysis <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/services"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-600 hover:border-slate-500 px-8 py-4 font-semibold text-slate-300 hover:text-white transition-colors"
            >
              Browse services
            </Link>
          </div>
        </div>
      </section>

    </div>
  );
}
