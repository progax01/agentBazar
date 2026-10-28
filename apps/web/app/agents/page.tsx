import { listAgents } from "@/lib/db/agents";
import type { Agent } from "@agetbazar/shared";
import { Bot, Shield, Wallet, Zap } from "lucide-react";

function RoleBadge({ role }: { role: "buyer" | "provider" }) {
  return role === "buyer" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
      <Wallet className="w-2.5 h-2.5" /> Buyer
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
      <Shield className="w-2.5 h-2.5" /> Provider
    </span>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4 hover:border-slate-700 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
            agent.role === "buyer"
              ? "bg-sky-950/60 border border-sky-800/40"
              : "bg-violet-950/60 border border-violet-800/40"
          }`}>
            <Bot className={`w-5 h-5 ${agent.role === "buyer" ? "text-sky-400" : "text-violet-400"}`} />
          </div>
          <div>
            <p className="font-semibold text-white text-sm">{agent.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <RoleBadge role={agent.role} />
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                agent.isActive
                  ? "bg-green-900/50 text-green-300"
                  : "bg-slate-700/50 text-slate-400"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${agent.isActive ? "bg-green-400 animate-pulse" : "bg-slate-500"}`} />
                {agent.isActive ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Wallet */}
      <div className="rounded-xl bg-slate-800/60 border border-slate-700 px-3 py-2.5">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Wallet address</p>
        <p className="font-mono text-xs text-slate-300 break-all leading-relaxed">{agent.walletAddress}</p>
      </div>

      {/* Capabilities */}
      {agent.capabilities.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Capabilities</p>
          <div className="flex flex-wrap gap-1.5">
            {agent.capabilities.map((cap) => (
              <span key={cap} className="inline-flex items-center gap-1 rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300">
                <Zap className="w-2.5 h-2.5 text-slate-500" />
                {cap}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Since */}
      <p className="text-[10px] text-slate-600">
        Registered {new Date(agent.createdAt).toLocaleDateString()}
      </p>
    </div>
  );
}

export default async function AgentsPage() {
  let agents: Agent[] = [];
  try { agents = await listAgents(); } catch { /* DB not ready */ }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Agents</h1>
        <p className="text-slate-400 text-sm mt-1">
          Registered buyer and provider agents with their wallet addresses and capabilities.
        </p>
      </div>

      {agents.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center space-y-3">
          <Bot className="w-10 h-10 text-slate-700 mx-auto" />
          <p className="text-slate-400 text-sm">No agents configured yet.</p>
          <p className="text-slate-600 text-xs">
            Add buyer and provider wallet addresses to <code className="bg-slate-800 px-1 rounded font-mono">.env</code>
            {" "}and run the database seed migration.
          </p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total agents",    value: String(agents.length) },
              { label: "Buyers",          value: String(agents.filter(a => a.role === "buyer").length) },
              { label: "Providers",       value: String(agents.filter(a => a.role === "provider").length) },
            ].map(s => (
              <div key={s.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-center">
                <p className="text-xl font-bold text-white tabular-nums">{s.value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Cards */}
          <div className="grid sm:grid-cols-2 gap-4">
            {agents.map((a) => <AgentCard key={a.id} agent={a} />)}
          </div>
        </>
      )}
    </div>
  );
}
