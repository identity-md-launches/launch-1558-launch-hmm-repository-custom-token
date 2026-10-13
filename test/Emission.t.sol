// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HmmTestBase} from "./utils/HmmTestBase.sol";
import {HmmMine} from "../src/HmmMine.sol";

/// @notice The emission schedule, fuzzed: monotonic, bounded by the reserve, equal to the integral of the halving rate,
/// and fully accounted when rounds are answered at arbitrary times.
contract EmissionTest is HmmTestBase {
    function testFuzz_emittedAt_isMonotonic(uint64 a, uint64 b) public view {
        uint256 g = mine.genesis();
        uint256 t1 = g + bound(uint256(a), 0, 70 * ERA);
        uint256 t2 = g + bound(uint256(b), 0, 70 * ERA);
        if (t1 > t2) (t1, t2) = (t2, t1);
        assertLe(mine.emittedAt(t1), mine.emittedAt(t2));
    }

    function testFuzz_emittedAt_neverExceedsTheReserve(uint256 t) public view {
        assertLe(mine.emittedAt(bound(t, 0, type(uint64).max)), mine.reserve());
    }

    function testFuzz_emittedAt_isTheIntegralOfTheRate(uint64 dt) public view {
        uint256 g = mine.genesis();
        uint256 elapsed = bound(uint256(dt), 0, 66 * ERA);
        uint256 expected;
        uint256 left = elapsed;
        for (uint256 era; era < 64 && left > 0; ++era) {
            uint256 step = left < ERA ? left : ERA;
            expected += (mine.baseRate() >> era) * step;
            left -= step;
        }
        assertEq(mine.emittedAt(g + elapsed), expected);
        assertEq(mine.rateAt(g + elapsed), elapsed / ERA < 64 ? mine.baseRate() >> (elapsed / ERA) : 0);
    }

    function test_firstEra_emitsHalfTheReserve_andTheTailIsDust() public view {
        uint256 g = mine.genesis();
        uint256 half = mine.emittedAt(g + ERA);
        assertApproxEqRel(half, RESERVE / 2, 1e12); // within 1e-6
        uint256 all = mine.emittedAt(g + 64 * ERA);
        assertLe(all, RESERVE);
        assertLt(RESERVE - all, 1e10 ether / 1e10 + 2 * ERA, "only integer-division dust is never emitted");
    }

    /// @dev Answers land at fuzzed times; every round's reward plus the dev share equals exactly what the schedule
    /// emitted up to the end of the last answered round.
    function testFuzz_answeredRounds_accountForEveryEmittedUnit(uint32[6] memory gaps) public {
        uint256[] memory ids = new uint256[](gaps.length);
        uint256 lastRound;
        for (uint256 i; i < gaps.length; ++i) {
            vm.warp(block.timestamp + bound(uint256(gaps[i]), 1, 30 days));
            (uint256 id, bytes32 rid) = _ask(i % 2 == 0 ? alice : bob, string(abi.encodePacked("q", vm.toString(i))));
            _answer(rid);
            ids[i] = id;
            lastRound = _roundOf(id);
        }
        uint256 emitted = mine.emittedAt(mine.roundEnd(lastRound));
        assertEq(mine.assigned(), emitted);

        uint256 rewards;
        uint256 lastCounted = type(uint256).max;
        for (uint256 i; i < ids.length; ++i) {
            uint256 r = _roundOf(ids[i]);
            if (r == lastCounted) continue;
            (, uint128 reward) = mine.rounds(r);
            rewards += reward;
            lastCounted = r;
        }
        assertLe(rewards + mine.devOwed(), emitted, "solvent");
        assertApproxEqAbs(rewards + mine.devOwed(), emitted, ids.length + 1, "only rounding dust is left over");

        vm.warp(mine.roundEnd(lastRound));
        vm.prank(alice, alice);
        uint256 a = mine.claim(ids);
        vm.prank(bob, bob);
        uint256 b = mine.claim(ids);
        mine.payDev();
        assertEq(a + b, rewards);
        assertEq(hmm.balanceOf(address(mine)), RESERVE - a - b - mine.devPaid());
    }

    /// @dev Many backers of one question: the final claim includes dust, so all claims sum to the round's reward.
    function testFuzz_pooledClaims_neverExceedTheRound(uint96[5] memory parts) public {
        bytes memory body = _body("pooled");
        address[5] memory who;
        uint256 raised;
        uint256 id;
        for (uint256 i; i < 5; ++i) {
            who[i] = address(uint160(0x1000 + i));
            imd.mint(who[i], 1 ether);
            vm.prank(who[i], who[i]);
            imd.approve(address(mine), type(uint256).max);
        }
        vm.prank(who[0], who[0]);
        id = mine.propose(_spec("pooled"), bound(parts[0], 0.01 ether, 0.1 ether));
        raised = mine.question(id).raised;
        for (uint256 i = 1; i < 5 && raised < PRICE; ++i) {
            uint256 left = PRICE - raised;
            uint256 amount = i == 4 ? left : bound(parts[i], left < 0.01 ether ? left : 0.01 ether, left);
            vm.prank(who[i], who[i]);
            mine.back(id, amount, body);
            raised = mine.question(id).raised;
        }
        if (raised < PRICE) {
            vm.prank(who[4], who[4]);
            mine.back(id, PRICE - raised, body);
        }
        _answer(mine.question(id).requestId);
        _warpPastRound(id);
        (, uint128 reward) = mine.rounds(_roundOf(id));
        uint256 total;
        for (uint256 i; i < 5; ++i) {
            vm.prank(who[i], who[i]);
            total += mine.claim(_ids(id));
        }
        assertEq(total, reward);
    }
}
