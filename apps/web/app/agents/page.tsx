import { listAgents } from "@/lib/db/agents";
import type { Agent } from "@agetbazar/shared";

async function AgentCard({ agent }: { agent: Agent }) {
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-white">{agent.name}</h2>
        <span
          className={
            agent.isActive
              ? "text-xs rounded-full bg-green-900 text-green-300 px-2 py-0.5"
              : "text-xs rounded-full bg-gray-700 text-gray-400 px-2 py-0.5"
          }
        >
          {agent.isActive ? "Active" : "Inactive"}
        </span>
      </div>
      <dl className="space-y-1.5 text-sm">
        <div className="flex gap-4">
          <dt className="w-28 text-gray-400">Role</dt>
          <dd className="text-gray-100 capitalize">{agent.role}</dd>
        </div>
        <div className="flex gap-4">
          <dt className="w-28 text-gray-400">Wallet</dt>
          <dd className="font-mono text-xs text-gray-300 break-all">
            {agent.walletAddress}
          </dd>
        </div>
        <div className="flex gap-4">
          <dt className="w-28 text-gray-400">Capabilities</dt>
          <dd className="text-gray-100">
            {agent.capabilities.length > 0
              ? agent.capabilities.join(", ")
              : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export default async function AgentsPage() {
  let agents: Agent[] = [];
  try {
    agents = await listAgents();
  } catch {
    // DB not yet connected
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white">Agents</h1>

      {agents.length === 0 ? (
        <div className="rounded-xl bg-gray-900 border border-gray-800 p-8 text-center text-gray-400">
          No agents configured yet. Add buyer and provider wallet addresses to
          your .env and run the database seed.
        </div>
      ) : (
        <div className="space-y-4">
          {agents.map((a) => (
            <AgentCard key={a.id} agent={a} />
          ))}
        </div>
      )}
    </div>
  );
}
