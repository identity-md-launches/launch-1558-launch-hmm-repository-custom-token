// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {HmmTestBase} from "../utils/HmmTestBase.sol";
import {HmmMine} from "../../src/HmmMine.sol";

/// @notice Regression for 5ff239b68c55: only the live Intake price is spent; the rest belongs to backers.
contract PriceDropTest is HmmTestBase {
    function _drop() internal returns (uint256 id) {
        vm.prank(alice, alice);
        id = mine.propose(_spec("price drop"), 0.3 ether);
        vm.prank(owner);
        intake.setPrice(ACTION, address(imd), 0.25 ether);
        bytes memory body = _body("price drop");
        vm.expectEmit(true, false, false, true, address(mine));
        emit HmmMine.PriceAdjusted(id, PRICE, 0.25 ether);
        vm.prank(bob, bob);
        mine.back(id, 0.2 ether, body);
    }

    function test_priceDrop_matchesImportedProofAndRefundsEachBackerOnce() public {
        uint256 id = _drop();
        assertEq(imd.balanceOf(payTo), 0.25 ether);
        assertEq(imd.balanceOf(address(mine)), 0.25 ether);
        assertEq(mine.openRaised(), 0);
        assertEq(mine.refundableSurplus(), 0.25 ether);
        assertEq(imd.allowance(address(mine), address(intake)), 0);
        assertEq(mine.question(id).target, 0.25 ether);
        assertEq(mine.question(id).raised, PRICE);
        assertEq(mine.refundable(id, alice), 0.15 ether);
        assertEq(mine.refundable(id, bob), 0.1 ether);

        vm.prank(carol);
        vm.expectRevert(HmmMine.NothingToRefund.selector);
        mine.refund(id);
        vm.expectEmit(true, true, false, true, address(mine));
        emit HmmMine.SurplusRefunded(id, alice, 0.15 ether);
        vm.prank(alice);
        mine.refund(id);
        assertEq(mine.backing(id, alice), 0.3 ether, "reward rights survive a surplus refund");
        assertEq(imd.balanceOf(alice), 1_000 ether - 0.15 ether);
        vm.prank(alice);
        vm.expectRevert(HmmMine.NothingToRefund.selector);
        mine.refund(id);
        vm.prank(bob);
        mine.refund(id);
        assertEq(imd.balanceOf(bob), 1_000 ether - 0.1 ether);
        assertEq(imd.balanceOf(address(mine)), 0);
        assertEq(mine.refundableSurplus(), 0);
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Asked));
    }

    function test_claimAutomaticallyRefundsSurplusAndUsesActualPaidShares() public {
        uint256 id = _drop();
        vm.prank(owner);
        intake.setPrice(ACTION, address(imd), PRICE);
        (uint256 other, bytes32 rid) = _ask(carol, "full price");
        assertTrue(_answer(mine.question(id).requestId));
        assertTrue(_answer(rid));
        _warpPastRound(id);
        (uint128 shares, uint128 reward) = mine.rounds(_roundOf(id));
        assertEq(shares, 0.75 ether, "round weight is IMD spent, not the original quote");
        assertEq(mine.claimable(id, alice), uint256(reward) / 5);
        assertEq(mine.claimable(id, bob), uint256(reward) * 2 / 15);
        uint256 beforeA = imd.balanceOf(alice);
        vm.prank(alice);
        uint256 gotA = mine.claim(_ids(id, id));
        assertEq(gotA, uint256(reward) / 5);
        assertEq(imd.balanceOf(alice) - beforeA, 0.15 ether);
        assertEq(mine.backing(id, alice), 0);
        assertEq(mine.refundable(id, alice), 0);
        vm.prank(alice);
        assertEq(mine.claim(_ids(id)), 0);
        vm.prank(alice);
        vm.expectRevert(HmmMine.NothingToRefund.selector);
        mine.refund(id);
        // Refund independently after the answer, then claim; it must not refund a second time.
        vm.prank(bob);
        mine.refund(id);
        uint256 beforeB = imd.balanceOf(bob);
        vm.prank(bob);
        uint256 gotB = mine.claim(_ids(id));
        assertEq(imd.balanceOf(bob), beforeB);
        vm.prank(carol);
        uint256 gotC = mine.claim(_ids(other));
        assertEq(gotA + gotB + gotC, reward);
        assertEq(mine.refundableSurplus(), 0);
    }

    function test_failedAndExpiredRequestsKeepOnlyUnspentSurplusRefundable() public {
        uint256 id = _drop();
        assertTrue(_failure(mine.question(id).requestId, 1, "body_refused"));
        vm.prank(alice);
        mine.refund(id);
        vm.prank(bob);
        mine.refund(id);
        assertEq(imd.balanceOf(payTo), 0.25 ether, "the spent price is not refundable");
        assertEq(mine.claimable(id, alice), 0);
        vm.prank(owner);
        intake.setPrice(ACTION, address(imd), PRICE);
        uint256 expired = _drop();
        vm.warp(mine.answerDeadline(expired) + 1);
        mine.expire(expired);
        vm.prank(alice);
        mine.refund(expired);
        vm.prank(bob);
        mine.refund(expired);
        assertEq(mine.refundableSurplus(), 0);
        assertEq(imd.balanceOf(address(mine)), 0);
        assertEq(imd.balanceOf(payTo), 0.5 ether);
    }

    function testFuzz_priceDrop_conservesIMDAndHMMInEitherRefundOrder(
        uint96 partA,
        uint96 partB,
        uint96 liveSeed,
        uint8 order,
        bool refundFirst
    ) public {
        uint256 a = bound(partA, 0.01 ether, 0.48 ether);
        uint256 b = bound(partB, 0.01 ether, PRICE - a - 0.01 ether);
        uint256 live = bound(liveSeed, 1, PRICE - 1);
        bytes memory body = _body("pooled");
        vm.prank(alice, alice);
        uint256 id = mine.propose(_spec("pooled"), a);
        vm.prank(bob, bob);
        mine.back(id, b, "");
        vm.prank(owner);
        intake.setPrice(ACTION, address(imd), live);
        vm.prank(carol, carol);
        mine.back(id, PRICE - a - b, body);
        assertEq(imd.balanceOf(payTo), live);
        assertTrue(_answer(mine.question(id).requestId));
        _warpPastRound(id);
        (uint128 shares, uint128 reward) = mine.rounds(_roundOf(id));
        assertEq(shares, live);
        address[3] memory actors = [alice, bob, carol];
        uint256 total;
        for (uint256 i; i < 3; ++i) {
            address actor = actors[(i + uint256(order)) % 3];
            uint256 weight = mine.backing(id, actor);
            uint256 expected = i == 2 ? uint256(reward) - total : Math.mulDiv(reward, weight, PRICE);
            if (refundFirst) {
                vm.prank(actor);
                mine.refund(id);
            }
            vm.prank(actor);
            uint256 got = mine.claim(_ids(id));
            assertEq(got, expected);
            total += got;
        }
        assertEq(total, reward);
        assertEq(mine.claimedTotal(), reward);
        assertEq(mine.refundableSurplus(), 0);
        assertEq(imd.balanceOf(address(mine)), 0);
        assertEq(imd.balanceOf(alice) + imd.balanceOf(bob) + imd.balanceOf(carol) + live, 3_000 ether);
        (uint128 refundedBacking, uint128 refunded) = mine.surplusRefunds(id);
        assertEq(refundedBacking, PRICE);
        assertEq(refunded, PRICE - live);
    }

    function test_zeroRoundedSurplusCanBeAcknowledgedAndLastRefundGetsDust() public {
        vm.prank(alice, alice);
        uint256 id = mine.propose(_spec("one wei surplus"), 0.3 ether);
        vm.prank(owner);
        intake.setPrice(ACTION, address(imd), PRICE - 1);
        bytes memory body = _body("one wei surplus");
        vm.prank(bob, bob);
        mine.back(id, 0.2 ether, body);
        assertEq(mine.refundable(id, alice), 0);
        vm.prank(alice);
        mine.refund(id);
        assertTrue(mine.surplusRefunded(id, alice));
        assertEq(mine.refundable(id, bob), 1);
        vm.prank(bob);
        mine.refund(id);
        assertEq(mine.refundableSurplus(), 0);
    }
}
