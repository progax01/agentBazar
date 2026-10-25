import { NextRequest, NextResponse } from "next/server";
import { getTaskEvents } from "@/lib/db/tasks";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const events = await getTaskEvents(id);
    return NextResponse.json({ events });
  } catch (err) {
    console.error("[GET /api/tasks/:id/events]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
