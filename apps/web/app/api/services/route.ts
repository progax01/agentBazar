import { NextResponse } from "next/server";
import { listServices } from "@/lib/payment/router";

export async function GET() {
  try {
    const services = await listServices();
    return NextResponse.json({ services });
  } catch (err) {
    console.error("[GET /api/services]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
