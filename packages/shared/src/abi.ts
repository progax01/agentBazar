import { parseAbi } from "viem";

export const escrowAbi = parseAbi([
  "function createTask(address provider, uint256 amount, uint64 deadline, bytes32 specificationHash) returns (uint256 taskId)",
  "function submitResult(uint256 taskId, bytes32 resultHash)",
  "function approveAndPay(uint256 taskId)",
  "function rejectAndRefund(uint256 taskId)",
  "function refundExpired(uint256 taskId)",
  "function tasks(uint256 taskId) view returns (address payer, address provider, uint256 amount, uint64 deadline, uint64 reviewDeadline, uint8 status, bytes32 specificationHash, bytes32 resultHash)",
  "function nextTaskId() view returns (uint256)",
  "function usdc() view returns (address)",
  "function reviewPeriod() view returns (uint64)",
  "event TaskCreated(uint256 indexed taskId, address indexed payer, address indexed provider, uint256 amount, uint64 deadline, bytes32 specificationHash)",
  "event ResultSubmitted(uint256 indexed taskId, bytes32 resultHash, uint64 reviewDeadline)",
  "event TaskPaid(uint256 indexed taskId, address indexed payer, address indexed provider, uint256 amount)",
  "event TaskRefunded(uint256 indexed taskId, address indexed payer, uint256 amount, uint8 reason)",
]);

export const usdcAbi = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);
