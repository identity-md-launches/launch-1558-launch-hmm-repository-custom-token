// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {HmmTestBase} from "./utils/HmmTestBase.sol";
import {HmmToken} from "../src/HmmToken.sol";
import {HmmMine} from "../src/HmmMine.sol";
import {SwarmOracleAdapter} from "../src/SwarmOracleAdapter.sol";
import {HmmLaunch} from "../script/HmmLaunch.sol";

/// @notice The mine as it launches: it takes no steward argument, so nobody can ever change its adapter or action id;
/// the adapter takes no mine argument and is claimed by the mine's constructor; and no launch argument is the zero
/// address (IMD's launch checker refuses zero-address constructor arguments).
contract NoStewardTest is HmmTestBase {
    function _realMine() internal returns (HmmMine m, SwarmOracleAdapter a) {
        vm.startPrank(factory);
        HmmToken token = new HmmToken();
        a = new SwarmOracleAdapter(address(intake), oracleSigner, 5, 4);
        m = new HmmMine(
            address(token), address(imd), address(intake), ACTION, address(forwarder), address(a), dev, DEV_BPS, ROUND, ERA, 0
        );
        vm.stopPrank();
    }

    function test_realMine_hasNoSteward_andNobodyCanNameOne() public {
        (HmmMine m, SwarmOracleAdapter a) = _realMine();
        assertEq(m.steward(), address(0));
        assertEq(a.mine(), address(m), "the mine claimed its adapter in its constructor");

        SwarmOracleAdapter next = new SwarmOracleAdapter(address(intake), oracleSigner, 5, 4);
        address[4] memory who = [alice, dev, factory, address(forwarder)];
        for (uint256 i; i < who.length; ++i) {
            vm.prank(who[i]);
            vm.expectRevert(HmmMine.NotSteward.selector);
            m.queueConfig(address(next), ACTION);
            vm.prank(who[i]);
            vm.expectRevert(HmmMine.NotSteward.selector);
            m.setSteward(who[i]);
            vm.prank(who[i]);
            vm.expectRevert(HmmMine.NotSteward.selector);
            m.cancelConfig();
        }
        vm.expectRevert(HmmMine.NothingQueued.selector);
        m.applyConfig();
        assertEq(m.adapter(), address(a));
        assertEq(m.configVersion(), 0);
    }

    function test_adapter_cannotBeClaimedOnceTheMineHasIt() public {
        (HmmMine m, SwarmOracleAdapter a) = _realMine();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SwarmOracleAdapter.AlreadyBound.selector, address(m)));
        a.bind();
    }

    function test_launchArgs_haveNoZeroAddress() public view {
        HmmLaunch.Roles memory r = HmmLaunch.mainnetRoles(address(forwarder), address(0), dev);

        bytes memory adapterArgs = HmmLaunch.adapterArgs(r);
        assertEq(adapterArgs.length, 4 * 32, "adapter: intake, signer, minPanel, minQuorum");
        uint256[4] memory a = abi.decode(adapterArgs, (uint256[4]));
        assertTrue(a[0] != 0 && a[1] != 0, "adapter address arguments are nonzero");

        bytes memory mineArgs = HmmLaunch.mineArgs(r, address(0x1111), address(0x2222));
        assertEq(mineArgs.length, 11 * 32, "mine: no steward argument");
        uint256[11] memory w = abi.decode(mineArgs, (uint256[11]));
        uint8[6] memory addressSlots = [0, 1, 2, 4, 5, 6]; // hmm, imd, intake, forwarder, adapter, dev
        for (uint256 i; i < addressSlots.length; ++i) {
            assertTrue(w[addressSlots[i]] != 0, "mine address arguments are nonzero");
        }
        assertEq(address(uint160(w[4])), address(forwarder));
        assertEq(address(uint160(w[6])), dev);
    }
}
