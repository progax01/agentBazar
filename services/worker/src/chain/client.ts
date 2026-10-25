import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Build the RPC URL via the Arc Studio RPC proxy when available, falling back
// to the Arc Testnet public endpoint otherwise.
const ARC_COMPASS_KEY = "Arc_Testnet";
const proxyChains = (process.env.RPC_PROXY_CHAINS ?? "").split(",");

function getRpcUrl(): string {
  if (
    process.env.RPC_PROXY_BASE_URL &&
    proxyChains.includes(ARC_COMPASS_KEY)
  ) {
    return (
      process.env.RPC_PROXY_BASE_URL +
      "/api/rpc/" +
      ARC_COMPASS_KEY +
      "?_rpc_token=" +
      process.env.RPC_PROXY_TOKEN
    );
  }
  // arc-studio-allow-onchain-literal — Arc Testnet public RPC, not a secret
  return process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
}

export const ARC_USDC_ADDRESS =
  // arc-studio-allow-onchain-literal — Arc Testnet USDC ERC-20, public constant
  (process.env.ARC_USDC_ADDRESS as `0x${string}`) ??
  "0x3600000000000000000000000000000000000000";

export const ESCROW_ADDRESS =
  process.env.AGETBAZAR_ESCROW_ADDRESS as `0x${string}` | undefined;

export const arcTestnet = defineChain({
  id: 5_042_002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [getRpcUrl()] } },
  blockExplorers: {
    default: {
      name: "Arc Testnet Explorer",
      url: "https://explorer.testnet.arc.io",
    },
  },
});

export function createPublic() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(getRpcUrl()),
  });
}

/** Normalise a private key to 0x-prefixed hex (viem requires this). */
function normalizeKey(raw: string): `0x${string}` {
  return raw.startsWith("0x") ? (raw as `0x${string}`) : `0x${raw}`;
}

export function createBuyerWallet() {
  const key = process.env.BUYER_AGENT_PRIVATE_KEY;
  if (!key) throw new Error("BUYER_AGENT_PRIVATE_KEY not set");
  return createWalletClient({
    account: privateKeyToAccount(normalizeKey(key)),
    chain: arcTestnet,
    transport: http(getRpcUrl()),
  });
}

export function createProviderWallet() {
  const key = process.env.PROVIDER_AGENT_PRIVATE_KEY;
  if (!key) throw new Error("PROVIDER_AGENT_PRIVATE_KEY not set");
  return createWalletClient({
    account: privateKeyToAccount(normalizeKey(key)),
    chain: arcTestnet,
    transport: http(getRpcUrl()),
  });
}
