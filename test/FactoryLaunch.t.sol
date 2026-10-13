// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HmmToken} from "../src/HmmToken.sol";
import {HmmMine} from "../src/HmmMine.sol";
import {SwarmOracleAdapter} from "../src/SwarmOracleAdapter.sol";

/// @dev Mirrors the factory's ordered CREATE2 deployment, without code at any live external dependency.
contract EmptyChainLaunchFactory {
    function deploy() external returns (HmmToken token, SwarmOracleAdapter adapter, HmmMine mine) {
        token = new HmmToken{salt: bytes32(uint256(1))}();
        adapter = new SwarmOracleAdapter{salt: bytes32(uint256(2))}(
            0xa43e6F75ee006411F79Ac1C84120606C2330DE82, 0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982, 5, 4
        );
        mine = new HmmMine{salt: bytes32(uint256(3))}(
            address(token),
            0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7,
            0xa43e6F75ee006411F79Ac1C84120606C2330DE82,
            0x6f7261636c652e72657175657374406f7261636c652d31000000000000000000,
            0x876C2FB3eAa91D32Ef03186853bB82433b949a71,
            address(adapter),
            0x39C593c1bC4d91E42d797456077586f6058eBf67,
            500,
            600,
            15552000,
            0
        );
    }
}

contract FactoryLaunchTest is Test {
    function test_exactLaunchArgumentsDeployAtomicallyWithoutExternalCodeOrTokenMovements() public {
        vm.chainId(1);
        assertEq(address(0xa43e6F75ee006411F79Ac1C84120606C2330DE82).code.length, 0);
        assertEq(address(0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7).code.length, 0);
        assertEq(address(0x876C2FB3eAa91D32Ef03186853bB82433b949a71).code.length, 0);
        EmptyChainLaunchFactory factory = new EmptyChainLaunchFactory();
        (HmmToken token, SwarmOracleAdapter adapter, HmmMine mine) = factory.deploy();
        assertEq(token.name(), "hmm");
        assertEq(token.symbol(), "HMM");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1000000000000000000000000000);
        assertEq(token.balanceOf(address(factory)), token.totalSupply());
        assertEq(token.balanceOf(address(mine)), 0);
        assertEq(token.balanceOf(address(adapter)), 0);
        assertEq(adapter.mine(), address(mine));
        assertEq(adapter.signer(), 0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982);
        assertEq(adapter.minPanel(), 5);
        assertEq(adapter.minQuorum(), 4);
        assertEq(mine.token(), address(token));
        assertEq(mine.forwarder(), 0x876C2FB3eAa91D32Ef03186853bB82433b949a71);
        assertEq(mine.dev(), 0x39C593c1bC4d91E42d797456077586f6058eBf67);
        assertEq(mine.devBps(), 500);
        assertEq(mine.roundLength(), 600);
        assertEq(mine.eraLength(), 15552000);
        assertEq(mine.genesisDelay(), 0);
        assertEq(mine.action(), bytes32("oracle.request@oracle-1"));
        assertEq(mine.steward(), address(0));
        assertFalse(mine.started());
        assertLe(address(mine).code.length, 24_576);
        assertLe(address(adapter).code.length, 24_576);
        assertLe(address(token).code.length, 24_576);
        vm.expectRevert(abi.encodeWithSelector(SwarmOracleAdapter.AlreadyBound.selector, address(mine)));
        adapter.bind();
    }
}
