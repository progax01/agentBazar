import { NextResponse } from "next/server";
import { listAgents } from "@/lib/db/agents";

export async function GET() {
  try {
    const agents = await listAgents();
    return NextResponse.json({ agents });
  } catch (err) {
    console.error("[GET /api/agents]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
