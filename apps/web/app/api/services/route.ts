import { NextResponse } from "next/server";
import { listServices } from "@/lib/payment/router";
import { ARC_NETWORKS, parseArcNetwork } from "@agetbazar/shared";

export async function GET(req: Request) {
  const requestedNetwork = new URL(req.url).searchParams.get("network") ?? "testnet";
  const network = parseArcNetwork(requestedNetwork);
  if (!network) return NextResponse.json({ error: "Unsupported Arc network" }, { status: 400 });

  try {
    const services = await listServices(ARC_NETWORKS[network].caip2);
    return NextResponse.json({ services });
  } catch (err) {
    console.error("[GET /api/services]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
