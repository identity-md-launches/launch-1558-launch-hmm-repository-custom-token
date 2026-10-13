// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {HmmTestBase} from "../utils/HmmTestBase.sol";
import {HmmMine} from "../../src/HmmMine.sol";
import {HmmToken} from "../../src/HmmToken.sol";
import {SwarmOracleAdapter} from "../../src/SwarmOracleAdapter.sol";
import {Intake} from "../external/Intake.sol";
import {MockIMD} from "../utils/Mocks.sol";

/// @notice Drives the mine with random proposals, backings, refunds, answers (valid, rejected, refused), claims,
/// dev payouts and time jumps. Every call is guarded so a revert means a bug.
contract MineHandler is Test {
    HmmMine internal mine;
    HmmToken internal hmm;
    MockIMD internal imd;
    Intake internal intake;
    SwarmOracleAdapter internal adapter;
    address internal writer;
    uint256 internal oraclePk;

    address[] public actors;
    uint256[] public ids;
    mapping(uint256 => bytes) internal bodyOf;

    uint256 public ghostMinted;
    uint256 public ghostClaimed;
    uint256 public ghostAsked;
    uint256 public ghostAnswered;
    uint256 public ghostFailed;
    uint256 internal nonce;

    constructor(
        HmmMine mine_,
        HmmToken hmm_,
        MockIMD imd_,
        Intake intake_,
        SwarmOracleAdapter adapter_,
        address writer_,
        uint256 oraclePk_
    ) {
        mine = mine_;
        hmm = hmm_;
        imd = imd_;
        intake = intake_;
        adapter = adapter_;
        writer = writer_;
        oraclePk = oraclePk_;
        for (uint256 i; i < 4; ++i) {
            address a = address(uint160(0xA000 + i));
            actors.push(a);
            imd.mint(a, 1_000 ether);
            ghostMinted += 1_000 ether;
            vm.prank(a);
            imd.approve(address(mine), type(uint256).max);
        }
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function actorsLength() external view returns (uint256) {
        return actors.length;
    }

    function propose(uint256 actorSeed, uint256 amountSeed, bool solo) external {
        address a = actors[actorSeed % actors.length];
        uint256 price = intake.priceOf(mine.action(), address(imd));
        uint256 amount = solo ? price : bound(amountSeed, mine.MIN_BACKING(), price);
        HmmMine.Spec memory spec = HmmMine.Spec({
            question: string(abi.encodePacked("question ", vm.toString(++nonce))),
            answerType: 0,
            evidence: 0,
            chainId: 1,
            windowHours: 24,
            panelSize: 5,
            quorum: 4,
            toleranceBps: 0
        });
        bytes memory body = mine.bodyOf(spec);
        vm.prank(a, a);
        uint256 id = mine.propose(spec, amount);
        ids.push(id);
        bodyOf[id] = body;
        if (amount == price) ghostAsked++;
    }

    function back(uint256 actorSeed, uint256 idSeed, uint256 amountSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        HmmMine.Question memory q = mine.question(id);
        if (q.status != HmmMine.Status.Open || block.timestamp > q.deadline) return;
        uint256 left = q.target - q.raised;
        uint256 minimum = left < mine.MIN_BACKING() ? left : mine.MIN_BACKING();
        uint256 amount = bound(amountSeed, minimum, left);
        address a = actors[actorSeed % actors.length];
        vm.prank(a, a);
        mine.back(id, amount, bodyOf[id]);
        if (amount == left) ghostAsked++;
    }

    function refund(uint256 actorSeed, uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        address a = actors[actorSeed % actors.length];
        HmmMine.Question memory q = mine.question(id);
        if (q.status != HmmMine.Status.Open || block.timestamp <= q.deadline) return;
        if (mine.backing(id, a) == 0) return;
        vm.prank(a);
        mine.refund(id);
    }

    /// @param kind 0-5 a counting answer, 6-7 an answer that does not count, 8-9 a refusal or no answer
    function settle(uint256 idSeed, uint8 kind) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        HmmMine.Question memory q = mine.question(id);
        if (q.status != HmmMine.Status.Asked) return;
        kind = kind % 10;
        bytes memory args;
        uint8 status;
        if (kind < 8) {
            SwarmOracleAdapter.Attestation memory a;
            a.requestId = bytes32(uint256(keccak256(abi.encode("o", ++nonce))) << 128);
            a.chainId = 1;
            a.answer = abi.encode(true);
            a.panelSize = 5;
            a.quorum = 4;
            a.agreed = kind < 6 ? 5 : 3; // 3 of 5 does not meet the quorum
            a.issuedAt = uint64(block.timestamp);
            a.expiresAt = uint64(block.timestamp + 1 days);
            (uint8 v, bytes32 r, bytes32 s) =
                vm.sign(oraclePk, SwarmOracleAdapter(q.adapter).digest(a, block.chainid, q.adapter));
            args = abi.encode(q.requestId, a, abi.encodePacked(r, s, v));
            if (kind < 6) ghostAnswered++;
            else ghostFailed++;
        } else {
            status = kind == 8 ? 1 : 2;
            args = abi.encode(q.requestId, status, bytes32("x"), uint16(0), uint16(0), bytes(""));
            ghostFailed++;
        }
        vm.prank(writer);
        intake.complete(q.requestId, status, keccak256(args), "", args);
    }

    function claim(uint256 actorSeed) external {
        address a = actors[actorSeed % actors.length];
        vm.prank(a);
        ghostClaimed += mine.claim(ids);
    }

    function payDev() external {
        mine.payDev();
    }

    function warp(uint256 secondsSeed, bool long) external {
        uint256 dt = long ? bound(secondsSeed, 1 days, 200 days) : bound(secondsSeed, 1, 2 hours);
        vm.warp(block.timestamp + dt);
    }
}

