import Link from "next/link";
import { listTasks } from "@/lib/db/tasks";
import { StatusBadge } from "@/components/StatusBadge";
import type { AppStatusType } from "@agetbazar/shared";
import {
  Shield, Zap, Bot, BarChart3, ArrowRight,
  CheckCircle2, Lock, Coins,
} from "lucide-react";

async function getDashboardData() {
  try {
    const { tasks, total } = await listTasks(10, 0);
    const counts: Partial<Record<AppStatusType, number>> = {};
    for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
    const totalPaid = tasks.filter((t) => t.status === "paid")
      .reduce((s, t) => s + parseFloat(t.budgetUsdc), 0);
    return { tasks, total, counts, totalPaid };
  } catch { return null; }
}

const FEATURES = [
  {
    icon: <Shield   className="w-6 h-6 text-sky-400" />,
    title: "Deterministic security analysis",
    desc:  "solc compilation, AST pattern scanning, reentrancy detection, tx.origin, delegatecall, overflow, and 15+ heuristic checks — no AI makes the pass/fail call.",
  },
  {
    icon: <Lock     className="w-6 h-6 text-purple-400" />,
    title: "USDC escrow on Arc Testnet",
    desc:  "Funds are held by the AgetBazarEscrow contract. Payment is released only after deterministic verification passes. Timeout refunds protect the buyer.",
  },
  {
    icon: <Bot      className="w-6 h-6 text-green-400" />,
    title: "Fully automated agents",
    desc:  "A buyer agent funds the escrow; a provider agent performs the analysis and submits its result hash on-chain; a verifier settles without manual intervention.",
  },
  {
    icon: <Zap      className="w-6 h-6 text-yellow-400" />,
    title: "Sub-second Arc finality",
    desc:  "Arc native USDC gas and fast block times mean approve + createTask + submitResult + settlement confirm in seconds, not minutes.",
  },
  {
    icon: <Coins    className="w-6 h-6 text-orange-400" />,
    title: "Transparent on-chain settlement",
    desc:  "Every transaction — approval, task creation, result submission, payout or refund — is publicly verifiable on the Arc Testnet explorer.",
  },
  {
    icon: <BarChart3 className="w-6 h-6 text-pink-400" />,
    title: "Live dashboard & detailed reports",
    desc:  "Track task status end-to-end, browse annotated findings, view the submitted source with highlighted vulnerability lines, and inspect every on-chain event.",
  },
];

const HOW_IT_WORKS = [
  { step: "01", title: "Submit source code",   desc: "Paste any Solidity contract. Set a USDC budget and deadline." },
  { step: "02", title: "Buyer funds escrow",    desc: "The buyer wallet approves USDC and calls createTask(). Funds are locked on-chain." },
  { step: "03", title: "Provider analyses",     desc: "The provider agent compiles with solc, runs 15+ security checks, and submits the result hash on-chain." },
  { step: "04", title: "Verifier settles",      desc: "The buyer verifier replays the checks. On pass → payment released. On failure → USDC refunded." },
];

export default async function HomePage() {
  const data = await getDashboardData();

  return (
    <div className="space-y-20">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="text-center space-y-6 pt-8">
        <div className="inline-flex items-center gap-2 rounded-full bg-sky-950/50 border border-sky-800/50 px-4 py-1.5 text-xs text-sky-300 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
          Live on Arc Testnet · USDC escrow
        </div>

        <h1 className="text-5xl font-extrabold text-white tracking-tight text-balance leading-tight">
          Agent-to-Agent<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-purple-400">
            Smart Contract Auditing
          </span>
        </h1>

        <p className="mx-auto max-w-2xl text-lg text-gray-400 text-pretty">
          AgentBazar is an autonomous marketplace where a buyer agent commissions a Solidity
          security analysis, escrows USDC on Arc, and releases payment only after deterministic
          on-chain verification passes — no humans required.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/tasks/new"
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-6 py-3.5 font-semibold text-white hover:bg-sky-500 transition-colors"
          >
            Analyse a contract <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/agents"
            className="inline-flex items-center gap-2 rounded-xl bg-gray-800 border border-gray-700 px-6 py-3.5 font-semibold text-gray-200 hover:bg-gray-700 transition-colors"
          >
            View agents
          </Link>
        </div>

        {/* Live stats */}
        {data && (
          <div className="flex flex-wrap justify-center gap-8 pt-4 text-sm text-gray-400">
            <div className="text-center">
              <p className="text-3xl font-bold text-white tabular-nums">{data.total}</p>
              <p>tasks created</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-white tabular-nums">{data.counts.paid ?? 0}</p>
              <p>paid out</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-white tabular-nums">${data.totalPaid.toFixed(2)}</p>
              <p>USDC settled</p>
            </div>
          </div>
        )}
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="space-y-8">
        <h2 className="text-2xl font-bold text-white text-center">How it works</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {HOW_IT_WORKS.map(({ step, title, desc }) => (
            <div key={step} className="rounded-2xl bg-gray-900 border border-gray-800 p-5 space-y-3">
              <span className="text-xs font-bold text-sky-400 tracking-widest">{step}</span>
              <p className="font-semibold text-white">{title}</p>
              <p className="text-sm text-gray-400 text-pretty">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section className="space-y-8">
        <h2 className="text-2xl font-bold text-white text-center">What&apos;s included</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(({ icon, title, desc }) => (
            <div key={title} className="rounded-2xl bg-gray-900 border border-gray-800 p-5 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                {icon}
              </div>
              <p className="font-semibold text-white">{title}</p>
              <p className="text-sm text-gray-400 text-pretty">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Security checks ──────────────────────────────────────────────── */}
      <section className="rounded-2xl bg-gray-900 border border-gray-800 p-8 space-y-6">
        <h2 className="text-xl font-bold text-white">Security checks performed</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          {[
            "Reentrancy (state-write after external call)",
            "tx.origin used for authentication",
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
            "AST: missing access control modifiers",
            "solc compiler warnings",
            "Source hash integrity verification",
          ].map((check) => (
            <div key={check} className="flex items-start gap-2.5 text-sm text-gray-300">
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
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
            <Link href="/tasks/new" className="text-sm text-sky-400 hover:text-sky-300">
              New task →
            </Link>
          </div>
          <div className="rounded-2xl bg-gray-900 border border-gray-800 overflow-hidden">
            <ul className="divide-y divide-gray-800">
              {data.tasks.map((task) => (
                <li key={task.id}>
                  <Link
                    href={`/tasks/${task.id}`}
                    className="flex items-center justify-between px-5 py-4 hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-white truncate">{task.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {new Date(task.createdAt).toLocaleDateString()} ·{" "}
                        {task.budgetUsdc} USDC
                      </p>
                    </div>
                    <StatusBadge status={task.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl bg-gradient-to-br from-sky-950/60 to-purple-950/60 border border-sky-800/30 p-10 text-center space-y-5">
        <h2 className="text-3xl font-bold text-white">Ready to audit your contract?</h2>
        <p className="text-gray-400 max-w-md mx-auto text-pretty">
          Paste your Solidity source, set a USDC budget, and let the agents handle the rest.
          Results arrive in under a minute on Arc Testnet.
        </p>
        <Link
          href="/tasks/new"
          className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-8 py-4 font-bold text-white hover:bg-sky-500 transition-colors"
        >
          Start a free analysis <ArrowRight className="w-5 h-5" />
        </Link>
      </section>

    </div>
  );
}
