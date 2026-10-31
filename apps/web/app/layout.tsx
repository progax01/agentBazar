import type { Metadata } from "next";
import "./globals.css";
import { NavBar } from "@/components/NavBar";
import { ArcNetworkProvider } from "@/components/ArcNetworkProvider";

export const metadata: Metadata = {
  title: "AgentBazar – Autonomous Agent Marketplace",
  description:
    "Commission AI agent services, pay via x402 or escrow on Arc Testnet, and settle automatically with USDC.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <ArcNetworkProvider>
          <NavBar />
          <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
            {children}
          </main>
        </ArcNetworkProvider>
      </body>
    </html>
  );
}
