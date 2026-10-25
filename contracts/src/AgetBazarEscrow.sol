// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgetBazarEscrow
/// @notice Holds USDC in escrow for agent-to-agent task settlement on Arc Testnet.
///         The buyer funds a task, the provider submits a result hash, and the
///         buyer approves payment or rejects for a refund. Either party (or anyone)
///         can trigger a refund once a deadline has passed.
contract AgetBazarEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    enum Status {
        None,      // 0 – task does not exist
        Funded,    // 1 – escrow is funded; provider can work
        Submitted, // 2 – result submitted; waiting for evaluation
        Paid,      // 3 – USDC released to provider (terminal)
        Refunded   // 4 – USDC returned to payer (terminal)
    }

    enum RefundReason {
        Rejected,     // 0 – payer explicitly rejected the submission
        TaskExpired,  // 1 – provider did not submit before task deadline
        ReviewExpired // 2 – payer did not review before review deadline
    }

    struct Task {
        address payer;
        address provider;
        uint256 amount;
        uint64  deadline;
        uint64  reviewDeadline;
        Status  status;
        bytes32 specificationHash;
        bytes32 resultHash;
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    IERC20 public immutable usdc;
    uint64 public immutable reviewPeriod;
    uint256 public nextTaskId = 1;

    mapping(uint256 => Task) public tasks;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event TaskCreated(
        uint256 indexed taskId,
        address indexed payer,
        address indexed provider,
        uint256 amount,
        uint64  deadline,
        bytes32 specificationHash
    );

    event ResultSubmitted(
        uint256 indexed taskId,
        bytes32 resultHash,
        uint64  reviewDeadline
    );

    event TaskPaid(
        uint256 indexed taskId,
        address indexed payer,
        address indexed provider,
        uint256 amount
    );

    event TaskRefunded(
        uint256 indexed taskId,
        address indexed payer,
        uint256 amount,
        RefundReason reason
    );

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param _usdc         Arc Testnet USDC ERC-20 address.
    /// @param _reviewPeriod Time in seconds the payer has to review a submission.
    constructor(address _usdc, uint64 _reviewPeriod) {
        require(_usdc != address(0), "AgetBazar: zero USDC address");
        require(_reviewPeriod > 0, "AgetBazar: zero review period");
        usdc = IERC20(_usdc);
        reviewPeriod = _reviewPeriod;
    }

    // -------------------------------------------------------------------------
    // External functions
    // -------------------------------------------------------------------------

    /// @notice Create a funded task. Caller must have approved this contract for
    ///         exactly `amount` USDC beforehand.
    /// @param provider        Provider agent's wallet address.
    /// @param amount          USDC raw units (6 decimals). Must be > 0.
    /// @param deadline        Unix timestamp (seconds). Must be in the future.
    /// @param specificationHash Keccak-256 of canonical task JSON. Must be non-zero.
    /// @return taskId         Allocated on-chain task ID.
    function createTask(
        address provider,
        uint256 amount,
        uint64  deadline,
        bytes32 specificationHash
    ) external nonReentrant returns (uint256 taskId) {
        require(provider != address(0),    "AgetBazar: zero provider");
        require(provider != msg.sender,    "AgetBazar: provider is payer");
        require(amount > 0,                "AgetBazar: zero amount");
        require(specificationHash != 0,    "AgetBazar: zero spec hash");
        require(deadline > block.timestamp,"AgetBazar: deadline in past");

        taskId = nextTaskId++;
        tasks[taskId] = Task({
            payer:             msg.sender,
            provider:          provider,
            amount:            amount,
            deadline:          deadline,
            reviewDeadline:    0,
            status:            Status.Funded,
            specificationHash: specificationHash,
            resultHash:        bytes32(0)
        });

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit TaskCreated(taskId, msg.sender, provider, amount, deadline, specificationHash);
    }

    /// @notice Provider submits the result hash. Transitions task to Submitted.
    /// @param taskId     On-chain task ID.
    /// @param resultHash Keccak-256 of canonical result JSON. Must be non-zero.
    function submitResult(uint256 taskId, bytes32 resultHash) external {
        Task storage t = tasks[taskId];
        require(t.status == Status.Funded,       "AgetBazar: not funded");
        require(msg.sender == t.provider,         "AgetBazar: not provider");
        require(block.timestamp <= t.deadline,    "AgetBazar: past deadline");
        require(resultHash != bytes32(0),          "AgetBazar: zero result hash");

        t.resultHash    = resultHash;
        t.status        = Status.Submitted;
        t.reviewDeadline = uint64(block.timestamp) + reviewPeriod;

        emit ResultSubmitted(taskId, resultHash, t.reviewDeadline);
    }

    /// @notice Payer approves the result and releases USDC to the provider.
    /// @param taskId On-chain task ID.
    function approveAndPay(uint256 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        require(msg.sender == t.payer,               "AgetBazar: not payer");
        require(t.status == Status.Submitted,         "AgetBazar: not submitted");
        require(block.timestamp <= t.reviewDeadline, "AgetBazar: review expired");

        address provider = t.provider;
        uint256 amount   = t.amount;

        t.status = Status.Paid;

        usdc.safeTransfer(provider, amount);

        emit TaskPaid(taskId, t.payer, provider, amount);
    }

    /// @notice Payer rejects the result and gets a refund.
    /// @param taskId On-chain task ID.
    function rejectAndRefund(uint256 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        require(msg.sender == t.payer,       "AgetBazar: not payer");
        require(t.status == Status.Submitted, "AgetBazar: not submitted");

        address payer  = t.payer;
        uint256 amount = t.amount;

        t.status = Status.Refunded;

        usdc.safeTransfer(payer, amount);

        emit TaskRefunded(taskId, payer, amount, RefundReason.Rejected);
    }

    /// @notice Anyone can trigger a refund once the relevant deadline has passed.
    ///         Works for both Funded (task deadline) and Submitted (review deadline).
    /// @param taskId On-chain task ID.
    function refundExpired(uint256 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        RefundReason reason;

        if (t.status == Status.Funded) {
            require(block.timestamp > t.deadline,       "AgetBazar: task not expired");
            reason = RefundReason.TaskExpired;
        } else if (t.status == Status.Submitted) {
            require(block.timestamp > t.reviewDeadline, "AgetBazar: review not expired");
            reason = RefundReason.ReviewExpired;
        } else {
            revert("AgetBazar: invalid status for refund");
        }

        address payer  = t.payer;
        uint256 amount = t.amount;

        t.status = Status.Refunded;

        usdc.safeTransfer(payer, amount);

        emit TaskRefunded(taskId, payer, amount, reason);
    }
}
