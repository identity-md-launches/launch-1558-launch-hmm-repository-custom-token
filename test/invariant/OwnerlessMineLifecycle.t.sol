// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AdversarialHandler} from "../audit/AdversarialInvariants.t.sol";
import {OwnerlessMineTestBase} from "../utils/OwnerlessMineTestBase.sol";
import {MockIMD} from "../utils/Mocks.sol";
import {Intake} from "../external/Intake.sol";
import {HmmMine} from "src/HmmMine.sol";
import {HmmToken} from "src/HmmToken.sol";
import {SwarmOracleAdapter} from "src/SwarmOracleAdapter.sol";

/// @dev Extends the existing price/backing model, but targets no steward rotation and verifies callback outcomes.
contract OwnerlessLifecycleHandler is AdversarialHandler {
    address internal immutable pool;
    uint256 public donatedHMM;
    uint256 public donatedIMD;
    uint256 public acceptedAnswers;
    uint256 public rejectedAnswers;
    uint256 public undeliveredAnswers;
    mapping(uint256 => HmmMine.Status) public terminalStatus;

    constructor(
        HmmMine mine_,
        HmmToken hmm_,
        MockIMD imd_,
        Intake intake_,
        address writer_,
        address owner_,
        uint256 key_,
        address pool_
    ) AdversarialHandler(mine_, hmm_, imd_, intake_, writer_, owner_, address(0), key_, mine_.action()) {
        pool = pool_;
    }

    /// @notice Count a false answer, reject bad signatures/weak panels, or leave malformed delivery to timeout.
    function settleChecked(uint256 idSeed, uint8 kind) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        HmmMine.Question memory q = mine.question(id);
        if (q.status != HmmMine.Status.Asked) return;
        (,,, bool done) = intake.requests(q.requestId);
        if (done) return;
        kind %= 7;
        uint256 assignedBefore = mine.assigned();
        uint256 balanceBefore = hmm.balanceOf(address(mine));
        (bytes memory args, uint8 status, bytes32 oracleId) = _callbackArgs(id, q, kind);
        vm.prank(writer);
        intake.complete(q.requestId, status, keccak256(args), "", args);

        HmmMine.Status expected =
            kind < 2 ? HmmMine.Status.Answered : kind == 6 ? HmmMine.Status.Asked : HmmMine.Status.Failed;
        assertEq(uint8(mine.question(id).status), uint8(expected), "callback must reach its expected terminal state");
        assertEq(SwarmOracleAdapter(q.adapter).used(oracleId), kind < 2, "only accepted answers consume the oracle id");
        assertEq(hmm.balanceOf(address(mine)), balanceBefore, "callbacks record debt without transferring HMM");
        if (kind < 2) {
            ++acceptedAnswers;
        } else {
            assertEq(mine.assigned(), assignedBefore, "failure must not open an emission round");
            if (kind == 6) ++undeliveredAnswers;
            else ++rejectedAnswers;
        }
        if (expected != HmmMine.Status.Asked) terminalStatus[id] = expected;
    }

    function _callbackArgs(uint256 id, HmmMine.Question memory q, uint8 kind)
        internal
        returns (bytes memory args, uint8 status, bytes32 oracleId)
    {
        SwarmOracleAdapter.Attestation memory a;
        a.requestId = keccak256(abi.encode("lifecycle oracle", ++nonce));
        a.chainId = 1;
        a.questionHash = keccak256(abi.encode(id));
        a.answer = abi.encode(kind != 1);
        a.panelSize = kind == 3 ? 4 : 5;
        a.quorum = 4;
        a.agreed = 4;
        a.issuedAt = uint64(block.timestamp);
        a.expiresAt = uint64(block.timestamp + 1 days);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(oraclePk, SwarmOracleAdapter(q.adapter).digest(a, block.chainid, q.adapter));
        bytes memory signature = kind == 2 ? bytes(hex"1234") : abi.encodePacked(r, s, v);
        status = kind == 4 ? 1 : kind == 5 ? 2 : 0;
        args = status == 0
            ? abi.encode(q.requestId, a, signature)
            : abi.encode(q.requestId, status, bytes32("disagreed"), uint16(2), uint16(5), bytes(""));
        if (kind == 6) args = hex"1234";
        oracleId = a.requestId;
    }

    function duplicateClaim(uint256 actorSeed, uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        address actor = actors[actorSeed % actors.length];
        uint256[] memory batch = new uint256[](4);
        batch[0] = id;
        batch[1] = type(uint256).max;
        batch[2] = id;
        batch[3] = 0;
        uint256 expected = mine.claimable(id, actor);
        uint256 beforeBalance = hmm.balanceOf(actor);
        vm.prank(actor);
        uint256 claimed = mine.claim(batch);
        ghostClaimed += claimed;
        assertEq(claimed, expected, "duplicates cannot collect a second reward");
        assertEq(hmm.balanceOf(actor) - beforeBalance, expected);
    }

    function donate(uint256 actorSeed, uint256 seed, bool payAsset) external {
        uint256 amount = bound(seed, 0, 1 ether);
        if (payAsset) {
            address actor = actors[actorSeed % actors.length];
            vm.prank(actor);
            imd.transfer(address(mine), amount);
            donatedIMD += amount;
        } else {
            vm.prank(pool);
            hmm.transfer(address(mine), amount);
            donatedHMM += amount;
        }
    }

    function tryChangingRules(uint256 seed) external {
        address caller = actors[seed % actors.length];
        address original = mine.adapter();
        vm.prank(caller);
        vm.expectRevert(HmmMine.NotSteward.selector);
        mine.setSteward(caller);
        vm.prank(caller);
        vm.expectRevert(HmmMine.NotSteward.selector);
        mine.queueConfig(caller, bytes32("other-action"));
        vm.prank(caller);
        vm.expectRevert(HmmMine.NotSteward.selector);
        mine.cancelConfig();
        vm.expectRevert(HmmMine.NothingQueued.selector);
        mine.applyConfig();
        assertEq(mine.adapter(), original);
    }

    function expireChecked(uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        if (mine.question(id).status != HmmMine.Status.Asked || block.timestamp <= mine.answerDeadline(id)) return;
        uint256 beforeAssigned = mine.assigned();
        mine.expire(id);
        terminalStatus[id] = HmmMine.Status.Failed;
        assertEq(mine.assigned(), beforeAssigned);
    }

    /// @dev Invoked only after a random sequence. All backers exercise all remaining withdrawal rights.
    function drain() external {
        vm.warp(block.timestamp + 8 days);
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];
            if (mine.question(id).status == HmmMine.Status.Asked) {
                mine.expire(id);
                terminalStatus[id] = HmmMine.Status.Failed;
            }
            for (uint256 j; j < actors.length; ++j) {
                address actor = actors[j];
                HmmMine.Question memory q = mine.question(id);
                if (mine.backing(id, actor) == 0) continue;
                if (q.status == HmmMine.Status.Open || (q.raised > q.target && !mine.surplusRefunded(id, actor))) {
                    vm.prank(actor);
                    mine.refund(id);
                }
            }
        }
        for (uint256 i; i < actors.length; ++i) {
            vm.prank(actors[i]);
            ghostClaimed += mine.claim(ids);
        }
        mine.payDev();
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 100
/// forge-config: default.invariant.fail-on-revert = true
contract OwnerlessMineLifecycleInvariantTest is OwnerlessMineTestBase {
    OwnerlessLifecycleHandler internal handler;
    uint256 internal originalGenesis;

    function setUp() public override {
        super.setUp();
        originalGenesis = mine.genesis();
        handler = new OwnerlessLifecycleHandler(mine, hmm, imd, intake, writer, owner, oraclePk, makeAddr("pool"));
        bytes4[] memory selectors = new bytes4[](12);
        selectors[0] = handler.propose.selector;
        selectors[1] = handler.back.selector;
        selectors[2] = handler.refund.selector;
        selectors[3] = handler.claim.selector;
        selectors[4] = handler.movePrice.selector;
        selectors[5] = handler.payDev.selector;
        selectors[6] = handler.warp.selector;
        selectors[7] = handler.settleChecked.selector;
        selectors[8] = handler.duplicateClaim.selector;
        selectors[9] = handler.donate.selector;
        selectors[10] = handler.tryChangingRules.selector;
        selectors[11] = handler.expireChecked.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_ownerlessRulesAndReserveRemainFixed() public view {
        assertEq(mine.steward(), address(0));
        assertEq(mine.adapter(), address(adapter));
        assertEq(adapter.mine(), address(mine));
        assertEq(mine.action(), ACTION);
        assertEq(mine.configVersion(), 0);
        assertEq(mine.pendingEta(), 0);
        assertEq(mine.pendingAdapter(), address(0));
        assertEq(mine.pendingAction(), bytes32(0));
        assertEq(mine.genesis(), originalGenesis);
        assertEq(mine.reserve(), RESERVE);
        assertEq(mine.baseRate(), RESERVE / (2 * ERA));
        assertEq(imd.allowance(address(mine), address(intake)), 0, "each ask approves only its price");
    }

    function invariant_tokensCoverEveryOutstandingObligation() public view {
        assertEq(hmm.totalSupply(), SUPPLY);
        assertEq(hmm.balanceOf(address(mine)) + mine.claimedTotal() + mine.devPaid(), RESERVE + handler.donatedHMM());
        assertEq(mine.claimedTotal(), handler.ghostClaimed());
        assertEq(hmm.balanceOf(dev), mine.devPaid());
        assertEq(mine.devPaid() + mine.devOwed(), mine.assigned() * DEV_BPS / 10_000);
        assertLe(mine.claimedTotal() + mine.devPaid() + mine.devOwed(), mine.assigned());
        assertLe(mine.assigned(), mine.emittedAt(mine.roundEnd(mine.currentRound())));
        assertLe(mine.assigned(), RESERVE);
        assertEq(imd.balanceOf(address(mine)), mine.openRaised() + mine.refundableSurplus() + handler.donatedIMD());
        assertEq(imd.balanceOf(payTo), handler.ghostPaidToSwarm());
        uint256 actorBalances;
        uint256 claimedBalances;
        for (uint256 i; i < handler.actorsLength(); ++i) {
            actorBalances += imd.balanceOf(handler.actors(i));
            claimedBalances += hmm.balanceOf(handler.actors(i));
        }
        assertEq(actorBalances + imd.balanceOf(address(mine)) + imd.balanceOf(payTo), handler.ghostMinted());
        assertEq(claimedBalances, mine.claimedTotal());
    }

    function invariant_questionLedgersAndTerminalStatesAreConsistent() public view {
        uint256 open;
        uint256 surplus;
        uint256 answered;
        for (uint256 i; i < handler.idsLength(); ++i) {
            uint256 id = handler.ids(i);
            HmmMine.Question memory q = mine.question(id);
            uint256 backingLeft;
            for (uint256 j; j < handler.actorsLength(); ++j) {
                backingLeft += mine.backing(id, handler.actors(j));
            }
            assertEq(backingLeft + mine.claimedBacking(id), q.raised);
            if (handler.terminalStatus(id) != HmmMine.Status.None) {
                assertEq(uint8(q.status), uint8(handler.terminalStatus(id)), "a terminal state never reopens");
            }
            if (q.status == HmmMine.Status.Open) {
                open += q.raised;
                assertEq(q.requestId, bytes32(0));
                assertLt(q.raised, q.target);
            } else {
                (uint128 refundedBacking, uint128 refunded) = mine.surplusRefunds(id);
                assertLe(refundedBacking, q.raised);
                assertLe(refunded, q.raised - q.target);
                surplus += q.raised - q.target - refunded;
                assertEq(mine.questionOf(q.requestId), id);
                assertEq(q.adapter, address(adapter));
            }
            if (q.status == HmmMine.Status.Answered) ++answered;
        }
        assertEq(open, mine.openRaised());
        assertEq(surplus, mine.refundableSurplus());
        assertEq(answered, handler.acceptedAnswers());
    }

    function afterInvariant() public {
        handler.drain();
        invariant_ownerlessRulesAndReserveRemainFixed();
        invariant_tokensCoverEveryOutstandingObligation();
        invariant_questionLedgersAndTerminalStatesAreConsistent();
        assertEq(mine.openRaised(), 0);
        assertEq(mine.refundableSurplus(), 0, "all unspent IMD can be recovered, including rounding dust");
        assertEq(imd.balanceOf(address(mine)), handler.donatedIMD());
        assertEq(mine.devOwed(), 0);
        for (uint256 i; i < handler.idsLength(); ++i) {
            uint256 id = handler.ids(i);
            HmmMine.Question memory q = mine.question(id);
            if (q.status != HmmMine.Status.Answered) continue;
            assertEq(mine.claimedBacking(id), q.raised);
            (uint128 shares, uint128 reward) = mine.rounds(q.round);
            (uint128 claimedShares, uint128 paid) = mine.roundClaims(q.round);
            assertEq(claimedShares, shares);
            assertEq(paid, reward, "all awarded HMM can be claimed");
        }
    }
}
