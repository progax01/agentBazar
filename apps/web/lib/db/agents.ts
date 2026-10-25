import { getPool } from "./pool";
import type { Agent } from "@agetbazar/shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToAgent(row: Record<string, any>): Agent {
  return {
    id:            row.id,
    name:          row.name,
    role:          row.role,
    walletAddress: row.wallet_address,
    capabilities:  row.capabilities ?? [],
    isActive:      row.is_active,
    createdAt:     row.created_at,
  };
}

export async function listAgents(): Promise<Agent[]> {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM agents ORDER BY created_at ASC");
  return rows.map(rowToAgent);
}

export async function getAgentById(id: string): Promise<Agent | null> {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM agents WHERE id = $1", [id]);
  return rows[0] ? rowToAgent(rows[0]) : null;
}

export async function getActiveProviderAgents(): Promise<Agent[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM agents WHERE role = 'provider' AND is_active = true",
  );
  return rows.map(rowToAgent);
}
