import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_NETWORKS, type ArcNetworkName } from "@agetbazar/shared";

// Build the RPC URL via the Arc Studio RPC proxy when available, falling back
// to the Arc Testnet public endpoint otherwise.
function getRpcUrl(network: ArcNetworkName): string {
  if (network === "testnet") {
    const proxyChains = (process.env.RPC_PROXY_CHAINS ?? "").split(",");
    if (process.env.RPC_PROXY_BASE_URL && proxyChains.includes("Arc_Testnet")) {
      return `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc_Testnet?_rpc_token=${process.env.RPC_PROXY_TOKEN}`;
    }
    return process.env.ARC_TESTNET_RPC_URL ?? process.env.ARC_RPC_URL ?? ARC_NETWORKS.testnet.rpcUrl;
  }
  return process.env.ARC_MAINNET_RPC_URL ?? ARC_NETWORKS.mainnet.rpcUrl;
}

export function getUsdcAddress(network: ArcNetworkName): `0x${string}` {
  const address = network === "mainnet"
    ? process.env.ARC_MAINNET_USDC_ADDRESS
    : process.env.ARC_TESTNET_USDC_ADDRESS ?? process.env.ARC_USDC_ADDRESS;
  return (address as `0x${string}` | undefined) ?? ARC_NETWORKS[network].usdcAddress;
}

export const ARC_USDC_ADDRESS = getUsdcAddress("testnet");

// Lazy getter — always reads the current env value, never captured at module load.
export function getEscrowAddress(network: ArcNetworkName = "testnet"): `0x${string}` | undefined {
  const v = network === "mainnet"
    ? process.env.AGETBAZAR_MAINNET_ESCROW_ADDRESS
    : process.env.AGETBAZAR_TESTNET_ESCROW_ADDRESS ?? process.env.AGETBAZAR_ESCROW_ADDRESS;
  return v ? (v as `0x${string}`) : undefined;
}

/** @deprecated use getEscrowAddress() */
export const ESCROW_ADDRESS = getEscrowAddress("testnet");

export const EXPLORER_URL = ARC_NETWORKS.testnet.explorerUrl;

export function getArcChain(network: ArcNetworkName = "testnet") {
  const config = ARC_NETWORKS[network];
  return defineChain({
    id: config.chainId,
    name: config.label,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [getRpcUrl(network)] } },
    blockExplorers: { default: { name: config.label, url: config.explorerUrl } },
    ...(config.testnet ? { testnet: true } : {}),
  });
}

export const arcTestnet = getArcChain("testnet");

export function createPublic(network: ArcNetworkName = "testnet") {
  return createPublicClient({
    chain: getArcChain(network),
    transport: http(getRpcUrl(network)),
  });
}

/** Normalise a private key to 0x-prefixed hex (viem requires this). */
function normalizeKey(raw: string): `0x${string}` {
  return raw.startsWith("0x") ? (raw as `0x${string}`) : `0x${raw}`;
}

export function createBuyerWallet(network: ArcNetworkName = "testnet") {
  const key = process.env.BUYER_AGENT_PRIVATE_KEY;
  if (!key) throw new Error("BUYER_AGENT_PRIVATE_KEY not set");
  return createWalletClient({
    account: privateKeyToAccount(normalizeKey(key)),
    chain: getArcChain(network),
    transport: http(getRpcUrl(network)),
  });
}

export function createProviderWallet(network: ArcNetworkName = "testnet") {
  const key = process.env.PROVIDER_AGENT_PRIVATE_KEY;
  if (!key) throw new Error("PROVIDER_AGENT_PRIVATE_KEY not set");
  return createWalletClient({
    account: privateKeyToAccount(normalizeKey(key)),
    chain: getArcChain(network),
    transport: http(getRpcUrl(network)),
  });
}
