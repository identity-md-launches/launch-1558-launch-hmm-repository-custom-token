// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {HmmTestBase} from "../utils/HmmTestBase.sol";
import {HmmMine} from "../../src/HmmMine.sol";
import {HmmToken} from "../../src/HmmToken.sol";
import {SwarmOracleAdapter} from "../../src/SwarmOracleAdapter.sol";
import {Intake} from "../external/Intake.sol";
import {MockIMD} from "../utils/Mocks.sol";

/// @notice AUDIT: a rougher handler than the repo's: Intake price moves (up and down), adapter rotation through the
/// timelock, rejected / reused / expired answers, writer pairing a completed request, oversized answers (callback
/// out of gas), dust backings, refunds, claims, dev payouts and long time jumps. Accounting must hold throughout.
contract AdversarialHandler is Test {
    HmmMine internal mine;
    HmmToken internal hmm;
    MockIMD internal imd;
    Intake internal intake;
    address internal writer;
    address internal intakeOwner;
    address internal steward;
    address internal oracleSigner;
    uint256 internal oraclePk;
    bytes32 internal action;

    address[] public actors;
    uint256[] public ids;
    mapping(uint256 => bytes) internal bodyOf;
    bytes32 internal lastUsedOracleId;

    uint256 public ghostMinted;
    uint256 public ghostClaimed;
    uint256 public ghostPaidToSwarm;
    uint256 internal nonce;

    constructor(
        HmmMine mine_,
        HmmToken hmm_,
        MockIMD imd_,
        Intake intake_,
        address writer_,
        address intakeOwner_,
        address steward_,
        uint256 oraclePk_,
        bytes32 action_
    ) {
        mine = mine_;
        hmm = hmm_;
        imd = imd_;
        intake = intake_;
        writer = writer_;
        intakeOwner = intakeOwner_;
        steward = steward_;
        oraclePk = oraclePk_;
        oracleSigner = vm.addr(oraclePk_);
        action = action_;
        for (uint256 i; i < 5; ++i) {
            address a = address(uint160(0xB000 + i));
            actors.push(a);
            imd.mint(a, 10_000 ether);
            ghostMinted += 10_000 ether;
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

    function _price() internal view returns (uint256) {
        return intake.priceOf(mine.action(), address(imd));
    }

    function propose(uint256 actorSeed, uint256 amountSeed, bool solo) external {
        uint256 price = _price();
        if (price == 0) return;
        address a = actors[actorSeed % actors.length];
        uint256 minimum = price < mine.MIN_BACKING() ? price : mine.MIN_BACKING();
        uint256 amount = solo ? price : bound(amountSeed, minimum, price);
        HmmMine.Spec memory spec = HmmMine.Spec({
            question: string(abi.encodePacked("q", vm.toString(++nonce))),
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
        if (amount == price) ghostPaidToSwarm += price;
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
        if (amount == left) {
            uint256 live = intake.priceOf(mine.action(), address(imd));
            if (live == 0 || live > q.target || q.version != mine.configVersion()) {
                vm.prank(a, a);
                vm.expectRevert();
                mine.back(id, amount, bodyOf[id]);
                return;
            }
            ghostPaidToSwarm += live;
        }
        vm.prank(a, a);
        mine.back(id, amount, bodyOf[id]);
    }

    function refund(uint256 actorSeed, uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        address a = actors[actorSeed % actors.length];
        HmmMine.Question memory q = mine.question(id);
        if (q.status == HmmMine.Status.Open) {
            if (block.timestamp <= q.deadline) return;
        } else if (q.raised <= q.target || mine.surplusRefunded(id, a)) {
            return;
        }
        if (mine.backing(id, a) == 0) return;
        vm.prank(a, a);
        mine.refund(id);
    }

    function expire(uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        if (mine.question(id).status != HmmMine.Status.Asked || block.timestamp <= mine.answerDeadline(id)) return;
        mine.expire(id);
    }

    function movePrice(uint256 seed) external {
        uint256 p = bound(seed, 0.05 ether, 1.5 ether);
        bytes32 act = mine.action();
        vm.prank(intakeOwner);
        intake.setPrice(act, address(imd), p);
    }

    /// @param kind 0-3 counting answer; 4 rejected (small panel); 5 reused oracle id; 6 expired; 7 oversized (logged as a hash);
    /// 8 refusal; 9 no answer
    function settle(uint256 idSeed, uint8 kind) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        HmmMine.Question memory q = mine.question(id);
        if (q.status != HmmMine.Status.Asked) return;
        (,,, bool done) = intake.requests(q.requestId);
        if (done) return; // e.g. an earlier oversized answer: completed, never delivered
        kind = kind % 10;
        bytes memory args;
        uint8 status;
        if (kind < 8) {
            SwarmOracleAdapter.Attestation memory a;
            a.requestId = kind == 5 && lastUsedOracleId != bytes32(0)
                ? lastUsedOracleId
                : bytes32(uint256(keccak256(abi.encode("o", ++nonce))) << 128);
            a.chainId = 1;
            if (kind == 7) {
                address[] memory list = new address[](700);
                a.answerType = 4;
                a.answer = abi.encode(list);
            } else {
                a.answer = abi.encode(true);
            }
            a.panelSize = kind == 4 ? 4 : 5;
            a.quorum = 4;
            a.agreed = 4;
            a.issuedAt = uint64(block.timestamp);
            a.expiresAt = kind == 6 ? uint64(block.timestamp - 1) : uint64(block.timestamp + 1 days);
            (uint8 v, bytes32 r, bytes32 s) =
                vm.sign(oraclePk, SwarmOracleAdapter(q.adapter).digest(a, block.chainid, q.adapter));
            args = abi.encode(q.requestId, a, abi.encodePacked(r, s, v));
            if (kind < 4) lastUsedOracleId = a.requestId;
        } else {
            status = kind == 8 ? 1 : 2;
            args = abi.encode(q.requestId, status, bytes32("x"), uint16(0), uint16(0), bytes(""));
        }
        vm.prank(writer);
        intake.complete(q.requestId, status, keccak256(args), "", args);
    }

    function rotate(uint256 seed) external {
        SwarmOracleAdapter next = new SwarmOracleAdapter(address(intake), oracleSigner, 5, 4);
        vm.prank(steward);
        mine.queueConfig(address(next), action);
        vm.warp(block.timestamp + bound(seed, 3 days, 4 days));
        mine.applyConfig();
    }

    function claim(uint256 actorSeed) external {
        address a = actors[actorSeed % actors.length];
        vm.prank(a, a);
        ghostClaimed += mine.claim(ids);
    }

    function payDev() external {
        mine.payDev();
    }

    function warp(uint256 secondsSeed, bool long) external {
        uint256 dt = long ? bound(secondsSeed, 1 days, 400 days) : bound(secondsSeed, 1, 2 hours);
        vm.warp(block.timestamp + dt);
    }
}

contract AuditAdversarialInvariantTest is HmmTestBase {
    AdversarialHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new AdversarialHandler(mine, hmm, imd, intake, writer, owner, steward, oraclePk, ACTION);
        targetContract(address(handler));
    }

    function invariant_audit_hmmConservedAndSolvent() public view {
        assertEq(hmm.balanceOf(address(mine)) + mine.claimedTotal() + mine.devPaid(), mine.reserve());
        assertEq(mine.claimedTotal(), handler.ghostClaimed());
        assertLe(mine.claimedTotal() + mine.devPaid() + mine.devOwed(), mine.assigned());
        assertLe(mine.assigned(), mine.reserve());
    }

    function invariant_audit_imdConserved() public view {
        assertEq(imd.balanceOf(address(mine)), mine.openRaised() + mine.refundableSurplus());
        uint256 outstanding;
        for (uint256 i; i < handler.idsLength(); ++i) {
            uint256 id = handler.ids(i);
            HmmMine.Question memory q = mine.question(id);
            if (q.status == HmmMine.Status.Open) {
                outstanding += q.raised;
            } else {
                (, uint128 refunded) = mine.surplusRefunds(id);
                outstanding += q.raised - q.target - refunded;
            }
        }
        assertEq(outstanding, imd.balanceOf(address(mine)), "every unspent IMD remains on a backer's ledger");
        uint256 actors;
        for (uint256 i; i < handler.actorsLength(); ++i) {
            actors += imd.balanceOf(handler.actors(i));
        }
        assertEq(actors + imd.balanceOf(address(mine)) + imd.balanceOf(payTo), handler.ghostMinted());
        assertEq(imd.balanceOf(payTo), handler.ghostPaidToSwarm());
    }

    /// Every answered round's claims fit its reward; shares equal the answered questions' targets.
    function invariant_audit_roundsConsistent() public view {
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
            (, uint128 reward) = mine.rounds(q.round);
            (uint128 completedShares, uint128 claimed) = mine.roundClaims(q.round);
            assertLe(completedShares, shares);
            assertLe(claimed, reward);
            assertLe(mine.claimedBacking(handler.ids(i)), q.raised);
            if (completedShares == shares) assertEq(claimed, reward, "fully claimed rounds leave no reward dust");
        }
    }
}
