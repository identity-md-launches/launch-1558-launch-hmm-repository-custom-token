// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {HmmTestBase} from "../utils/HmmTestBase.sol";
import {HmmMine} from "../../src/HmmMine.sol";
import {Intake} from "../external/Intake.sol";

/// @dev The completing backer of someone else's pooled question, wrapped in a transaction that first makes its own
/// Intake request. The mine's transient flag only remembers the mine's own asks, so it does not notice.
contract BundledCompleter {
    function run(
        Intake intake,
        HmmMine mine,
        IERC20 imd,
        bytes32 action,
        bytes calldata ownBody,
        uint256 victimId,
        bytes calldata victimBody
    ) external {
        uint256 price = intake.priceOf(action, address(imd));
        imd.approve(address(intake), price);
        imd.approve(address(mine), type(uint256).max);
        // 1. any request first (here: the attacker's own question, which the plane will serve)
        intake.request(action, ownBody, Intake.Callback(address(0), bytes4(0)), address(imd), price);
        // 2. complete the victim's question: the mine's paid request is the 2nd `Requested` of this transaction
        mine.back(victimId, type(uint256).max, victimBody);
    }
}

contract AuditForeignRequestFirstTest is HmmTestBase {
    /// REGRESSION (audit finding 4): completing a pooled question from a contract that first made its own Intake
    /// request in the same transaction would leave the mine's request second, never served. Completions of questions
    /// holding other backers' IMD must now come straight from an account, so the bundle reverts as a whole.
    function test_audit_foreignRequestBeforeTheAsk_isRefused() public {
        bytes memory body = _body("pooled question");
        vm.prank(alice, alice);
        uint256 id = mine.propose(_spec("pooled question"), 0.3 ether);
        vm.prank(bob, bob);
        mine.back(id, 0.19 ether, "");

        BundledCompleter c = new BundledCompleter();
        imd.mint(address(c), PRICE + 0.01 ether);
        bytes memory own = _body("attacker's own question");
        vm.expectRevert(HmmMine.CompleterMustBeEOA.selector);
        c.run(intake, mine, IERC20(address(imd)), ACTION, own, id, body);

        HmmMine.Question memory q = mine.question(id);
        assertEq(uint8(q.status), uint8(HmmMine.Status.Open), "still open: nothing was spent");
        assertEq(imd.balanceOf(payTo), 0);
        // an honest account completes it normally
        vm.prank(carol, carol);
        mine.back(id, 1 ether, body);
        assertEq(uint8(mine.question(id).status), uint8(HmmMine.Status.Asked));
    }
}