contract MineInvariantTest is HmmTestBase {
    MineHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new MineHandler(mine, hmm, imd, intake, adapter, writer, oraclePk);
        targetContract(address(handler));
    }

    /// HMM: everything that left the mine was claimed by backers or paid to the dev.
    function invariant_hmmIsConserved() public view {
        assertEq(hmm.balanceOf(address(mine)) + mine.claimedTotal() + mine.devPaid(), mine.reserve());
        assertEq(mine.claimedTotal(), handler.ghostClaimed());
    }

    /// Never more paid or owed than emitted, never more emitted than the schedule allows, never past the reserve.
    function invariant_solvency() public view {
        assertLe(mine.claimedTotal() + mine.devPaid() + mine.devOwed(), mine.assigned());
        assertLe(mine.assigned(), mine.emittedAt(mine.roundEnd(mine.currentRound())));
        assertLe(mine.assigned(), mine.reserve());
    }

    /// IMD: the mine holds exactly what open questions raised; the rest went to the swarm or back to backers.
    function invariant_imdIsConserved() public view {
        assertEq(imd.balanceOf(address(mine)), mine.openRaised());
        uint256 open;
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; ++i) {
            HmmMine.Question memory q = mine.question(handler.ids(i));
            if (q.status == HmmMine.Status.Open) open += q.raised;
        }
        assertEq(open, mine.openRaised());
        uint256 actors;
        for (uint256 i; i < handler.actorsLength(); ++i) {
            actors += imd.balanceOf(handler.actors(i));
        }
        assertEq(actors + imd.balanceOf(address(mine)) + imd.balanceOf(payTo), handler.ghostMinted());
        assertEq(imd.balanceOf(payTo), handler.ghostAsked() * PRICE, "every ask paid the swarm exactly once");
    }

    /// Each question is in a consistent state, and each round's shares are its answered questions' payments.
    function invariant_questionsAreConsistent() public view {
        uint256 n = handler.idsLength();
        uint256 answered;
        uint256 failed;
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.ids(i);
            HmmMine.Question memory q = mine.question(id);
            if (q.status == HmmMine.Status.Open) {
                assertLt(q.raised, q.target);
                assertEq(q.requestId, bytes32(0));
            } else {
                assertEq(q.raised, q.target);
                assertEq(mine.questionOf(q.requestId), id);
                if (q.status == HmmMine.Status.Answered) answered++;
                if (q.status == HmmMine.Status.Failed) failed++;
            }
        }
        assertEq(answered, handler.ghostAnswered());
        assertEq(failed, handler.ghostFailed());
    }

    function invariant_roundSharesMatchAnsweredQuestions() public view {
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; ++i) {
            HmmMine.Question memory q = mine.question(handler.ids(i));
            if (q.status != HmmMine.Status.Answered) continue;
            uint256 sum;
            for (uint256 j; j < n; ++j) {
                HmmMine.Question memory o = mine.question(handler.ids(j));
                if (o.status == HmmMine.Status.Answered && o.round == q.round) sum += o.target;
            }
            (uint128 shares,) = mine.rounds(q.round);
            assertEq(shares, sum);
        }
    }
}
