import { NextRequest, NextResponse } from "next/server";
import { listPayments } from "@/lib/payment/router";

export async function GET(req: NextRequest) {
  const url    = new URL(req.url);
  const limit  = Math.min(parseInt(url.searchParams.get("limit")  ?? "25"), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0"),  0);
  try {
    const result = await listPayments(limit, offset);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[GET /api/payments]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
