import { Pool } from "pg";

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    _pool = new Pool({ connectionString: url, max: 10 });
  }
  return _pool;
}
