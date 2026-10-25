import { NextRequest, NextResponse } from "next/server";
import { getTaskById } from "@/lib/db/tasks";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const task = await getTaskById(id);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(task);
  } catch (err) {
    console.error("[GET /api/tasks/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
