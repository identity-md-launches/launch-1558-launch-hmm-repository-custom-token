// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HmmTestBase} from "./HmmTestBase.sol";
import {MockIMD, MockRegistry} from "./Mocks.sol";
import {Intake} from "../external/Intake.sol";
import {HmmToken} from "src/HmmToken.sol";
import {HmmMine} from "src/HmmMine.sol";
import {SwarmOracleAdapter} from "src/SwarmOracleAdapter.sol";
import {GenesisForwarder} from "src/GenesisForwarder.sol";
import {ILaunchRegistry} from "src/interfaces/ILaunchRegistry.sol";

/// @dev Reuses the existing protocol callback helpers, deploying the production mine with no storage overrides.
abstract contract OwnerlessMineTestBase is HmmTestBase {
    function setUp() public virtual override {
        vm.chainId(1);
        vm.warp(1_800_000_000);
        oracleSigner = vm.addr(oraclePk);
        imd = new MockIMD();
        intake = new Intake(owner, payTo, writer, makeAddr("quoteSigner"));
        vm.prank(owner);
        intake.setPrice(ACTION, address(imd), PRICE);
        registry = new MockRegistry();
        forwarder = new GenesisForwarder(address(registry), "HmmMine");

        vm.startPrank(factory);
        hmm = new HmmToken();
        adapter = new SwarmOracleAdapter(address(intake), oracleSigner, 5, 4);
        mine = new HmmMine(
            address(hmm),
            address(imd),
            address(intake),
            ACTION,
            address(forwarder),
            address(adapter),
            dev,
            DEV_BPS,
            ROUND,
            ERA,
            0
        );
        hmm.transfer(makeAddr("distributor"), SWARM_SHARE);
        hmm.transfer(makeAddr("pool"), POOL_SHARE);
        hmm.transfer(address(forwarder), RESERVE);
        vm.stopPrank();

        ILaunchRegistry.Artifact[] memory artifacts = new ILaunchRegistry.Artifact[](3);
        artifacts[0] = ILaunchRegistry.Artifact("token", "HmmToken", address(hmm));
        artifacts[1] = ILaunchRegistry.Artifact("other", "SwarmOracleAdapter", address(adapter));
        artifacts[2] = ILaunchRegistry.Artifact("other", "HmmMine", address(mine));
        registry.record(LAUNCH, "custom_token", artifacts);
        forwarder.forward(LAUNCH);
        address[3] memory actors = [alice, bob, carol];
        for (uint256 i; i < actors.length; ++i) {
            imd.mint(actors[i], 1_000 ether);
            vm.prank(actors[i]);
            imd.approve(address(mine), type(uint256).max);
        }
    }
}
