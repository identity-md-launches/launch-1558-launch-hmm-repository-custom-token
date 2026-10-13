// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HmmTestBase} from "../utils/HmmTestBase.sol";
import {HmmMine} from "../../src/HmmMine.sol";
import {SwarmOracleAdapter} from "../../src/SwarmOracleAdapter.sol";

/// @notice AUDIT: `_ask` reads `adapter` and `action` at completion time. FUNDING_WINDOW == CONFIG_DELAY, so a
/// question proposed in the same second as `queueConfig` (deadline == eta) can still be completed at eta, after
/// `applyConfig`, and is asked under the new action id and adapter its body and backers never saw.
contract AuditConfigBoundaryTest is HmmTestBase {
    /// REGRESSION (audit finding 5): a question proposed before a config change can no longer be asked under the
    /// new adapter or action id its backers never saw; it stays open and its backers take their IMD back.
    function test_audit_questionProposedBeforeQueue_refusesTheNewConfig() public {
        bytes memory body = _body("written for oracle-1 and the 5/4 adapter");
        vm.prank(alice, alice);
        uint256 id = mine.propose(_spec("written for oracle-1 and the 5/4 adapter"), 0.25 ether);

        SwarmOracleAdapter next = new SwarmOracleAdapter(address(intake), oracleSigner, 7, 6);
        bytes32 nextAction = bytes32("oracle.request@oracle-2");
        vm.prank(owner);
        intake.setPrice(nextAction, address(imd), PRICE);
        vm.prank(steward);
        mine.queueConfig(address(next), nextAction);

        vm.warp(mine.pendingEta());
        assertEq(block.timestamp, mine.question(id).deadline, "deadline == eta");
        mine.applyConfig();
        assertEq(mine.configVersion(), 1);
        vm.prank(bob, bob);
        vm.expectRevert(HmmMine.ConfigChanged.selector);
        mine.back(id, 1 ether, body);

        vm.warp(block.timestamp + 1);
        uint256 before = imd.balanceOf(alice);
        vm.prank(alice, alice);
        mine.refund(id);
        assertEq(imd.balanceOf(alice) - before, 0.25 ether, "the backer gets the IMD back");

        // questions proposed after the change use the new config
        (uint256 fresh,) = _ask(carol, "asked under the new config");
        assertEq(mine.question(fresh).adapter, address(next));
    }
}
