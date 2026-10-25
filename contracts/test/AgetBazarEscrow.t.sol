// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgetBazarEscrow.sol";

/// @dev Minimal ERC-20 mock for testing.
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract AgetBazarEscrowTest is Test {
    AgetBazarEscrow escrow;
    MockUSDC        usdc;

    address buyer    = address(0x1001);
    address provider = address(0x1002);
    address stranger = address(0x1003);

    uint256 constant AMOUNT       = 250_000; // 0.25 USDC (6 decimals)
    uint64  constant REVIEW_PERIOD = 3600;   // 1 hour

    bytes32 constant SPEC_HASH   = keccak256("spec");
    bytes32 constant RESULT_HASH = keccak256("result");

    function setUp() public {
        usdc   = new MockUSDC();
        escrow = new AgetBazarEscrow(address(usdc), REVIEW_PERIOD);

        usdc.mint(buyer, 1_000_000);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // -------------------------------------------------------------------------
    // createTask
    // -------------------------------------------------------------------------

    function _fundedTask() internal returns (uint256 taskId) {
        uint64 deadline = uint64(block.timestamp) + 3600;
        vm.prank(buyer);
        taskId = escrow.createTask(provider, AMOUNT, deadline, SPEC_HASH);
    }

    function test_createTask_success() public {
        uint256 taskId = _fundedTask();
        assertEq(taskId, 1);
        (address payer,,,,,AgetBazarEscrow.Status status,,) = escrow.tasks(1);
        assertEq(payer, buyer);
        assertEq(uint8(status), uint8(AgetBazarEscrow.Status.Funded));
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
    }

    function test_createTask_revert_zeroProvider() public {
        vm.prank(buyer);
        vm.expectRevert("AgetBazar: zero provider");
        escrow.createTask(address(0), AMOUNT, uint64(block.timestamp) + 3600, SPEC_HASH);
    }

    function test_createTask_revert_providerIsPayer() public {
        vm.prank(buyer);
        vm.expectRevert("AgetBazar: provider is payer");
        escrow.createTask(buyer, AMOUNT, uint64(block.timestamp) + 3600, SPEC_HASH);
    }

    function test_createTask_revert_zeroAmount() public {
        vm.prank(buyer);
        vm.expectRevert("AgetBazar: zero amount");
        escrow.createTask(provider, 0, uint64(block.timestamp) + 3600, SPEC_HASH);
    }

    function test_createTask_revert_zeroSpecHash() public {
        vm.prank(buyer);
        vm.expectRevert("AgetBazar: zero spec hash");
        escrow.createTask(provider, AMOUNT, uint64(block.timestamp) + 3600, bytes32(0));
    }

    function test_createTask_revert_deadlineInPast() public {
        vm.prank(buyer);
        vm.expectRevert("AgetBazar: deadline in past");
        escrow.createTask(provider, AMOUNT, uint64(block.timestamp), SPEC_HASH);
    }

    // -------------------------------------------------------------------------
    // submitResult
    // -------------------------------------------------------------------------

    function test_submitResult_success() public {
        uint256 taskId = _fundedTask();
        vm.prank(provider);
        escrow.submitResult(taskId, RESULT_HASH);
        (,,,, uint64 reviewDeadline, AgetBazarEscrow.Status status, , bytes32 rh) = escrow.tasks(taskId);
        assertEq(uint8(status), uint8(AgetBazarEscrow.Status.Submitted));
        assertEq(rh, RESULT_HASH);
        assertEq(reviewDeadline, uint64(block.timestamp) + REVIEW_PERIOD);
    }

    function test_submitResult_revert_notProvider() public {
        uint256 taskId = _fundedTask();
        vm.prank(stranger);
        vm.expectRevert("AgetBazar: not provider");
        escrow.submitResult(taskId, RESULT_HASH);
    }

    function test_submitResult_revert_pastDeadline() public {
        uint256 taskId = _fundedTask();
        vm.warp(block.timestamp + 7200);
        vm.prank(provider);
        vm.expectRevert("AgetBazar: past deadline");
        escrow.submitResult(taskId, RESULT_HASH);
    }

    function test_submitResult_revert_zeroResultHash() public {
        uint256 taskId = _fundedTask();
        vm.prank(provider);
        vm.expectRevert("AgetBazar: zero result hash");
        escrow.submitResult(taskId, bytes32(0));
    }

    // -------------------------------------------------------------------------
    // approveAndPay
    // -------------------------------------------------------------------------

    function _submittedTask() internal returns (uint256 taskId) {
        taskId = _fundedTask();
        vm.prank(provider);
        escrow.submitResult(taskId, RESULT_HASH);
    }

    function test_approveAndPay_success() public {
        uint256 taskId = _submittedTask();
        uint256 provBefore = usdc.balanceOf(provider);
        vm.prank(buyer);
        escrow.approveAndPay(taskId);
        assertEq(usdc.balanceOf(provider), provBefore + AMOUNT);
        (,,,,, AgetBazarEscrow.Status status,,) = escrow.tasks(taskId);
        assertEq(uint8(status), uint8(AgetBazarEscrow.Status.Paid));
    }

    function test_approveAndPay_revert_notPayer() public {
        uint256 taskId = _submittedTask();
        vm.prank(stranger);
        vm.expectRevert("AgetBazar: not payer");
        escrow.approveAndPay(taskId);
    }

    function test_approveAndPay_revert_reviewExpired() public {
        uint256 taskId = _submittedTask();
        vm.warp(block.timestamp + REVIEW_PERIOD + 1);
        vm.prank(buyer);
        vm.expectRevert("AgetBazar: review expired");
        escrow.approveAndPay(taskId);
    }

    function test_approveAndPay_revert_doublePay() public {
        uint256 taskId = _submittedTask();
        vm.prank(buyer);
        escrow.approveAndPay(taskId);
        vm.prank(buyer);
        vm.expectRevert("AgetBazar: not submitted");
        escrow.approveAndPay(taskId);
    }

    // -------------------------------------------------------------------------
    // rejectAndRefund
    // -------------------------------------------------------------------------

    function test_rejectAndRefund_success() public {
        uint256 taskId = _submittedTask();
        uint256 buyerBefore = usdc.balanceOf(buyer);
        vm.prank(buyer);
        escrow.rejectAndRefund(taskId);
        assertEq(usdc.balanceOf(buyer), buyerBefore + AMOUNT);
        (,,,,, AgetBazarEscrow.Status status,,) = escrow.tasks(taskId);
        assertEq(uint8(status), uint8(AgetBazarEscrow.Status.Refunded));
    }

    function test_rejectAndRefund_revert_notPayer() public {
        uint256 taskId = _submittedTask();
        vm.prank(stranger);
        vm.expectRevert("AgetBazar: not payer");
        escrow.rejectAndRefund(taskId);
    }

    // -------------------------------------------------------------------------
    // refundExpired
    // -------------------------------------------------------------------------

    function test_refundExpired_taskExpired() public {
        uint256 taskId = _fundedTask();
        vm.warp(block.timestamp + 7200);
        uint256 buyerBefore = usdc.balanceOf(buyer);
        escrow.refundExpired(taskId);
        assertEq(usdc.balanceOf(buyer), buyerBefore + AMOUNT);
        (,,,,, AgetBazarEscrow.Status status,,) = escrow.tasks(taskId);
        assertEq(uint8(status), uint8(AgetBazarEscrow.Status.Refunded));
    }

    function test_refundExpired_reviewExpired() public {
        uint256 taskId = _submittedTask();
        vm.warp(block.timestamp + REVIEW_PERIOD + 1);
        uint256 buyerBefore = usdc.balanceOf(buyer);
        escrow.refundExpired(taskId);
        assertEq(usdc.balanceOf(buyer), buyerBefore + AMOUNT);
    }

    function test_refundExpired_revert_notExpired() public {
        uint256 taskId = _fundedTask();
        vm.expectRevert("AgetBazar: task not expired");
        escrow.refundExpired(taskId);
    }

    function test_refundExpired_revert_invalidStatus() public {
        uint256 taskId = _submittedTask();
        vm.prank(buyer);
        escrow.approveAndPay(taskId);
        vm.expectRevert("AgetBazar: invalid status for refund");
        escrow.refundExpired(taskId);
    }

    // -------------------------------------------------------------------------
    // No double transfer / reentrancy path (state set before transfer)
    // -------------------------------------------------------------------------

    function test_doubleRefund_reverts() public {
        uint256 taskId = _submittedTask();
        vm.prank(buyer);
        escrow.rejectAndRefund(taskId);
        vm.prank(buyer);
        vm.expectRevert("AgetBazar: not submitted");
        escrow.rejectAndRefund(taskId);
    }
}
