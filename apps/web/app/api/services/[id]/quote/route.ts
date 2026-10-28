import { NextRequest, NextResponse } from "next/server";
import { getServiceById } from "@/lib/payment/router";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const service = await getServiceById(id);
    if (!service) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }
    return NextResponse.json({
      serviceId:      service.id,
      name:           service.name,
      endpointUrl:    service.endpointUrl,
      endpointMethod: service.endpointMethod,
      paymentMode:    service.paymentMode,
      network:        service.network,
      assetAddress:   service.assetAddress,
      priceUsdc:      service.priceUsdc,
      priceRaw:       service.priceRaw,
      payToAddress:   service.payToAddress,
      facilitatorUrl: service.facilitatorUrl,
      capabilities:   service.capabilities,
    });
  } catch (err) {
    console.error("[GET /api/services/:id/quote]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
