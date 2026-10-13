// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OwnerlessMineTestBase} from "./utils/OwnerlessMineTestBase.sol";
import {Intake} from "./external/Intake.sol";
import {HmmMine} from "src/HmmMine.sol";
import {SwarmOracleAdapter} from "src/SwarmOracleAdapter.sol";
import {IIntake} from "src/interfaces/IIntake.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract OwnerlessFailurePathsTest is OwnerlessMineTestBase {
    function test_proposalWithoutAllowanceLeavesNoQuestionOrPayment() public {
        vm.prank(alice);
        imd.approve(address(mine), 0);
        HmmMine.Spec memory spec = _spec("allowance required");
        vm.prank(alice, alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(mine), 0, PRICE)
        );
        mine.propose(spec, PRICE);
        assertEq(mine.questionCount(), 0);
        assertEq(mine.openRaised(), 0);
        assertEq(imd.balanceOf(alice), 1_000 ether);
        assertEq(imd.balanceOf(address(mine)), 0);
        assertEq(imd.balanceOf(payTo), 0);
        assertEq(intake.nonce(), 0);
    }

    function test_failedCompleterCannotChangeBodyOrConsumeTheirAllowance() public {
        HmmMine.Spec memory spec = _spec("committed body");
        vm.prank(alice, alice);
        uint256 id = mine.propose(spec, 0.3 ether);
        vm.prank(bob);
        imd.approve(address(mine), 0.2 ether);
        bytes32 original = keccak256(abi.encode(mine.question(id)));
        vm.prank(bob, bob);
        vm.expectRevert(HmmMine.BodyMismatch.selector);
        mine.back(id, 0.2 ether, bytes("different body"));
        assertEq(keccak256(abi.encode(mine.question(id))), original);
        assertEq(mine.backing(id, bob), 0);
        assertEq(imd.allowance(bob, address(mine)), 0.2 ether);
        assertEq(imd.balanceOf(bob), 1_000 ether);
        assertEq(imd.balanceOf(address(mine)), 0.3 ether);
        assertEq(mine.openRaised(), 0.3 ether);
        assertEq(intake.nonce(), 0);
        bytes memory body = mine.bodyOf(spec);
        vm.prank(bob, bob);
        mine.back(id, 0.2 ether, body);
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Asked));
        assertEq(imd.allowance(bob, address(mine)), 0);
    }

    function test_intakeRevertRollsBackPriceAdjustmentApprovalAndCompleterPayment() public {
        HmmMine.Spec memory spec = _spec("temporary intake failure");
        vm.prank(alice, alice);
        uint256 id = mine.propose(spec, 0.3 ether);
        bytes memory body = mine.bodyOf(spec);
        vm.prank(owner);
        intake.setPrice(ACTION, address(imd), 0.1 ether);
        bytes memory reason = abi.encodeWithSignature("Error(string)", "intake unavailable");
        vm.mockCallRevert(address(intake), abi.encodeWithSelector(IIntake.requestWithFailure.selector), reason);
        bytes32 original = keccak256(abi.encode(mine.question(id)));
        vm.prank(bob, bob);
        vm.expectRevert(reason);
        mine.back(id, 0.2 ether, body);
        assertEq(keccak256(abi.encode(mine.question(id))), original);
        assertEq(imd.balanceOf(bob), 1_000 ether);
        assertEq(imd.balanceOf(address(mine)), 0.3 ether);
        assertEq(mine.openRaised(), 0.3 ether);
        assertEq(mine.refundableSurplus(), 0);
        assertEq(mine.answerDeadline(id), 0);
        assertEq(imd.allowance(address(mine), address(intake)), 0);
        assertEq(intake.nonce(), 0);
        vm.clearMockedCalls();
        vm.prank(bob, bob);
        mine.back(id, 0.2 ether, body);
        assertEq(mine.refundableSurplus(), 0.4 ether);
        assertEq(imd.balanceOf(payTo), 0.1 ether);
        assertEq(mine.question(id).target, 0.1 ether);
    }

    function test_actionDelistedWhileFundingCannotTakeTheFinalBackersMoney() public {
        vm.prank(alice, alice);
        uint256 id = mine.propose(_spec("delisted"), 0.3 ether);
        bytes memory body = _body("delisted");
        vm.prank(owner);
        intake.setPrice(ACTION, address(imd), 0);
        vm.prank(bob, bob);
        vm.expectRevert(HmmMine.NotSold.selector);
        mine.back(id, 0.2 ether, body);
        assertEq(mine.backing(id, bob), 0);
        assertEq(imd.balanceOf(bob), 1_000 ether);
        vm.warp(mine.question(id).deadline + 1);
        vm.prank(alice);
        mine.refund(id);
        assertEq(imd.balanceOf(alice), 1_000 ether);
        assertEq(imd.balanceOf(address(mine)), 0);
    }

    function test_foreignFailureCannotCloseOrDebitAnHonestRequest() public {
        (uint256 id, bytes32 honest) = _ask(alice, "honest question");
        vm.prank(bob);
        imd.approve(address(intake), PRICE);
        vm.prank(bob);
        bytes32 foreign = intake.requestWithFailure(
            ACTION,
            bytes("invalid JSON"),
            Intake.Callback(address(adapter), adapter.onOracleResult.selector),
            adapter.onOracleFailure.selector,
            address(imd),
            PRICE
        );
        assertFalse(_failure(foreign, 1, "body_invalid"), "unknown foreign request fails inside the callback");
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Asked));
        assertEq(mine.assigned(), 0);
        bytes memory substituted =
            abi.encode(honest, uint8(1), bytes32("body_invalid"), uint16(0), uint16(0), bytes(""));
        // A second foreign completion cannot substitute the honest id even with the real failure selector.
        vm.prank(bob);
        imd.approve(address(intake), PRICE);
        vm.prank(bob);
        bytes32 second = intake.requestWithFailure(
            ACTION,
            bytes("invalid JSON"),
            Intake.Callback(address(adapter), adapter.onOracleResult.selector),
            adapter.onOracleFailure.selector,
            address(imd),
            PRICE
        );
        vm.prank(writer);
        vm.expectRevert(abi.encodeWithSelector(Intake.FailureArgsMismatch.selector, second, uint8(1)));
        intake.complete(second, 1, bytes32(0), "", substituted);
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Asked));
        assertTrue(_answer(honest));
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Answered));
    }

    function test_attestationAtExpiryIsAcceptedButOneSecondLaterIsRejected() public {
        (uint256 first, bytes32 firstId) = _ask(alice, "expiry inclusive");
        SwarmOracleAdapter.Attestation memory a = _attestation();
        a.expiresAt = uint64(vm.getBlockTimestamp() + 60);
        bytes memory signature = _sign(a, address(adapter), oraclePk);
        vm.warp(a.expiresAt);
        assertTrue(_answerWith(firstId, a, signature));
        assertEq(uint8(_status(first)), uint8(HmmMine.Status.Answered));
        (uint256 second, bytes32 secondId) = _ask(bob, "expiry passed");
        a = _attestation();
        a.issuedAt = uint64(vm.getBlockTimestamp());
        a.expiresAt = a.issuedAt;
        signature = _sign(a, address(adapter), oraclePk);
        uint256 assigned = mine.assigned();
        vm.warp(uint256(a.expiresAt) + 1);
        assertTrue(_answerWith(secondId, a, signature), "rejection itself must fit the callback stipend");
        assertEq(uint8(_status(second)), uint8(HmmMine.Status.Failed));
        assertFalse(adapter.used(a.requestId));
        assertEq(mine.assigned(), assigned);
    }

    /// forge-config: default.fuzz.runs = 256
    function testFuzz_noncanonicalSignaturesAreRecordedAsFailure(uint8 variant) public {
        (uint256 id, bytes32 rid) = _ask(alice, "signature failure");
        SwarmOracleAdapter.Attestation memory a = _attestation();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, adapter.digest(a, block.chainid, address(adapter)));
        bytes memory bad;
        variant %= 7;
        if (variant == 0) {
            bad = "";
        } else if (variant == 1) {
            bad = hex"01";
        } else if (variant == 2) {
            bad = abi.encodePacked(r, s); // no recovery byte
        } else if (variant == 3) {
            bad = abi.encodePacked(r, s, uint8(0));
        } else if (variant == 4) {
            bad = abi.encodePacked(r, s, uint8(29));
        } else if (variant == 5) {
            bad = abi.encodePacked(r, s, v, uint8(0));
        } else {
            uint256 order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
            bad = abi.encodePacked(r, bytes32(order - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        }
        vm.expectEmit(true, true, false, true, address(adapter));
        emit SwarmOracleAdapter.Rejected(rid, a.requestId, "bad_signature");
        assertTrue(_answerWith(rid, a, bad));
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Failed));
        assertFalse(adapter.used(a.requestId));
        assertEq(mine.assigned(), 0);
        assertEq(mine.claimable(id, alice), 0);
        assertEq(imd.balanceOf(payTo), PRICE, "a rejected answer does not refund the spent fee");
    }

    function test_duplicateDeliveryDoesNotConsumeANewAnswerOrReopenASettledQuestion() public {
        (uint256 id, bytes32 rid) = _ask(alice, "once only");
        assertTrue(_answer(rid));
        uint256 assigned = mine.assigned();
        SwarmOracleAdapter.Attestation memory a = _attestation();
        bytes memory signature = _sign(a, address(adapter), oraclePk);
        vm.prank(address(intake));
        vm.expectRevert(HmmMine.NotAsked.selector);
        adapter.onOracleResult(rid, a, signature);
        assertFalse(adapter.used(a.requestId), "credit revert must roll back replay bookkeeping");
        vm.prank(address(intake));
        vm.expectRevert(HmmMine.NotAsked.selector);
        adapter.onOracleFailure(rid, 2, "disagreed", 2, 5, "");
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Answered));
        assertEq(mine.assigned(), assigned);
    }
}
