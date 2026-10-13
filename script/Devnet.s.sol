// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {GenesisForwarder} from "../src/GenesisForwarder.sol";
import {IProjectFactory} from "./IProjectFactory.sol";
import {HmmLaunch} from "./HmmLaunch.sol";

interface IIntakeView {
    function writer() external view returns (address);
}

/// @notice Launches hmm on a local anvil fork of mainnet exactly as the swarm would on mainnet: the real IMD
/// ProjectFactory (impersonating its launch wallet), the real registry, the real Intake and IMD. Only the oracle signer
/// is a local test key, so `devnet/swarm.mjs` can answer questions. Writes `deployments/devnet.json`.
///
/// Needs anvil started with `--auto-impersonate` (see devnet/start.sh); run with `--broadcast --unlocked`.
contract Devnet is Script {
    // anvil's default accounts
    address internal constant ACCOUNT0 = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address internal constant ACCOUNT1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant ACCOUNT2 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    /// @dev An externally owned IMD holder (68k IMD on 2026-10-12); a contract cannot send transactions on anvil.
    address internal constant IMD_HOLDER = 0xE54d6571aCa515614927F3A70B8957c2B511603C;
    uint64 internal constant LAUNCH = 990_777;

    function run() external {
        uint256 oraclePk = vm.envOr("DEVNET_ORACLE_KEY", uint256(keccak256("hmm devnet oracle")));
        IProjectFactory factory = IProjectFactory(HmmLaunch.PROJECT_FACTORY);

        vm.startBroadcast(ACCOUNT0);
        GenesisForwarder forwarder = new GenesisForwarder(HmmLaunch.LAUNCH_REGISTRY, HmmLaunch.MINE_NAME);
        vm.stopBroadcast();

        HmmLaunch.Roles memory roles = HmmLaunch.Roles({
            forwarder: address(forwarder),
            steward: address(0), // as on mainnet: nobody can change the rules
            dev: ACCOUNT2,
            oracleSigner: vm.addr(oraclePk),
            intake: HmmLaunch.INTAKE,
            imd: HmmLaunch.IMD
        });
        (IProjectFactory.CustomParams memory c, HmmLaunch.Plan memory p) =
            HmmLaunch.rehearsalParams(factory, LAUNCH, roles, ACCOUNT2);

        vm.startBroadcast(factory.deployer());
        factory.launchCustom(c);
        vm.stopBroadcast();

        vm.startBroadcast(ACCOUNT0);
        forwarder.forward(LAUNCH);
        vm.stopBroadcast();

        // 500 IMD to each of anvil's first five accounts, from an IMD holder
        vm.startBroadcast(IMD_HOLDER);
        for (uint256 i; i < 5; ++i) {
            address to = vm.addr(vm.deriveKey("test test test test test test test test test test test junk", uint32(i)));
            IERC20(HmmLaunch.IMD).transfer(to, 500 ether);
        }
        vm.stopBroadcast();

        string memory o = "devnet";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeString(o, "rpcUrl", vm.envOr("DEVNET_RPC_URL", string("http://127.0.0.1:9645")));
        vm.serializeUint(o, "launchNumber", LAUNCH);
        vm.serializeAddress(o, "hmm", p.token);
        vm.serializeAddress(o, "mine", p.mine);
        vm.serializeAddress(o, "adapter", p.adapter);
        vm.serializeAddress(o, "forwarder", address(forwarder));
        vm.serializeAddress(o, "imd", HmmLaunch.IMD);
        vm.serializeAddress(o, "intake", HmmLaunch.INTAKE);
        vm.serializeAddress(o, "intakeWriter", IIntakeView(HmmLaunch.INTAKE).writer());
        vm.serializeAddress(o, "oracleSigner", vm.addr(oraclePk));
        vm.serializeAddress(o, "steward", address(0));
        vm.serializeAddress(o, "dev", ACCOUNT2);
        vm.serializeString(
            o,
            "faucet",
            "anvil accounts 0-4 (mnemonic: test test test test test test test test test test test junk) hold 500 IMD each"
        );
        string memory json = vm.serializeUint(o, "deployBlock", block.number);
        vm.writeJson(json, "./deployments/devnet.json");
        console2.log("hmm devnet: mine", p.mine, "token", p.token);
    }
}
