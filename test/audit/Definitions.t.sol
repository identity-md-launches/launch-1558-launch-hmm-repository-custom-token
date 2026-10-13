// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HmmTestBase} from "../utils/HmmTestBase.sol";
import {HmmMine} from "../../src/HmmMine.sol";

/// @notice 25d530230732: callers can now pin meanings without supplying arbitrary oracle JSON.
contract DefinitionsTest is HmmTestBase {
    function _definitions() internal pure returns (HmmMine.Definition[] memory d) {
        d = new HmmMine.Definition[](2);
        d[0] = HmmMine.Definition(
            "Transfer event",
            "An ERC-20 Transfer(address,address,uint256) log emitted by the named token; include zero amounts, mints and burns."
        );
        d[1] = HmmMine.Definition(
            "in the window",
            "Include both endpoints of the resolved block window on Ethereum mainnet; count logs on the canonical chain only."
        );
    }

    function test_definitionsAppearInTheCommittedBodyAndCannotBeChangedByCompleter() public {
        HmmMine.Spec memory spec = _spec("Did the named token have more than one Transfer event in the window?");
        HmmMine.Definition[] memory d = _definitions();
        bytes memory body = mine.bodyWithDefinitions(spec, d);
        assertEq(vm.parseJsonString(string(body), ".definitions['Transfer event']"), d[0].value);
        assertEq(vm.parseJsonString(string(body), ".definitions['in the window']"), d[1].value);
        assertEq(vm.parseJsonUint(string(body), ".panelSize"), 5);
        assertEq(vm.parseJsonUint(string(body), ".quorum"), 4);
        assertFalse(vm.keyExistsJson(string(body), ".allowAmbiguous"), "wording screen remains enabled");
        vm.prank(alice, alice);
        uint256 id = mine.proposeWithDefinitions(spec, d, 0.3 ether);
        assertEq(mine.question(id).bodyHash, keccak256(body));
        bytes memory missing = mine.bodyOf(spec);
        vm.prank(bob, bob);
        vm.expectRevert(HmmMine.BodyMismatch.selector);
        mine.back(id, 0.2 ether, missing);
        d[0].value = "A different meaning";
        bytes memory changed = mine.bodyWithDefinitions(spec, d);
        vm.prank(bob, bob);
        vm.expectRevert(HmmMine.BodyMismatch.selector);
        mine.back(id, 0.2 ether, changed);
        vm.prank(bob, bob);
        mine.back(id, 0.2 ether, body);
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Asked));
        assertTrue(_answer(mine.question(id).requestId));
    }

    function test_emptyDefinitionsPreserveTheExistingBodyAndSoloFlow() public {
        HmmMine.Definition[] memory d = new HmmMine.Definition[](0);
        assertEq(mine.bodyWithDefinitions(_spec("q"), d), mine.bodyOf(_spec("q")));
        vm.prank(alice, alice);
        uint256 id = mine.proposeWithDefinitions(_spec("q"), d, PRICE);
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Asked));
        assertEq(imd.balanceOf(payTo), PRICE);
    }

    function test_definitionsRejectInjectionDuplicatesAndOversizedInput() public {
        HmmMine.Definition[] memory d = _definitions();
        string[7] memory invalid = [
            string('x","consumer":"foreign'),
            "back\\slash",
            "line\nbreak",
            unicode"caf\u00e9",
            "",
            string(new bytes(65)),
            string(hex"7f")
        ];
        for (uint256 i; i < invalid.length; ++i) {
            d[0].key = invalid[i];
            vm.expectRevert(HmmMine.BadDefinitions.selector);
            mine.bodyWithDefinitions(_spec("q"), d);
            d = _definitions();
            d[0].value = i == 5 ? _repeat(513) : invalid[i];
            vm.expectRevert(HmmMine.BadDefinitions.selector);
            mine.bodyWithDefinitions(_spec("q"), d);
            d = _definitions();
        }
        d[1].key = d[0].key;
        vm.expectRevert(HmmMine.BadDefinitions.selector);
        mine.bodyWithDefinitions(_spec("q"), d);
        d = new HmmMine.Definition[](17);
        vm.expectRevert(HmmMine.BadDefinitions.selector);
        mine.bodyWithDefinitions(_spec("q"), d);
        d = _definitions();
        vm.prank(alice, alice);
        vm.expectRevert(HmmMine.BadQuestion.selector);
        mine.proposeWithDefinitions(_spec("bad\\question"), d, PRICE);
        assertEq(mine.questionCount(), 0);
        assertEq(imd.balanceOf(payTo), 0);
    }

    function test_maximumDefinitionsAndQuestionFitThePaidBodyLimit() public {
        HmmMine.Definition[] memory d = new HmmMine.Definition[](16);
        for (uint256 i; i < d.length; ++i) {
            // 63 ASCII bytes followed by one unique printable character.
            d[i] = HmmMine.Definition(
                string.concat(_repeat(63), string(abi.encodePacked(bytes1(uint8(65 + i))))), _repeat(512)
            );
        }
        HmmMine.Spec memory spec = _spec(_repeat(2000));
        bytes memory body = mine.bodyWithDefinitions(spec, d);
        assertLt(body.length, 16 * 1024);
        assertEq(vm.parseJsonString(string(body), string.concat(".definitions.", d[15].key)), d[15].value);
        vm.prank(alice, alice);
        uint256 id = mine.proposeWithDefinitions(spec, d, PRICE);
        assertEq(mine.question(id).bodyHash, keccak256(body));
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Asked));
    }

    function test_wordingRefusalStillSpendsTheIntakePriceAndMinesNothing() public {
        HmmMine.Definition[] memory d = _definitions();
        vm.prank(alice, alice);
        uint256 id = mine.proposeWithDefinitions(_spec("A question may still be refused"), d, PRICE);
        assertTrue(_failure(mine.question(id).requestId, 1, "body_refused"));
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Failed));
        assertEq(imd.balanceOf(payTo), PRICE);
        assertEq(mine.assigned(), 0);
        vm.prank(alice);
        vm.expectRevert(HmmMine.NotRefundable.selector);
        mine.refund(id);
    }

    function _repeat(uint256 n) internal pure returns (string memory) {
        bytes memory s = new bytes(n);
        for (uint256 i; i < n; ++i) {
            s[i] = "x";
        }
        return string(s);
    }
}
