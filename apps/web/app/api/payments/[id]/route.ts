import { NextRequest, NextResponse } from "next/server";
import { getPaymentById } from "@/lib/payment/router";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const payment = await getPaymentById(id);
    if (!payment)
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    return NextResponse.json(payment);
  } catch (err) {
    console.error("[GET /api/payments/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
