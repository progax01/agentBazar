"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { CheckCircle, Circle, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import clsx from "clsx";

const EXPLORER = "https://explorer.testnet.arc.io";

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
        // vulnerability: state update after external call
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        balances[msg.sender] -= amount; // reentrancy risk
    }

    function adminWithdraw(address to, uint256 amount) external {
        // vulnerability: no access control
        (bool ok,) = to.call{value: amount}("");
        require(ok, "failed");
    }
}`;

// ─── Step definitions ───────────────────────────────────────────────────────
type StepId = "validate" | "approve" | "fund" | "done";

interface Step {
  id:      StepId;
  label:   string;
  detail:  string;
}

const STEPS: Step[] = [
  { id: "validate", label: "Validating request",    detail: "Checking provider, budget, and source code" },
  { id: "approve",  label: "Approving USDC",         detail: "Buyer wallet approves exact USDC to escrow contract" },
  { id: "fund",     label: "Funding escrow",         detail: "createTask() called on AgetBazarEscrow on Arc Testnet" },
  { id: "done",     label: "Task funded",            detail: "Redirecting to task dashboard…" },
];

type StepStatus = "idle" | "active" | "done" | "error";

// ─── Component ──────────────────────────────────────────────────────────────
export default function NewTaskPage() {
  const router = useRouter();

  const [title,    setTitle]    = useState("");
  const [source,   setSource]   = useState(DEFAULT_SOURCE);
  const [budget,   setBudget]   = useState("0.25");
  const [deadline, setDeadline] = useState("3600");

  // Submission state
  const [phase, setPhase]           = useState<"form" | "submitting" | "success" | "error">("form");
  const [stepStatus, setStepStatus] = useState<Record<StepId, StepStatus>>({
    validate: "idle", approve: "idle", fund: "idle", done: "idle",
  });
  const [txHashes, setTxHashes]     = useState<{ approve?: string; create?: string }>({});
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);
  const [taskId,   setTaskId]       = useState<string | null>(null);

  function advanceStep(id: StepId, status: StepStatus) {
    setStepStatus((prev) => ({ ...prev, [id]: status }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPhase("submitting");
    setErrorMsg(null);
    setStepStatus({ validate: "active", approve: "idle", fund: "idle", done: "idle" });

    try {
      // Step 1: validate / fetch provider
      const agentsRes = await fetch("/api/agents");
      if (!agentsRes.ok) throw new Error("Could not load agents");
      const { agents } = await agentsRes.json();
      const provider = agents.find(
        (a: { role: string; isActive: boolean }) => a.role === "provider" && a.isActive,
      );
      if (!provider) throw new Error("No active provider agent configured.");

      advanceStep("validate", "done");
      advanceStep("approve", "active");

      // Step 2+3: fund (approve + createTask happen server-side together)
      const body = {
        taskType:        "solidity-source-report",
        title,
        input:           { sourceCode: source },
        budgetUsdc:      budget,
        deadlineSeconds: parseInt(deadline, 10),
        providerAgentId: provider.id,
        acceptanceCriteria: {
          requireSourceHash:            true,
          requireValidJson:             true,
          requireStaticAnalysisResults: true,
        },
        idempotencyKey: uuidv4(),
      };

      const res = await fetch("/api/tasks", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });

      // Approve tx confirmed on-chain — advance to fund step
      // (we don't get a mid-stream callback from the server, so we simulate
      //  the timing by flipping approve→done + fund→active right before parse)
      advanceStep("approve", "done");
      advanceStep("fund", "active");

      const ct   = res.headers.get("content-type") ?? "";
      const data = ct.includes("application/json")
        ? await res.json()
        : { error: `Server error ${res.status}: ${await res.text().then((t) => t.slice(0, 300))}` };

      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);

      advanceStep("fund", "done");
      advanceStep("done", "active");

      setTxHashes({ approve: data.transactions?.approve, create: data.transactions?.create });
      setTaskId(data.id);
      setPhase("success");
      advanceStep("done", "done");

      // Redirect after short pause so user can see success
      setTimeout(() => router.push(`/tasks/${data.id}`), 2500);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setPhase("error");
      // Mark the active step as error
      setStepStatus((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next) as StepId[]) {
          if (next[k] === "active") next[k] = "error";
        }
        return next;
      });
    }
  }

  // ─── Form ─────────────────────────────────────────────────────────────────
  if (phase === "form") {
    return (
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">New Security Analysis</h1>
          <p className="text-gray-400 mt-2 text-pretty">
            Submit Solidity source code. The buyer wallet will fund an escrow on Arc Testnet and
            the provider agent will run a deterministic security analysis.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl bg-gray-900 border border-gray-800 p-6">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">Task title</label>
            <input
              type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              required placeholder="Analyze VulnerableVault.sol"
              className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          {/* Source */}
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">
              Solidity source code
            </label>
            <textarea
              value={source} onChange={(e) => setSource(e.target.value)}
              required rows={16}
              className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-sm font-mono text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500 resize-y"
            />
            <p className="text-xs text-gray-500 mt-1">{source.length.toLocaleString()} chars · max 100 KB</p>
          </div>

          {/* Budget + Deadline */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-1.5">Budget (USDC)</label>
              <input
                type="number" value={budget} onChange={(e) => setBudget(e.target.value)}
                min="0.01" max="1.00" step="0.01" required
                className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-1.5">Deadline</label>
              <select
                value={deadline} onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="3600">1 hour</option>
                <option value="21600">6 hours</option>
                <option value="86400">24 hours</option>
              </select>
            </div>
          </div>

          {/* Info box */}
          <div className="rounded-xl bg-sky-950/40 border border-sky-800/40 p-4 text-xs text-sky-300 space-y-1">
            <p className="font-semibold text-sky-200">What happens next</p>
            <p>1. Buyer wallet approves exact USDC to the escrow contract on Arc Testnet</p>
            <p>2. <code className="font-mono">createTask()</code> is called — USDC moves into escrow</p>
            <p>3. Provider agent picks up the task, runs <code className="font-mono">solc</code> + pattern analysis</p>
            <p>4. Verifier checks the report; payment is released or refunded automatically</p>
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-sky-600 px-5 py-3.5 font-semibold text-white hover:bg-sky-500 transition-colors"
          >
            Create and Fund Task — {budget} USDC
          </button>
        </form>
      </div>
    );
  }

  // ─── Submission progress / success / error ────────────────────────────────
  return (
    <div className="max-w-lg mx-auto space-y-8 py-8">
      <div>
        <h1 className="text-2xl font-bold text-white">
          {phase === "error" ? "Submission failed" : phase === "success" ? "Task funded!" : "Funding task…"}
        </h1>
        <p className="text-gray-400 mt-1 text-sm">
          {phase === "error"
            ? "Something went wrong. See the error below."
            : phase === "success"
            ? "Redirecting to task detail page…"
            : "Do not close this tab. Transactions are being signed and submitted."}
        </p>
      </div>

      {/* Step list */}
      <div className="rounded-2xl bg-gray-900 border border-gray-800 divide-y divide-gray-800 overflow-hidden">
        {STEPS.map((step) => {
          const s = stepStatus[step.id];
          return (
            <div key={step.id} className={clsx(
              "flex items-start gap-4 px-5 py-4 transition-colors",
              s === "active" && "bg-sky-950/30",
              s === "done"   && "bg-green-950/20",
              s === "error"  && "bg-red-950/20",
            )}>
              <div className="mt-0.5 flex-shrink-0">
                {s === "idle"   && <Circle     className="w-5 h-5 text-gray-600" />}
                {s === "active" && <Loader2    className="w-5 h-5 text-sky-400 animate-spin" />}
                {s === "done"   && <CheckCircle className="w-5 h-5 text-green-400" />}
                {s === "error"  && <AlertCircle className="w-5 h-5 text-red-400" />}
              </div>
              <div className="min-w-0">
                <p className={clsx(
                  "font-medium text-sm",
                  s === "idle"   && "text-gray-500",
                  s === "active" && "text-sky-200",
                  s === "done"   && "text-green-300",
                  s === "error"  && "text-red-300",
                )}>
                  {step.label}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{step.detail}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tx hashes */}
      {(txHashes.approve || txHashes.create) && (
        <div className="rounded-2xl bg-gray-900 border border-gray-800 p-5 space-y-3">
          <p className="text-sm font-semibold text-gray-200">On-chain transactions</p>
          {txHashes.approve && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-gray-400">USDC approve</span>
              <a
                href={`${EXPLORER}/tx/${txHashes.approve}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs font-mono text-sky-400 hover:text-sky-300"
              >
                {txHashes.approve.slice(0, 12)}…{txHashes.approve.slice(-8)}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
          {txHashes.create && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-gray-400">createTask</span>
              <a
                href={`${EXPLORER}/tx/${txHashes.create}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs font-mono text-sky-400 hover:text-sky-300"
              >
                {txHashes.create.slice(0, 12)}…{txHashes.create.slice(-8)}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {phase === "error" && errorMsg && (
        <div className="rounded-2xl bg-red-950/30 border border-red-800 p-5 space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-200">{errorMsg}</p>
          </div>
          <button
            onClick={() => setPhase("form")}
            className="rounded-lg bg-gray-800 border border-gray-700 px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
          >
            Back to form
          </button>
        </div>
      )}

      {/* Success CTA */}
      {phase === "success" && taskId && (
        <button
          onClick={() => router.push(`/tasks/${taskId}`)}
          className="w-full rounded-xl bg-sky-600 px-5 py-3.5 font-semibold text-white hover:bg-sky-500 transition-colors"
        >
          View task →
        </button>
      )}
    </div>
  );
}
