// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {GenesisForwarder} from "../src/GenesisForwarder.sol";
import {HmmLaunch} from "./HmmLaunch.sol";

/// @notice Deploys the GenesisForwarder, the launch's `remainderTo`. Must exist before the launch is requested.
/// It is the deployer wallet's FIRST transaction, so its address is known in advance:
///   cast compute-address <deployer> --nonce 0
///
/// forge script script/DeployForwarder.s.sol --rpc-url $MAINNET_RPC_URL \
///   --account hmm-deployer --password-file ~/.hmm/hmm-deployer.password --broadcast
contract DeployForwarder is Script {
    function run() external returns (GenesisForwarder forwarder) {
        // The launch request names the forwarder's address in advance; refuse to deploy anywhere else.
        address expected =
            vm.envOr("EXPECTED_FORWARDER", vm.parseJsonAddress(vm.readFile("launch/config.json"), ".forwarder"));
        vm.startBroadcast();
        (, address sender,) = vm.readCallers();
        require(vm.getNonce(sender) == 0, "deployer has already sent a transaction: the forwarder would land elsewhere");
        require(vm.computeCreateAddress(sender, 0) == expected, "deployer does not match launch/config.json");
        forwarder = new GenesisForwarder(HmmLaunch.LAUNCH_REGISTRY, HmmLaunch.MINE_NAME);
        vm.stopBroadcast();
        require(address(forwarder) == expected, "forwarder address");
        require(address(forwarder.registry()) == HmmLaunch.LAUNCH_REGISTRY, "registry");
        require(forwarder.mineName() == HmmLaunch.MINE_NAME, "mine name");
        console2.log("GenesisForwarder", address(forwarder));
    }
}
