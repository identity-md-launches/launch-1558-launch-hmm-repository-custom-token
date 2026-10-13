// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HmmMineStewarded} from "./utils/HmmMineStewarded.sol";
import {HmmTestBase} from "./utils/HmmTestBase.sol";
import {HmmMine} from "../src/HmmMine.sol";
import {HmmToken} from "../src/HmmToken.sol";
import {SwarmOracleAdapter} from "../src/SwarmOracleAdapter.sol";
import {IIntake} from "../src/interfaces/IIntake.sol";

/// @dev Asks two questions with its own IMD in one transaction: the second ask must be refused, since the swarm
/// serves only the first Intake request of a transaction.
contract DoubleAsker {
    function run(HmmMine m, HmmMine.Spec calldata a, HmmMine.Spec calldata b, uint256 price) external {
        m.imd().approve(address(m), type(uint256).max);
        m.propose(a, price);
        m.propose(b, price);
    }
}

/// @dev Completes someone else's pooled question from a contract.
contract ContractCompleter {
    function run(HmmMine m, uint256 id, bytes calldata body) external {
        m.imd().approve(address(m), type(uint256).max);
        m.back(id, type(uint256).max, body);
    }
}

contract HmmMineTest is HmmTestBase {
    function _devCeil(uint256 gross) internal pure returns (uint256) {
        return (gross * DEV_BPS + 9_999) / 10_000;
    }

    /* ─────────────────────────── start ─────────────────────────── */

    function test_start_setsReserveGenesisAndRate() public view {
        assertEq(mine.reserve(), RESERVE);
        assertEq(hmm.balanceOf(address(mine)), RESERVE);
        assertEq(mine.genesis(), block.timestamp);
        assertEq(mine.baseRate(), RESERVE / (2 * ERA));
        assertTrue(mine.started());
        assertEq(hmm.balanceOf(address(forwarder)), 0);
    }

    function test_start_onlyForwarder() public {
        vm.expectRevert(HmmMine.NotForwarder.selector);
        mine.start();
    }

    function test_start_repeatedForwarderCallDoesNotRestart() public {
        uint256 g = mine.genesis();
        uint256 rate = mine.baseRate();
        vm.warp(block.timestamp + 1 days);
        vm.prank(address(forwarder));
        mine.start();
        assertEq(mine.genesis(), g);
        assertEq(mine.reserve(), RESERVE);
        assertEq(mine.baseRate(), rate);
    }

    function test_start_needsReserve() public {
        (,, HmmMine m) = _launch(LAUNCH + 1, 0);
        // drain what the forwarder holds for this launch without forwarding it
        vm.prank(address(forwarder));
        vm.expectRevert(HmmMine.NothingToMine.selector);
        m.start();
    }

    function test_genesisDelay_blocksQuestionsUntilGenesis() public {
        (,, HmmMine m) = _launch(LAUNCH + 1, 1 hours);
        forwarder.forward(LAUNCH + 1);
        assertEq(m.genesis(), block.timestamp + 1 hours);
        vm.startPrank(alice, alice);
        imd.approve(address(m), type(uint256).max);
        vm.expectRevert(HmmMine.NotLive.selector);
        m.propose(_spec("too early"), PRICE);
        vm.warp(block.timestamp + 1 hours);
        m.propose(_spec("on time"), PRICE);
        vm.stopPrank();
        assertEq(uint8(m.question(1).status), uint8(HmmMine.Status.Asked));
    }

    function test_constructor_validates() public {
        vm.expectRevert(HmmMine.DevShareTooHigh.selector);
        new HmmMineStewarded(
            address(hmm),
            address(imd),
            address(intake),
            ACTION,
            address(forwarder),
            address(adapter),
            steward,
            dev,
            1001,
            ROUND,
            ERA,
            0
        );
        vm.expectRevert(HmmMine.BadSchedule.selector);
        new HmmMineStewarded(
            address(hmm),
            address(imd),
            address(intake),
            ACTION,
            address(forwarder),
            address(adapter),
            steward,
            dev,
            500,
            0,
            ERA,
            0
        );
        vm.expectRevert(HmmMine.BadSchedule.selector);
        new HmmMineStewarded(
            address(hmm),
            address(imd),
            address(intake),
            ACTION,
            address(forwarder),
            address(adapter),
            steward,
            dev,
            500,
            ROUND,
            ROUND - 1,
            0
        );
        vm.expectRevert(HmmMine.ZeroAction.selector);
        new HmmMineStewarded(
            address(hmm),
            address(imd),
            address(intake),
            bytes32(0),
            address(forwarder),
            address(adapter),
            steward,
            dev,
            500,
            ROUND,
            ERA,
            0
        );
        vm.expectRevert(HmmMine.ZeroAddress.selector);
        new HmmMineStewarded(
            address(hmm),
            address(imd),
            address(intake),
            ACTION,
            address(0),
            address(adapter),
            steward,
            dev,
            500,
            ROUND,
            ERA,
            0
        );
        // the adapter is already bound to `mine`
        vm.expectRevert(abi.encodeWithSelector(SwarmOracleAdapter.AlreadyBound.selector, address(mine)));
        new HmmMineStewarded(
            address(hmm),
            address(imd),
            address(intake),
            ACTION,
            address(forwarder),
            address(adapter),
            steward,
            dev,
            500,
            ROUND,
            ERA,
            0
        );
    }

    /* ─────────────────────────── asking ─────────────────────────── */

    function test_soloAsk_paysTheSwarmAndRecordsTheRequest() public {
        uint256 before = imd.balanceOf(alice);
        (uint256 id, bytes32 rid) = _ask(alice, "Did IMD trade on Uniswap v4 today?");
        assertEq(id, 1);
        assertEq(imd.balanceOf(alice), before - PRICE);
        assertEq(imd.balanceOf(payTo), PRICE, "payment forwarded to the IMD treasury");
        assertEq(imd.balanceOf(address(mine)), 0);
        assertEq(mine.openRaised(), 0);
        assertEq(mine.questionOf(rid), id);
        HmmMine.Question memory q = mine.question(id);
        assertEq(uint8(q.status), uint8(HmmMine.Status.Asked));
        assertEq(q.adapter, address(adapter));
        assertEq(q.raised, PRICE);
        assertEq(mine.backing(id, alice), PRICE);
        (address payer, address target, bytes4 sel, bool done) = intake.requests(rid);
        assertEq(payer, address(mine));
        assertEq(target, address(adapter));
        assertEq(sel, SwarmOracleAdapter.onOracleResult.selector);
        assertFalse(done);
        assertEq(intake.failureSelectorOf(rid), SwarmOracleAdapter.onOracleFailure.selector);
    }

    function test_propose_capsAmountAtPrice() public {
        vm.prank(alice, alice);
        uint256 id = mine.propose(_spec("q"), 5 ether);
        assertEq(mine.backing(id, alice), PRICE);
        assertEq(imd.balanceOf(alice), 1_000 ether - PRICE);
    }

    function test_propose_rejectsDust() public {
        vm.prank(alice, alice);
        vm.expectRevert(HmmMine.TooSmall.selector);
        mine.propose(_spec("q"), 0.001 ether);
    }

    /// @dev The mine writes the body: no quote, backslash or control byte can end the question string and add fields
    /// (a foreign `consumer`, a `deliver`), and the panel rules hold.
    function test_spec_rulesAndInjection() public {
        HmmMine.Spec memory s =
            _spec('x","consumer":{"chainId":1,"verifyingContract":"0x00000000000000000000000000000000000000aa"},"q":"');
        vm.startPrank(alice, alice);
        vm.expectRevert(HmmMine.BadQuestion.selector);
        mine.propose(s, PRICE);
        vm.expectRevert(HmmMine.BadQuestion.selector);
        mine.propose(_spec("back\\slash"), PRICE);
        vm.expectRevert(HmmMine.BadQuestion.selector);
        mine.propose(_spec("line\nbreak"), PRICE);
        vm.expectRevert(HmmMine.BadQuestion.selector);
        mine.propose(_spec(""), PRICE);
        vm.expectRevert(HmmMine.BadQuestion.selector);
        mine.propose(_spec(string(new bytes(2001))), PRICE);
        vm.expectRevert(HmmMine.BadQuestion.selector);
        mine.propose(_spec(unicode"caf\u00e9?"), PRICE);

        s = _spec("q");
        s.panelSize = 4;
        s.quorum = 4;
        vm.expectRevert(HmmMine.BadSpec.selector);
        mine.propose(s, PRICE);
        s = _spec("q");
        s.quorum = 3;
        vm.expectRevert(HmmMine.BadSpec.selector);
        mine.propose(s, PRICE);
        s = _spec("q");
        s.panelSize = 9;
        s.quorum = 4; // not a majority of 9
        vm.expectRevert(HmmMine.BadSpec.selector);
        mine.propose(s, PRICE);
        s = _spec("q");
        s.panelSize = 101;
        s.quorum = 60;
        vm.expectRevert(HmmMine.BadSpec.selector);
        mine.propose(s, PRICE);
        s = _spec("q");
        s.answerType = 4; // lists are not offered
        vm.expectRevert(HmmMine.BadSpec.selector);
        mine.propose(s, PRICE);
        s = _spec("q");
        s.evidence = 2;
        vm.expectRevert(HmmMine.BadSpec.selector);
        mine.propose(s, PRICE);
        s = _spec("q");
        s.chainId = 10;
        vm.expectRevert(HmmMine.BadSpec.selector);
        mine.propose(s, PRICE);
        s = _spec("q");
        s.windowHours = 0;
        vm.expectRevert(HmmMine.BadSpec.selector);
        mine.propose(s, PRICE);
        s = _spec("q");
        s.windowHours = 721;
        vm.expectRevert(HmmMine.BadSpec.selector);
        mine.propose(s, PRICE);
        s = _spec("q");
        s.toleranceBps = 1; // only for uint256 answers
        vm.expectRevert(HmmMine.BadSpec.selector);
        mine.propose(s, PRICE);
        s.answerType = 3;
        s.toleranceBps = 10_001;
        vm.expectRevert(HmmMine.BadSpec.selector);
        mine.propose(s, PRICE);
        vm.stopPrank();
    }

    function test_bodyOf_isTheExactJsonTheSwarmChecked() public view {
        assertEq(
            string(mine.bodyOf(_spec("Is it?"))),
            '{"v":1,"question":"Is it?","chainId":1,"window":{"hours":24},"answerType":"bool","evidence":"chain","panelSize":5,"quorum":4,"validForSeconds":86400}'
        );
        HmmMine.Spec memory s = _spec("How many?");
        s.answerType = 3;
        s.evidence = 1;
        s.chainId = 4663;
        s.windowHours = 720;
        s.panelSize = 100;
        s.quorum = 51;
        s.toleranceBps = 250;
        assertEq(
            string(mine.bodyOf(s)),
            '{"v":1,"question":"How many?","chainId":4663,"window":{"hours":720},"answerType":"uint256","evidence":"panel","panelSize":100,"quorum":51,"validForSeconds":86400,"toleranceBps":250}'
        );
        s.answerType = 1;
        s.toleranceBps = 0;
        assertEq(
            string(mine.bodyOf(s)),
            '{"v":1,"question":"How many?","chainId":4663,"window":{"hours":720},"answerType":"address","evidence":"panel","panelSize":100,"quorum":51,"validForSeconds":86400}'
        );
    }

    function test_propose_notSoldWhenPriceIsZero() public {
        vm.prank(owner);
        intake.setPrice(ACTION, address(imd), 0);
        vm.prank(alice, alice);
        vm.expectRevert(HmmMine.NotSold.selector);
        mine.propose(_spec("q"), PRICE);
    }

    function test_pooledQuestion_isAskedWhenTheLastBackerCompletesIt() public {
        bytes memory body = _body("pooled");
        vm.prank(alice, alice);
        uint256 id = mine.propose(_spec("pooled"), 0.1 ether);
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Open));
        assertEq(imd.balanceOf(address(mine)), 0.1 ether);
        assertEq(mine.openRaised(), 0.1 ether);

        vm.prank(bob, bob);
        mine.back(id, 0.15 ether, "");
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Open));

        // more than is left: only the remainder is taken, and the body must come along
        bytes memory wrong = _body("not the same question");
        vm.prank(carol, carol);
        vm.expectRevert(HmmMine.BodyMismatch.selector);
        mine.back(id, 1 ether, wrong);

        uint256 carolBefore = imd.balanceOf(carol);
        vm.prank(carol, carol);
        mine.back(id, 1 ether, body);
        assertEq(carolBefore - imd.balanceOf(carol), 0.25 ether);
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Asked));
        assertEq(mine.backing(id, alice), 0.1 ether);
        assertEq(mine.backing(id, bob), 0.15 ether);
        assertEq(mine.backing(id, carol), 0.25 ether);
        assertEq(imd.balanceOf(address(mine)), 0);
        assertEq(mine.openRaised(), 0);
        assertEq(imd.balanceOf(payTo), PRICE);
    }

    function test_back_minimumUnlessCompletingTheRemainder() public {
        bytes memory body = _body("q");
        vm.prank(alice, alice);
        uint256 id = mine.propose(_spec("q"), PRICE - 0.005 ether);
        vm.prank(bob, bob);
        vm.expectRevert(HmmMine.TooSmall.selector);
        mine.back(id, 0.001 ether, body);
        vm.prank(bob, bob);
        mine.back(id, 0.005 ether, body); // below MIN_BACKING, but exactly what is left
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Asked));
    }

    function test_back_refusedWhenClosedOrNotOpen() public {
        (uint256 asked,) = _ask(alice, "asked");
        vm.prank(bob, bob);
        vm.expectRevert(HmmMine.NotOpen.selector);
        mine.back(asked, 0.1 ether, "");

        vm.prank(alice, alice);
        uint256 id = mine.propose(_spec("slow"), 0.1 ether);
        vm.warp(block.timestamp + mine.FUNDING_WINDOW() + 1);
        vm.prank(bob, bob);
        vm.expectRevert(HmmMine.FundingClosed.selector);
        mine.back(id, 0.1 ether, "");
    }

    function test_refund_afterDeadlineOnly_andOnce() public {
        vm.prank(alice, alice);
        uint256 id = mine.propose(_spec("q"), 0.2 ether);
        vm.prank(bob, bob);
        mine.back(id, 0.1 ether, "");

        vm.prank(alice, alice);
        vm.expectRevert(HmmMine.NotRefundable.selector);
        mine.refund(id);

        vm.warp(block.timestamp + mine.FUNDING_WINDOW() + 1);
        uint256 aliceBefore = imd.balanceOf(alice);
        vm.prank(alice, alice);
        mine.refund(id);
        assertEq(imd.balanceOf(alice) - aliceBefore, 0.2 ether);
        vm.prank(alice, alice);
        vm.expectRevert(HmmMine.NothingToRefund.selector);
        mine.refund(id);

        vm.prank(bob, bob);
        mine.refund(id);
        assertEq(imd.balanceOf(address(mine)), 0);
        assertEq(mine.openRaised(), 0);
        vm.prank(carol, carol);
        vm.expectRevert(HmmMine.NothingToRefund.selector);
        mine.refund(id);
    }

    function test_refund_refusedOnceAsked() public {
        (uint256 id,) = _ask(alice, "q");
        vm.warp(block.timestamp + mine.FUNDING_WINDOW() + 1);
        vm.prank(alice, alice);
        vm.expectRevert(HmmMine.NotRefundable.selector);
        mine.refund(id);
    }

    function test_priceRise_blocksTheAsk_andBackersRefund() public {
        bytes memory body = _body("q");
        vm.prank(alice, alice);
        uint256 id = mine.propose(_spec("q"), 0.3 ether);
        vm.prank(owner);
        intake.setPrice(ACTION, address(imd), 0.6 ether);
        vm.prank(bob, bob);
        vm.expectRevert(abi.encodeWithSelector(HmmMine.PriceRose.selector, 0.6 ether, PRICE));
        mine.back(id, 0.2 ether, body);
        vm.warp(block.timestamp + mine.FUNDING_WINDOW() + 1);
        vm.prank(alice, alice);
        mine.refund(id);
        assertEq(imd.balanceOf(alice), 1_000 ether);
    }

    // Imported audit: paying the stale quote loses the price difference to the Intake.
    function test_priceFall_paysTheLivePriceAndKeepsTheSurplus() public {
        bytes memory body = _body("q");
        vm.prank(alice, alice);
        uint256 id = mine.propose(_spec("q"), 0.3 ether);
        vm.prank(owner);
        intake.setPrice(ACTION, address(imd), 0.4 ether);
        vm.prank(bob, bob);
        mine.back(id, 0.2 ether, body);
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Asked));
        assertEq(imd.balanceOf(payTo), 0.4 ether);
        assertEq(imd.balanceOf(address(mine)), 0.1 ether);
        assertEq(mine.refundableSurplus(), 0.1 ether);
        assertEq(mine.question(id).target, 0.4 ether);
    }

    function test_oneAskPerTransaction() public {
        DoubleAsker d = new DoubleAsker();
        imd.mint(address(d), 1 ether);
        vm.expectRevert(HmmMine.OneAskPerTransaction.selector);
        d.run(mine, _spec("a"), _spec("b"), PRICE);
        // a contract asking once, with its own IMD, is fine
        ContractCompleter c = new ContractCompleter();
        imd.mint(address(c), 1 ether);
        vm.prank(address(c));
        imd.approve(address(mine), type(uint256).max);
        vm.prank(address(c));
        uint256 id = mine.propose(_spec("solo from a contract"), PRICE);
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Asked));
    }

    /// @dev Completing a question that holds other backers' IMD must come straight from an account, so no earlier
    /// Intake request in the same transaction can push the mine's request to second place (never served).
    function test_pooledCompletion_mustComeFromAnAccountDirectly() public {
        bytes memory body = _body("pooled");
        vm.prank(alice, alice);
        uint256 id = mine.propose(_spec("pooled"), 0.3 ether);

        ContractCompleter c = new ContractCompleter();
        imd.mint(address(c), 1 ether);
        vm.expectRevert(HmmMine.CompleterMustBeEOA.selector);
        c.run(mine, id, body);

        // an account called through a relayer (tx.origin differs) is refused too
        vm.prank(bob, carol);
        vm.expectRevert(HmmMine.CompleterMustBeEOA.selector);
        mine.back(id, 1 ether, body);

        // a contract may still add to it without completing it
        vm.prank(address(c));
        imd.approve(address(mine), type(uint256).max);
        vm.prank(address(c));
        mine.back(id, 0.1 ether, "");
        assertEq(mine.backing(id, address(c)), 0.1 ether);

        vm.prank(bob, bob);
        mine.back(id, 1 ether, body);
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Asked));
    }

    /// @dev The proposer completing their own question (no one else's IMD in it) may use any account.
    function test_ownQuestion_completedByAContractIsFine() public {
        ContractCompleter c = new ContractCompleter();
        imd.mint(address(c), 1 ether);
        vm.prank(address(c));
        imd.approve(address(mine), type(uint256).max);
        vm.prank(address(c));
        uint256 id = mine.propose(_spec("mine alone"), 0.2 ether);
        c.run(mine, id, _body("mine alone"));
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Asked));
    }

    /* ─────────────────────────── answers ─────────────────────────── */

    function test_answer_creditsTheRound_withRolloverSinceGenesis() public {
        vm.warp(block.timestamp + 3 hours + 5 minutes); // round 18
        (uint256 id, bytes32 rid) = _ask(alice, "q");
        assertTrue(_answer(rid), "callback delivered");
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Answered));
        uint256 r = _roundOf(id);
        assertEq(r, 18);

        uint256 emitted = mine.emittedAt(mine.roundEnd(r));
        assertEq(emitted, mine.baseRate() * 19 * ROUND, "everything since genesis rolls into the first answered round");
        assertEq(mine.assigned(), emitted);
        assertEq(mine.devOwed(), emitted * DEV_BPS / 10_000);
        (uint128 shares, uint128 reward) = mine.rounds(r);
        assertEq(shares, PRICE);
        assertEq(reward, emitted - _devCeil(emitted));
    }

    function test_claim_onlyAfterTheRoundEnds() public {
        (uint256 id, bytes32 rid) = _ask(alice, "q");
        _answer(rid);
        assertEq(mine.claimable(id, alice), 0, "round still open");
        vm.prank(alice, alice);
        assertEq(mine.claim(_ids(id)), 0);

        _warpPastRound(id);
        (, uint128 reward) = mine.rounds(_roundOf(id));
        assertEq(mine.claimable(id, alice), reward);
        vm.prank(alice, alice);
        uint256 got = mine.claim(_ids(id));
        assertEq(got, reward);
        assertEq(hmm.balanceOf(alice), reward);
        assertEq(mine.claimable(id, alice), 0);
        vm.prank(alice, alice);
        assertEq(mine.claim(_ids(id)), 0, "no double claim");
        assertEq(mine.claimedTotal(), reward);
    }

    function test_sameRound_splitsByIMDPaid_andPooledBackersSplitByShare() public {
        (uint256 solo, bytes32 ridSolo) = _ask(alice, "solo");
        bytes memory body = _body("pooled");
        vm.prank(bob, bob);
        uint256 pooled = mine.propose(_spec("pooled"), 0.1 ether);
        vm.prank(carol, carol);
        mine.back(pooled, 0.4 ether, body);
        bytes32 ridPooled = mine.question(pooled).requestId;

        _answer(ridSolo);
        _answer(ridPooled);
        assertEq(_roundOf(solo), _roundOf(pooled));
        _warpPastRound(solo);

        (uint128 shares, uint128 reward) = mine.rounds(_roundOf(solo));
        assertEq(shares, 2 * PRICE);
        assertEq(mine.claimable(solo, alice), uint256(reward) / 2);
        assertEq(mine.claimable(pooled, bob), uint256(reward) * 0.1 ether / (2 * PRICE));
        assertEq(mine.claimable(pooled, carol), uint256(reward) * 0.4 ether / (2 * PRICE));
        assertLe(mine.claimable(solo, alice) + mine.claimable(pooled, bob) + mine.claimable(pooled, carol), reward);
    }

    function test_emptyRoundsRollIntoTheNextAnsweredRound() public {
        (uint256 first, bytes32 rid1) = _ask(alice, "first");
        _answer(rid1);
        uint256 r1 = _roundOf(first);

        vm.warp(block.timestamp + 10 * ROUND);
        (uint256 second, bytes32 rid2) = _ask(bob, "second");
        _answer(rid2);
        uint256 r2 = _roundOf(second);
        assertEq(r2, r1 + 10);

        (, uint128 reward2) = mine.rounds(r2);
        uint256 gross = mine.emittedAt(mine.roundEnd(r2)) - mine.emittedAt(mine.roundEnd(r1));
        assertEq(gross, mine.baseRate() * 10 * ROUND);
        assertEq(reward2, gross - _devCeil(gross));
    }

    function test_halving_halvesTheRate() public {
        uint256 g = mine.genesis();
        assertEq(mine.rateAt(g), mine.baseRate());
        assertEq(mine.rateAt(g + ERA - 1), mine.baseRate());
        assertEq(mine.rateAt(g + ERA), mine.baseRate() / 2);
        assertEq(mine.rateAt(g + 3 * ERA), mine.baseRate() / 8);
        assertEq(mine.emittedAt(g + ERA), mine.baseRate() * ERA);
        assertEq(mine.emittedAt(g + 2 * ERA), mine.baseRate() * ERA + (mine.baseRate() / 2) * ERA);
        assertLe(mine.emittedAt(type(uint64).max), RESERVE);
        assertEq(mine.rateAt(g + 64 * ERA), 0);
    }

    function test_answerInALaterEra_isWorthLess() public {
        (uint256 a, bytes32 ridA) = _ask(alice, "early");
        _answer(ridA);
        _warpPastRound(a);
        vm.prank(alice, alice);
        mine.claim(_ids(a));

        // a lone answer one era later: pot = everything since the last answered round, at the later rates
        vm.warp(mine.genesis() + ERA + 1 hours);
        (uint256 b, bytes32 ridB) = _ask(bob, "late");
        _answer(ridB);
        (, uint128 rewardB) = mine.rounds(_roundOf(b));
        uint256 gross = mine.emittedAt(mine.roundEnd(_roundOf(b))) - mine.emittedAt(mine.roundEnd(_roundOf(a)));
        assertEq(rewardB, gross - _devCeil(gross));
        assertLt(mine.rateAt(block.timestamp), mine.baseRate());
    }

    function test_devShare_isPaidToDev_byAnyone() public {
        (, bytes32 rid) = _ask(alice, "q");
        _answer(rid);
        uint256 owed = mine.devOwed();
        assertGt(owed, 0);
        vm.prank(carol, carol);
        assertEq(mine.payDev(), owed);
        assertEq(hmm.balanceOf(dev), owed);
        assertEq(mine.devOwed(), 0);
        assertEq(mine.devPaid(), owed);
        assertEq(mine.payDev(), 0);
    }

    function test_failure_closesTheQuestion_withoutCredit() public {
        (uint256 id, bytes32 rid) = _ask(alice, "unanswerable");
        assertTrue(_failure(rid, 2, "disagreed"));
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Failed));
        assertEq(mine.assigned(), 0);
        vm.warp(block.timestamp + 1 days);
        assertEq(mine.claimable(id, alice), 0);
        vm.prank(alice, alice);
        vm.expectRevert(HmmMine.NotRefundable.selector);
        mine.refund(id);
    }

    function test_refusal_closesTheQuestion() public {
        (uint256 id, bytes32 rid) = _ask(alice, "refused");
        assertTrue(_failure(rid, 1, "body_refused"));
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Failed));
    }

    function test_answerThatDoesNotCount_isRecordedAsFailed() public {
        (uint256 id, bytes32 rid) = _ask(alice, "q");
        SwarmOracleAdapter.Attestation memory a = _attestation();
        a.panelSize = 3;
        a.quorum = 3;
        a.agreed = 3;
        assertTrue(_answerWith(rid, a, _sign(a, address(adapter), oraclePk)));
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Failed));
        assertEq(mine.assigned(), 0);
    }

    function test_forgedAnswer_doesNotCount() public {
        (uint256 id, bytes32 rid) = _ask(alice, "q");
        SwarmOracleAdapter.Attestation memory a = _attestation();
        assertTrue(_answerWith(rid, a, _sign(a, address(adapter), 0xBAD)));
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Failed));
    }

    function test_creditAndFail_onlyFromTheQuestionsAdapter() public {
        (, bytes32 rid) = _ask(alice, "q");
        vm.expectRevert(HmmMine.NotAdapter.selector);
        mine.credit(rid);
        vm.expectRevert(HmmMine.NotAdapter.selector);
        mine.fail(rid, 2, "x");
        vm.prank(address(adapter));
        vm.expectRevert(HmmMine.NotAsked.selector);
        mine.credit(bytes32(uint256(123)));
    }

    function test_outsiderRequestNamingTheAdapter_cannotMine() public {
        // someone pays the Intake directly and names our adapter: the oracle would sign for the adapter,
        // but the mine never asked it, so the callback reverts and nothing changes
        imd.mint(address(this), PRICE);
        imd.approve(address(intake), PRICE);
        bytes32 rid = IIntake(address(intake))
            .requestWithFailure(
                ACTION,
                _body("outsider"),
                IIntake.Callback(address(adapter), SwarmOracleAdapter.onOracleResult.selector),
                SwarmOracleAdapter.onOracleFailure.selector,
                address(imd),
                PRICE
            );
        assertFalse(_answer(rid));
        assertEq(mine.assigned(), 0);
        assertFalse(_failure2(rid));
    }

    function _failure2(bytes32 rid) internal returns (bool) {
        // already completed above: the Intake itself refuses a second completion
        vm.prank(writer);
        vm.expectRevert();
        intake.complete(
            rid, 2, bytes32(0), "", abi.encode(rid, uint8(2), bytes32("x"), uint16(0), uint16(0), bytes(""))
        );
        return false;
    }

    function test_writerCannotCreditAPendingRequestThroughAnotherCompletion() public {
        (uint256 a,) = _ask(alice, "a");
        (uint256 b, bytes32 ridB) = _ask(bob, "b");
        bytes32 ridA = mine.question(a).requestId;
        // complete A, but hand the callback B's id: B is not completed, so the adapter refuses it
        SwarmOracleAdapter.Attestation memory att = _attestation();
        bytes memory args = abi.encode(ridB, att, _sign(att, address(adapter), oraclePk));
        vm.recordLogs();
        vm.prank(writer);
        intake.complete(ridA, 0, bytes32(0), "", args);
        assertFalse(_delivered());
        assertEq(uint8(_status(a)), uint8(HmmMine.Status.Asked));
        assertEq(uint8(_status(b)), uint8(HmmMine.Status.Asked));
    }

    function test_sameOracleAnswer_countsOnce() public {
        (uint256 a, bytes32 ridA) = _ask(alice, "a");
        (uint256 b, bytes32 ridB) = _ask(bob, "b");
        SwarmOracleAdapter.Attestation memory att = _attestation();
        bytes memory sig = _sign(att, address(adapter), oraclePk);
        assertTrue(_answerWith(ridA, att, sig));
        assertTrue(_answerWith(ridB, att, sig));
        assertEq(uint8(_status(a)), uint8(HmmMine.Status.Answered));
        assertEq(uint8(_status(b)), uint8(HmmMine.Status.Failed));
    }

    /// @dev The Intake gives a callback exactly `callbackGas` (200k). The costliest path is the first answer of a
    /// round with a long answer, far into the schedule; it must fit with room to spare.
    function test_callback_fitsTheIntakeStipend() public {
        vm.warp(block.timestamp + 40 * ERA + 7 days);
        (uint256 id, bytes32 rid) = _ask(alice, "gas");
        SwarmOracleAdapter.Attestation memory a = _attestation();
        address[] memory list = new address[](32);
        for (uint256 i; i < 32; ++i) {
            list[i] = address(uint160(i + 1));
        }
        a.answerType = 4;
        a.answer = abi.encode(list);
        bytes memory sig = _sign(a, address(adapter), oraclePk);

        // measure the callback alone, as the Intake makes it
        vm.prank(address(intake));
        uint256 g0 = gasleft();
        (bool ok,) =
            address(adapter).call{gas: 200_000}(abi.encodeCall(SwarmOracleAdapter.onOracleResult, (rid, a, sig)));
        uint256 used = g0 - gasleft();
        assertFalse(ok, "not completed yet, refused");
        emit log_named_uint("callback gas (refused path)", used);

        assertTrue(_answerWith(rid, a, sig), "delivered within the stipend");
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Answered));
    }

    /// @dev The smallest stipend the real Intake can give and still deliver the costliest callback (first answer of a
    /// round, a 32-address answer, 40 eras in). Found by bisecting `callbackGas`; it must leave a wide margin under the
    /// 200k the Intake gives today.
    function test_callback_gasMargin() public {
        vm.warp(block.timestamp + 40 * ERA + 7 days);
        (uint256 id, bytes32 rid) = _ask(alice, "gas");
        SwarmOracleAdapter.Attestation memory a = _attestation();
        address[] memory list = new address[](32);
        for (uint256 i; i < 32; ++i) {
            list[i] = address(uint160(i + 1));
        }
        a.answerType = 4;
        a.answer = abi.encode(list);
        bytes memory sig = _sign(a, address(adapter), oraclePk);

        uint256 lo = 20_000;
        uint256 hi = 200_000;
        while (hi - lo > 500) {
            uint256 mid = (lo + hi) / 2;
            uint256 snap = vm.snapshotState();
            vm.prank(owner);
            intake.setCallbackGas(uint64(mid));
            bool ok = _answerWith(rid, a, sig) && _status(id) == HmmMine.Status.Answered;
            vm.revertToState(snap);
            if (ok) hi = mid;
            else lo = mid;
        }
        emit log_named_uint("minimum stipend for the costliest callback", hi);
        assertLt(hi, 140_000, "at least 30% headroom under the 200k stipend");
    }

    /* ─────────────────────────── steward ─────────────────────────── */

    function test_config_queueApplyAfterDelay_newQuestionsOnly() public {
        (uint256 old, bytes32 ridOld) = _ask(alice, "asked through the first adapter");

        SwarmOracleAdapter next = new SwarmOracleAdapter(address(intake), oracleSigner, 7, 5);
        bytes32 nextAction = bytes32("oracle.request@oracle-2");
        vm.prank(owner);
        intake.setPrice(nextAction, address(imd), PRICE);

        vm.prank(alice, alice);
        vm.expectRevert(HmmMine.NotSteward.selector);
        mine.queueConfig(address(next), nextAction);

        vm.prank(steward);
        mine.queueConfig(address(next), nextAction);
        vm.expectRevert(abi.encodeWithSelector(HmmMine.TooEarly.selector, block.timestamp + 3 days));
        mine.applyConfig();
        vm.warp(block.timestamp + 3 days);
        mine.applyConfig();
        assertEq(mine.adapter(), address(next));
        assertEq(mine.action(), nextAction);

        // the in-flight question still settles through its own adapter
        assertTrue(_answer(ridOld));
        assertEq(uint8(_status(old)), uint8(HmmMine.Status.Answered));

        // new questions go through the new adapter, which wants a 7-member panel
        (uint256 fresh, bytes32 ridNew) = _ask(bob, "asked through the second adapter");
        assertEq(mine.question(fresh).adapter, address(next));
        SwarmOracleAdapter.Attestation memory a = _attestation(); // panel of 5: too small for `next`
        assertTrue(_answerWith(ridNew, a, _sign(a, address(next), oraclePk)));
        assertEq(uint8(_status(fresh)), uint8(HmmMine.Status.Failed));
    }

    function test_config_cancel_andRenounce() public {
        SwarmOracleAdapter next = new SwarmOracleAdapter(address(intake), oracleSigner, 5, 4);
        vm.startPrank(steward);
        mine.queueConfig(address(next), ACTION);
        mine.cancelConfig();
        vm.expectRevert(HmmMine.NothingQueued.selector);
        mine.cancelConfig();
        mine.setSteward(address(0));
        vm.expectRevert(HmmMine.NotSteward.selector);
        mine.queueConfig(address(next), ACTION);
        vm.stopPrank();
        vm.expectRevert(HmmMine.NothingQueued.selector);
        mine.applyConfig();
    }

    function test_config_refusesAnAdapterBoundToAnotherMine() public {
        SwarmOracleAdapter other = new SwarmOracleAdapter(address(intake), oracleSigner, 5, 4);
        vm.prank(address(0xdead));
        other.bind();
        vm.prank(steward);
        mine.queueConfig(address(other), ACTION);
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert(abi.encodeWithSelector(SwarmOracleAdapter.AlreadyBound.selector, address(0xdead)));
        mine.applyConfig();
    }

    /* ─────────────────────────── views ─────────────────────────── */

    function test_stats_andPot() public {
        vm.warp(block.timestamp + 25 minutes); // round 2
        HmmMine.Stats memory s = mine.stats();
        assertEq(s.round, 2);
        assertEq(s.roundEndsAt, mine.genesis() + 3 * ROUND);
        assertEq(s.price, PRICE);
        assertEq(s.era, 0);
        assertEq(s.rate, mine.baseRate());
        uint256 gross = mine.baseRate() * 3 * ROUND;
        assertEq(s.pot, gross - _devCeil(gross));
        assertEq(s.nextHalvingAt, mine.genesis() + ERA);

        (, bytes32 rid) = _ask(alice, "q");
        _answer(rid);
        (, uint128 reward) = mine.rounds(2);
        assertEq(mine.pot(), reward, "once opened, the pot is the round's reward");
        assertEq(mine.stats().roundShares, PRICE);
    }

    function test_stats_beforeStart() public {
        (,, HmmMine m) = _launch(LAUNCH + 1, 0);
        HmmMine.Stats memory s = m.stats();
        assertEq(s.genesis, 0);
        assertEq(s.pot, 0);
        assertEq(s.price, PRICE);
        assertEq(m.currentRound(), 0);
        assertEq(m.emittedAt(block.timestamp + 365 days), 0);
    }

    function test_token_isPlainAndFixed() public view {
        assertEq(hmm.totalSupply(), SUPPLY);
        assertEq(hmm.name(), "hmm");
        assertEq(hmm.symbol(), "HMM");
        assertEq(hmm.decimals(), 18);
    }
}
