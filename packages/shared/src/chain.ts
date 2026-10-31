export type ArcNetworkName = "testnet" | "mainnet";

export interface ArcNetworkConfig {
  name: ArcNetworkName;
  chainId: number;
  caip2: `eip155:${number}`;
  label: string;
  rpcUrl: string;
  explorerUrl: string;
  usdcAddress: `0x${string}`;
  testnet?: boolean;
}

const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;

export const ARC_NETWORKS: Record<ArcNetworkName, ArcNetworkConfig> = {
  testnet: {
    name: "testnet",
    chainId: 5_042_002,
    caip2: "eip155:5042002",
    label: "Arc Testnet",
    rpcUrl: "https://rpc.testnet.arc.io",
    explorerUrl: "https://explorer.testnet.arc.io",
    usdcAddress: ARC_USDC,
    testnet: true,
  },
  mainnet: {
    name: "mainnet",
    chainId: 5_042,
    caip2: "eip155:5042",
    label: "Arc Mainnet",
    rpcUrl: "https://rpc.mainnet.arc.io",
    explorerUrl: "https://explorer.arc.io",
    usdcAddress: ARC_USDC,
  },
};

export function getArcNetwork(name: ArcNetworkName): ArcNetworkConfig {
  return ARC_NETWORKS[name];
}

export function arcNetworkFromChainId(chainId: number | string): ArcNetworkName | null {
  const parsed = typeof chainId === "string" ? Number(chainId) : chainId;
  if (parsed === ARC_NETWORKS.testnet.chainId) return "testnet";
  if (parsed === ARC_NETWORKS.mainnet.chainId) return "mainnet";
  return null;
}

export function parseArcNetwork(value: unknown): ArcNetworkName | null {
  if (value === "testnet" || value === "mainnet") return value;
  if (value === ARC_NETWORKS.testnet.caip2 || value === ARC_NETWORKS.testnet.chainId) return "testnet";
  if (value === ARC_NETWORKS.mainnet.caip2 || value === ARC_NETWORKS.mainnet.chainId) return "mainnet";
  return null;
}