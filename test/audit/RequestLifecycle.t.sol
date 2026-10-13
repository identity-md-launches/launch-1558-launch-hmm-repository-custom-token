// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HmmTestBase} from "../utils/HmmTestBase.sol";
import {BundledCompleter} from "./ForeignRequestFirst.t.sol";
import {HmmMine} from "../../src/HmmMine.sol";
import {SwarmOracleAdapter} from "../../src/SwarmOracleAdapter.sol";

contract RequestLifecycleTest is HmmTestBase {
    /// @dev c002d6afba29: use an actual 7702 delegation, including the 23-byte indicator and origin's self-call.
    function test_delegatedOriginCannotSpendOtherBackersFundsInABatch() public {
        vm.setEvmVersion("prague");
        vm.prank(alice, alice);
        uint256 id = mine.propose(_spec("pooled question"), 0.49 ether);
        BundledCompleter implementation = new BundledCompleter();
        uint256 key = 0xB0B;
        address account = vm.addr(key);
        vm.signAndAttachDelegation(address(implementation), key);
        assertEq(account.code, abi.encodePacked(hex"ef0100", address(implementation)));
        imd.mint(account, 0.51 ether);
        bytes memory body = _body("pooled question");
        bytes memory own = _body("own question");
        vm.prank(account, account);
        vm.expectRevert(HmmMine.CompleterMustBeEOA.selector);
        BundledCompleter(account).run(intake, mine, IERC20(address(imd)), ACTION, own, id, body);
        assertEq(intake.nonce(), 0, "the whole batch, including its first request, rolls back");
        assertEq(imd.balanceOf(payTo), 0);
        assertEq(mine.openRaised(), 0.49 ether);
        assertEq(imd.balanceOf(address(mine)), 0.49 ether);
        assertEq(mine.question(id).raised, 0.49 ether);
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Open));
        vm.prank(bob, bob);
        mine.back(id, 0.01 ether, body);
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Asked));
    }

    function test_delegatedAccountsCanStillBackPartiallyOrFundOnlyTheirOwnQuestion() public {
        vm.setEvmVersion("prague");
        BundledCompleter implementation = new BundledCompleter();
        uint256 key = 0xB0B;
        address account = vm.addr(key);
        vm.signAndAttachDelegation(address(implementation), key);
        imd.mint(account, 2 ether);
        vm.prank(account, account);
        imd.approve(address(mine), type(uint256).max);
        vm.prank(alice, alice);
        uint256 id = mine.propose(_spec("pooled"), 0.2 ether);
        vm.prank(account, account);
        mine.back(id, 0.2 ether, "");
        assertEq(mine.backing(id, account), 0.2 ether);
        vm.prank(account, account);
        uint256 solo = mine.propose(_spec("solo"), PRICE);
        assertEq(uint8(_status(solo)), uint8(HmmMine.Status.Asked));
    }

    /// @dev ebc7af44b22b: the deadline belongs to the request, not the earlier funding period.
    function test_expire_boundaryIsMeasuredFromAskAndMovesNoFunds() public {
        vm.prank(alice, alice);
        uint256 id = mine.propose(_spec("late funding"), 0.3 ether);
        vm.warp(mine.question(id).deadline);
        bytes memory body = _body("late funding");
        vm.prank(bob, bob);
        mine.back(id, 0.2 ether, body);
        uint256 deadline = mine.answerDeadline(id);
        assertEq(deadline, block.timestamp + 7 days);
        vm.warp(deadline);
        vm.expectRevert(abi.encodeWithSelector(HmmMine.TooEarly.selector, deadline + 1));
        mine.expire(id);
        vm.warp(deadline + 1);
        vm.expectEmit(true, true, false, true, address(mine));
        emit HmmMine.Failed(id, mine.question(id).requestId, 2, "timeout");
        vm.prank(carol);
        mine.expire(id);
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Failed));
        assertEq(mine.assigned(), 0);
        assertEq(hmm.balanceOf(address(mine)), RESERVE);
        assertEq(imd.balanceOf(address(mine)), 0);
        assertEq(imd.balanceOf(payTo), PRICE);
        vm.prank(alice);
        vm.expectRevert(HmmMine.NotRefundable.selector);
        mine.refund(id);
        vm.expectRevert(HmmMine.NotAsked.selector);
        mine.expire(id);
    }

    function test_malformedUndeliveredCallbackCanExpire() public {
        (uint256 id, bytes32 rid) = _ask(alice, "undelivered");
        assertFalse(_complete(rid, hex"1234"));
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Asked));
        vm.warp(mine.answerDeadline(id) + 1);
        mine.expire(id);
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Failed));
    }

    function test_expiredRequestCannotBeRevivedByALateSignedAnswerOrFailure() public {
        (uint256 id, bytes32 rid) = _ask(alice, "missing");
        vm.warp(mine.answerDeadline(id) + 1);
        mine.expire(id);
        SwarmOracleAdapter.Attestation memory a = _attestation();
        assertFalse(_answerWith(rid, a, _sign(a, address(adapter), oraclePk)));
        assertFalse(adapter.used(a.requestId), "reverting credit rolls back consumption");
        vm.prank(address(intake));
        vm.expectRevert(HmmMine.NotAsked.selector);
        adapter.onOracleFailure(rid, 2, "disagreed", 2, 5, "");
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Failed));
        assertEq(mine.assigned(), 0);
    }

    function test_onlyAskedQuestionsCanExpireAndLateAnswersRemainValidUntilCleared() public {
        vm.expectRevert(HmmMine.NotAsked.selector);
        mine.expire(99);
        vm.prank(alice, alice);
        uint256 open = mine.propose(_spec("open"), 0.1 ether);
        vm.expectRevert(HmmMine.NotAsked.selector);
        mine.expire(open);
        (uint256 id, bytes32 rid) = _ask(bob, "answered late");
        vm.warp(mine.answerDeadline(id) + 1);
        assertTrue(_answer(rid));
        vm.expectRevert(HmmMine.NotAsked.selector);
        mine.expire(id);
    }

    /// @dev a07ab78e0ae3 reproduces only for separate deployments; the launch binds atomically (see FactoryLaunch).
    function test_separatelyDeployedAdapterCanBeClaimedBeforeMineConstruction() public {
        SwarmOracleAdapter fresh = new SwarmOracleAdapter(address(intake), oracleSigner, 5, 4);
        vm.prank(alice);
        fresh.bind();
        vm.expectRevert(abi.encodeWithSelector(SwarmOracleAdapter.AlreadyBound.selector, alice));
        new HmmMine(
            address(hmm),
            address(imd),
            address(intake),
            ACTION,
            address(forwarder),
            address(fresh),
            dev,
            500,
            ROUND,
            ERA,
            0
        );
    }
}
