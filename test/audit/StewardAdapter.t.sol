// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HmmMineStewarded} from "../utils/HmmMineStewarded.sol";
import {HmmTestBase} from "../utils/HmmTestBase.sol";
import {HmmMine} from "../../src/HmmMine.sol";
import {IHmmMine} from "../../src/interfaces/IHmmMine.sol";
import {HmmToken} from "../../src/HmmToken.sol";
import {SwarmOracleAdapter} from "../../src/SwarmOracleAdapter.sol";

/// @dev Any contract with `bind`, `mine` and `callbackSelectors` passes `applyConfig`. This one credits on demand.
contract RogueAdapter {
    address public mine;
    address internal immutable owner;

    constructor() {
        owner = msg.sender;
    }

    function bind() external {
        mine = msg.sender;
    }

    function callbackSelectors() external pure returns (bytes4, bytes4) {
        return (bytes4(0x510379c7), bytes4(0xa7980e31));
    }

    function creditNow(bytes32 requestId) external {
        require(msg.sender == owner);
        IHmmMine(mine).credit(requestId); // no oracle, no Intake completion
    }

    function failNow(bytes32 requestId) external {
        require(msg.sender == owner);
        IHmmMine(mine).fail(requestId, 2, "no");
    }
}

contract AuditStewardAdapterTest is HmmTestBase {
    /// DOCUMENTED POWER (audit finding 1): why hmm launches with no steward. A steward rotates to its own adapter. Three days later it can mine the
    /// whole rolled-over emission with one 0.5 IMD question that nobody answered, and fail everyone else's.
    function test_audit_stewardAdapter_capturesEmissionWithoutAnswers() public {
        vm.prank(steward);
        RogueAdapter rogue = new RogueAdapter();
        vm.prank(steward);
        mine.queueConfig(address(rogue), ACTION);
        vm.warp(block.timestamp + 3 days);
        mine.applyConfig();
        assertEq(mine.adapter(), address(rogue));

        // an honest miner's question, asked through the rogue adapter, is failed at will
        (uint256 honest, bytes32 ridHonest) = _ask(alice, "honest question");
        vm.prank(steward);
        rogue.failNow(ridHonest);
        assertEq(uint8(_status(honest)), uint8(HmmMine.Status.Failed));

        // 30 days with no credited answer, then one unanswered steward question takes everything since genesis
        vm.warp(block.timestamp + 30 days);
        imd.mint(steward, PRICE);
        vm.startPrank(steward);
        imd.approve(address(mine), PRICE);
        uint256 id = mine.propose(_spec("anything"), PRICE);
        rogue.creditNow(mine.question(id).requestId);
        vm.stopPrank();
        (,, bytes4 sel, bool completed) = intake.requests(mine.question(id).requestId);
        sel;
        assertFalse(completed, "the Intake never completed it: no answer exists");

        _warpPastRound(id);
        vm.prank(steward);
        uint256 got = mine.claim(_ids(id));
        emit log_named_uint("HMM taken for 0.5 IMD, no oracle answer (whole tokens)", got / 1e18);
        assertGt(got, mine.reserve() / 12, "33 days of era-0 emission (~9% of the reserve) to one unanswered question");
    }

    /// With no steward (the launch configuration), the rules can never change.
    function test_noSteward_rulesAreFixedForever() public {
        (,, HmmMine m) = _launchWithSteward(LAUNCH + 9, address(0));
        assertEq(m.steward(), address(0));
        vm.expectRevert(HmmMine.NotSteward.selector);
        m.queueConfig(address(1), ACTION);
        vm.prank(address(0));
        vm.expectRevert(HmmMine.NothingQueued.selector);
        m.applyConfig();
        vm.expectRevert(HmmMine.NotSteward.selector);
        m.setSteward(alice);
    }

    function _launchWithSteward(uint64 n, address stewardAddr)
        internal
        returns (HmmToken token, SwarmOracleAdapter a, HmmMine m)
    {
        vm.startPrank(factory);
        token = new HmmToken();
        a = new SwarmOracleAdapter(address(intake), oracleSigner, 5, 4);
        m = new HmmMineStewarded(
            address(token),
            address(imd),
            address(intake),
            ACTION,
            address(forwarder),
            address(a),
            stewardAddr,
            dev,
            DEV_BPS,
            ROUND,
            ERA,
            0
        );
        vm.stopPrank();
        n;
    }
}
