// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HmmTestBase} from "../utils/HmmTestBase.sol";
import {HmmMine} from "../../src/HmmMine.sol";
import {SwarmOracleAdapter} from "../../src/SwarmOracleAdapter.sol";

/// @notice ea7d6f9ab061: round rewards are fully claimable, including each division's final wei.
contract RoundingTest is HmmTestBase {
    function _tinyMine(uint256 roundLength) internal {
        SwarmOracleAdapter a = new SwarmOracleAdapter(address(intake), oracleSigner, 5, 4);
        mine = new HmmMine(
            address(hmm),
            address(imd),
            address(intake),
            ACTION,
            address(forwarder),
            address(a),
            dev,
            0,
            roundLength,
            roundLength,
            0
        );
        vm.prank(makeAddr("pool"));
        hmm.transfer(address(mine), roundLength * 2);
        vm.prank(address(forwarder));
        mine.start();
        vm.prank(alice);
        imd.approve(address(mine), type(uint256).max);
        vm.prank(bob);
        imd.approve(address(mine), type(uint256).max);
    }

    function test_sevenSharesAndTenRewardPayFourThenSix() public {
        _tinyMine(10);
        vm.prank(owner);
        intake.setPrice(ACTION, address(imd), 3);
        vm.prank(alice, alice);
        uint256 x = mine.propose(_spec("three"), 3);
        vm.prank(owner);
        intake.setPrice(ACTION, address(imd), 4);
        vm.prank(bob, bob);
        uint256 y = mine.propose(_spec("four"), 4);
        assertTrue(_answer(mine.question(x).requestId));
        assertTrue(_answer(mine.question(y).requestId));
        vm.warp(mine.roundEnd(0));
        assertEq(mine.claimable(x, alice), 4);
        assertEq(mine.claimable(y, bob), 5);
        vm.prank(alice);
        assertEq(mine.claim(_ids(x)), 4);
        assertEq(mine.claimable(y, bob), 6, "last claimant can see the rounding remainder");
        vm.prank(bob);
        assertEq(mine.claim(_ids(y)), 6);
        (uint128 shares, uint128 claimed) = mine.roundClaims(0);
        assertEq(shares, 7);
        assertEq(claimed, 10);
        assertEq(mine.claimedTotal(), 10);
        vm.prank(bob);
        assertEq(mine.claim(_ids(x, y)), 0);
    }

    function test_zeroRoundedClaimIsConsumedSoTheLastBackerCanTakeTheWei() public {
        _tinyMine(1);
        vm.prank(alice, alice);
        uint256 id = mine.propose(_spec("one wei round"), 0.2 ether);
        bytes memory body = _body("one wei round");
        vm.prank(bob, bob);
        mine.back(id, 0.3 ether, body);
        assertTrue(_answer(mine.question(id).requestId));
        vm.warp(mine.roundEnd(0));
        assertEq(mine.claimable(id, alice), 0);
        assertEq(mine.claimable(id, bob), 0);
        vm.prank(alice);
        assertEq(mine.claim(_ids(id, id)), 0);
        assertEq(mine.backing(id, alice), 0);
        assertEq(mine.claimedBacking(id), 0.2 ether);
        assertEq(mine.claimable(id, bob), 1);
        vm.prank(bob);
        assertEq(mine.claim(_ids(id)), 1);
        assertEq(mine.claimedTotal(), 1);
    }

    function test_multipleQuestionsOwnedByOneBackerCanClaimTheFinalDustInABatch() public {
        _tinyMine(10);
        (uint256 x, bytes32 rx) = _ask(alice, "one");
        (uint256 y, bytes32 ry) = _ask(bob, "two");
        (uint256 z, bytes32 rz) = _ask(alice, "three");
        assertTrue(_answer(rx));
        assertTrue(_answer(ry));
        assertTrue(_answer(rz));
        _warpPastRound(x);
        vm.prank(bob);
        assertEq(mine.claim(_ids(y)), 3);
        vm.prank(alice);
        assertEq(mine.claim(_ids(x, z)), 7);
        assertEq(mine.claimedTotal(), 10);
    }
}
