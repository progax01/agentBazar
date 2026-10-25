/**
 * Buyer-agent funding logic — runs only on the server.
 * Approves exact USDC amount, calls createTask(), waits for receipts,
 * and parses TaskCreated to get the authoritative on-chain task ID.
 */
import { parseUnits, decodeEventLog, type Log } from "viem";
import { createPublic, createBuyerWallet, ARC_USDC_ADDRESS, getEscrowAddress } from "./chain/client";
import { escrowAbi, usdcAbi } from "@agetbazar/shared";

export interface FundResult {
  onchainTaskId: bigint;
  approveTxHash: string;
  createTxHash:  string;
}

export async function fundTask(
  providerAddress: `0x${string}`,
  budgetUsdc:      string,
  deadlineSeconds: number,
  specificationHash: `0x${string}`,
): Promise<FundResult> {
  const escrowAddress = getEscrowAddress();
  if (!escrowAddress) throw new Error("AGETBAZAR_ESCROW_ADDRESS not configured");

  const publicClient = createPublic();
  const walletClient = createBuyerWallet();

  const amountRaw = parseUnits(budgetUsdc, 6);
  const deadline  = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

  // Step 1: approve exact amount.
  // Do NOT pass `account` or `chain` overrides — the wallet client already has
  // the local signer; overriding with just an address string degrades viem to
  // eth_sendTransaction (unsupported on Arc public RPC) instead of signing locally.
  const approveHash = await walletClient.writeContract({
    address:      ARC_USDC_ADDRESS,
    abi:          usdcAbi,
    functionName: "approve",
    args:         [escrowAddress, amountRaw],
  });

  const approveReceipt = await publicClient.waitForTransactionReceipt({
    hash: approveHash,
  });
  if (approveReceipt.status !== "success") {
    throw new Error(`USDC approval failed: ${approveHash}`);
  }

  // Step 2: createTask
  const createHash = await walletClient.writeContract({
    address:      escrowAddress,
    abi:          escrowAbi,
    functionName: "createTask",
    args:         [providerAddress, amountRaw, deadline, specificationHash],
  });

  const createReceipt = await publicClient.waitForTransactionReceipt({
    hash: createHash,
  });
  if (createReceipt.status !== "success") {
    throw new Error(`createTask failed: ${createHash}`);
  }

  // Parse TaskCreated event to get authoritative task ID
  let onchainTaskId: bigint | undefined;
  for (const log of createReceipt.logs as Log[]) {
    try {
      const decoded = decodeEventLog({
        abi:       escrowAbi,
        data:      log.data,
        topics:    log.topics,
        eventName: "TaskCreated",
      });
      onchainTaskId = decoded.args.taskId as bigint;
      break;
    } catch {
      // Not a TaskCreated log — continue
    }
  }

  if (onchainTaskId === undefined) {
    throw new Error("TaskCreated event not found in receipt logs");
  }

  return {
    onchainTaskId,
    approveTxHash: approveHash,
    createTxHash:  createHash,
  };
}
