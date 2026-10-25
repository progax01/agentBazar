import { NextResponse } from "next/server";
import { getPool } from "@/lib/db/pool";
import { createPublic } from "@/lib/chain/client";

export async function GET() {
  let db = false;
  let rpc = false;
  let chainId: number | null = null;

  try {
    await getPool().query("SELECT 1");
    db = true;
  } catch {
    // db unreachable
  }

  try {
    const client = createPublic();
    chainId = Number(await client.getChainId());
    rpc = chainId === 5_042_002;
  } catch {
    // rpc unreachable
  }

  const status = db && rpc ? "ok" : "degraded";
  return NextResponse.json({ status, db, rpc, chainId }, {
    status: status === "ok" ? 200 : 503,
  });
}
