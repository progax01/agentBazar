"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ArcNetworkName } from "@agetbazar/shared";

const STORAGE_KEY = "agentbazar.arc-network";

interface ArcNetworkContextValue {
  network: ArcNetworkName;
  setNetwork: (network: ArcNetworkName) => void;
}

const ArcNetworkContext = createContext<ArcNetworkContextValue | null>(null);

export function ArcNetworkProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetworkState] = useState<ArcNetworkName>("testnet");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "mainnet" || saved === "testnet") setNetworkState(saved);
  }, []);

  const value = useMemo<ArcNetworkContextValue>(() => ({
    network,
    setNetwork(next) {
      setNetworkState(next);
      window.localStorage.setItem(STORAGE_KEY, next);
    },
  }), [network]);

  return <ArcNetworkContext.Provider value={value}>{children}</ArcNetworkContext.Provider>;
}

export function useArcNetwork(): ArcNetworkContextValue {
  const context = useContext(ArcNetworkContext);
  if (!context) throw new Error("useArcNetwork must be used within ArcNetworkProvider");
  return context;
}