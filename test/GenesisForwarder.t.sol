// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HmmTestBase} from "./utils/HmmTestBase.sol";
import {MockToken} from "./utils/Mocks.sol";
import {GenesisForwarder} from "../src/GenesisForwarder.sol";
import {HmmMine} from "../src/HmmMine.sol";
import {HmmToken} from "../src/HmmToken.sol";
import {SwarmOracleAdapter} from "../src/SwarmOracleAdapter.sol";
import {ILaunchRegistry} from "../src/interfaces/ILaunchRegistry.sol";

contract GenesisForwarderTest is HmmTestBase {
    function test_forward_movesTheWholeRemainderAndStarts() public {
        (HmmToken t,, HmmMine m) = _launch(LAUNCH + 1, 0);
        uint256 held = t.balanceOf(address(forwarder));
        assertEq(held, RESERVE);
        vm.expectEmit(true, true, true, true, address(forwarder));
        emit GenesisForwarder.Forwarded(LAUNCH + 1, address(t), address(m), RESERVE);
        assertEq(forwarder.forward(LAUNCH + 1), RESERVE);
        assertEq(t.balanceOf(address(m)), RESERVE);
        assertEq(m.reserve(), RESERVE);
        assertTrue(m.started());
    }

    function test_forward_onlyOncePerMine() public {
        vm.expectRevert(abi.encodeWithSelector(GenesisForwarder.NothingHeld.selector, address(hmm)));
        forwarder.forward(LAUNCH);
        // even if more of the token arrives later, the mine will not restart
        vm.prank(makeAddr("pool"));
        hmm.transfer(address(forwarder), 1 ether);
        vm.expectRevert(HmmMine.AlreadyStarted.selector);
        forwarder.forward(LAUNCH);
    }

    function test_forward_refusesOtherLaunchKinds() public {
        ILaunchRegistry.Artifact[] memory arts = new ILaunchRegistry.Artifact[](0);
        registry.record(7, "evm_contracts", arts);
        vm.expectRevert(abi.encodeWithSelector(GenesisForwarder.NotCustomTokenLaunch.selector, uint64(7)));
        forwarder.forward(7);
    }

    function test_forward_refusesALaunchWithoutAMine() public {
        ILaunchRegistry.Artifact[] memory arts = new ILaunchRegistry.Artifact[](1);
        arts[0] = ILaunchRegistry.Artifact("token", "HmmToken", address(hmm));
        registry.record(8, "custom_token", arts);
        vm.expectRevert(abi.encodeWithSelector(GenesisForwarder.MissingArtifact.selector, uint64(8)));
        forwarder.forward(8);
    }

    function test_forward_refusesAMineOfAnotherToken() public {
        MockToken other = new MockToken("OTHER", 1 ether);
        ILaunchRegistry.Artifact[] memory arts = new ILaunchRegistry.Artifact[](2);
        arts[0] = ILaunchRegistry.Artifact("token", "OTHER", address(other));
        arts[1] = ILaunchRegistry.Artifact("other", "HmmMine", address(mine));
        registry.record(9, "custom_token", arts);
        vm.expectRevert(abi.encodeWithSelector(GenesisForwarder.WrongMine.selector, address(mine)));
        forwarder.forward(9);
    }

    function test_forward_refusesAMineOfAnotherForwarder() public {
        GenesisForwarder otherForwarder = new GenesisForwarder(address(registry), "HmmMine");
        vm.expectRevert(abi.encodeWithSelector(GenesisForwarder.WrongMine.selector, address(mine)));
        otherForwarder.forward(LAUNCH);
    }

    /// @dev A copycat launch names our forwarder as its remainderTo and races to forward first. Each launch can only
    /// ever move its own token into its own mine, so ours is untouched.
    function test_copycatLaunch_cannotTouchTheRealReserve() public {
        // the real launch lands: its remainder sits in the forwarder
        (HmmToken real,, HmmMine realMine) = _launch(LAUNCH + 2, 0);
        // a copycat launches the same code with its own token, also sending its remainder here
        (HmmToken fake,, HmmMine fakeMine) = _launch(LAUNCH + 3, 0);
        assertEq(real.balanceOf(address(forwarder)), RESERVE);
        assertEq(fake.balanceOf(address(forwarder)), RESERVE);

        forwarder.forward(LAUNCH + 3); // the copycat goes first
        assertEq(fake.balanceOf(address(fakeMine)), RESERVE);
        assertEq(real.balanceOf(address(forwarder)), RESERVE, "real reserve untouched");

        forwarder.forward(LAUNCH + 2);
        assertEq(real.balanceOf(address(realMine)), RESERVE);
        assertTrue(realMine.started());
    }

    /// @dev A launch that lists a contract named "HmmMine" pointing at some other launch's mine is refused.
    function test_crossWiredLaunch_isRefused() public {
        (,, HmmMine realMine) = _launch(LAUNCH + 4, 0);
        MockToken attackerToken = new MockToken("ATK", 1 ether);
        attackerToken.transfer(address(forwarder), 1 ether);
        ILaunchRegistry.Artifact[] memory arts = new ILaunchRegistry.Artifact[](2);
        arts[0] = ILaunchRegistry.Artifact("token", "ATK", address(attackerToken));
        arts[1] = ILaunchRegistry.Artifact("other", "HmmMine", address(realMine));
        registry.record(LAUNCH + 5, "custom_token", arts);
        vm.expectRevert(abi.encodeWithSelector(GenesisForwarder.WrongMine.selector, address(realMine)));
        forwarder.forward(LAUNCH + 5);
    }

    function test_constructor_validates() public {
        vm.expectRevert(GenesisForwarder.ZeroAddress.selector);
        new GenesisForwarder(address(0), "HmmMine");
        vm.expectRevert(GenesisForwarder.ZeroAddress.selector);
        new GenesisForwarder(address(registry), bytes32(0));
    }
}
