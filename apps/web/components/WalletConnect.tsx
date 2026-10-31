"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, Network, Wallet } from "lucide-react";
import { ARC_NETWORKS } from "@agetbazar/shared";
import { useArcNetwork } from "@/components/ArcNetworkProvider";

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && error.code === 4001) {
    return "Wallet request was rejected.";
  }
  return error instanceof Error ? error.message : "Wallet request failed.";
}

export function WalletConnect() {
  const { network } = useArcNetwork();
  const selectedNetwork = ARC_NETWORKS[network];
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshWallet = useCallback(async (provider: EthereumProvider) => {
    const [accountsResult, chainResult] = await Promise.all([
      provider.request({ method: "eth_accounts" }),
      provider.request({ method: "eth_chainId" }),
    ]);
    const accounts = Array.isArray(accountsResult) ? accountsResult : [];
    setAddress(isAddress(accounts[0]) ? accounts[0] : null);
    setChainId(typeof chainResult === "string" ? Number.parseInt(chainResult, 16) : null);
  }, []);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;

    let active = true;
    const sync = async () => {
      try {
        const [accountsResult, chainResult] = await Promise.all([
          provider.request({ method: "eth_accounts" }),
          provider.request({ method: "eth_chainId" }),
        ]);
        if (!active) return;
        const accounts = Array.isArray(accountsResult) ? accountsResult : [];
        setAddress(isAddress(accounts[0]) ? accounts[0] : null);
        setChainId(typeof chainResult === "string" ? Number.parseInt(chainResult, 16) : null);
      } catch {
        if (active) {
          setAddress(null);
          setChainId(null);
        }
      }
    };
    const onAccountsChanged = (accounts: unknown) => {
      const currentAccounts = Array.isArray(accounts) ? accounts : [];
      setAddress(isAddress(currentAccounts[0]) ? currentAccounts[0] : null);
    };
    const onChainChanged = (chain: unknown) => {
      setChainId(typeof chain === "string" ? Number.parseInt(chain, 16) : null);
    };

    void sync();
    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);

    return () => {
      active = false;
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  async function connect() {
    const provider = window.ethereum;
    if (!provider) {
      setError("Install a compatible browser wallet to connect.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const accountsResult = await provider.request({ method: "eth_requestAccounts" });
      const accounts = Array.isArray(accountsResult) ? accountsResult : [];
      setAddress(isAddress(accounts[0]) ? accounts[0] : null);
      const chainResult = await provider.request({ method: "eth_chainId" });
      setChainId(typeof chainResult === "string" ? Number.parseInt(chainResult, 16) : null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function switchToSelectedArcNetwork() {
    const provider = window.ethereum;
    if (!provider) return;

    setBusy(true);
    setError(null);
    try {
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${selectedNetwork.chainId.toString(16)}` }],
        });
      } catch (err) {
        if (!err || typeof err !== "object" || !("code" in err) || err.code !== 4902) throw err;
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: `0x${selectedNetwork.chainId.toString(16)}`,
            chainName: selectedNetwork.label,
            nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
            rpcUrls: [selectedNetwork.rpcUrl],
            blockExplorerUrls: [selectedNetwork.explorerUrl],
          }],
        });
      }
      await refreshWallet(provider);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const onSelectedNetwork = chainId === selectedNetwork.chainId;
  const shortAddress = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null;

  return (
    <div className="flex min-w-0 items-center gap-2">
      {address && !onSelectedNetwork && (
        <button
          onClick={switchToSelectedArcNetwork}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-700/60 px-2.5 py-2 text-xs font-medium text-amber-200 hover:bg-amber-950/40 disabled:opacity-50"
        >
          <Network className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Switch to {network === "mainnet" ? "Mainnet" : "Testnet"}</span>
          <span className="sm:hidden">Switch</span>
        </button>
      )}

      <button
        onClick={connect}
        disabled={busy}
        title={address ? `Connected wallet ${address}. Platform transactions are signed by the backend.` : "Connect MetaMask or another EIP-1193 wallet"}
        className={`inline-flex max-w-[11rem] items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
          address
            ? "border-emerald-700/60 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-950/60"
            : "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
        }`}
      >
        {address ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Wallet className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{busy ? "Connecting…" : shortAddress ?? "Connect wallet"}</span>
      </button>

      {error && (
        <span role="alert" className="inline-flex max-w-48 items-center gap-1 text-[10px] text-red-300" title={error}>
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span className="truncate">{error}</span>
        </span>
      )}
    </div>
  );
}