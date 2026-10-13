// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockRegistry, MockIMD} from "../utils/Mocks.sol";
import {HmmToken} from "src/HmmToken.sol";
import {HmmMine} from "src/HmmMine.sol";
import {SwarmOracleAdapter} from "src/SwarmOracleAdapter.sol";
import {GenesisForwarder} from "src/GenesisForwarder.sol";
import {ILaunchRegistry} from "src/interfaces/ILaunchRegistry.sol";

/// @notice Three launches share a forwarder. The ledger tracks each token independently across interleaved calls.
contract ForwarderReservesHandler is Test {
    uint256 public constant SUPPLY = 1_000_000_000 ether;
    uint256 public constant REMAINDER = SUPPLY * 6500 / 10_000;
    uint256 public constant ERA = 180 days;
    GenesisForwarder public immutable forwarder;
    MockRegistry public immutable registry;
    HmmToken[3] public tokens;
    HmmMine[3] public mines;
    uint256[3] public held;
    uint256[3] public forwarded;
    uint256[3] public initialReserve;
    uint256[3] public initialGenesis;
    uint256[3] public donated;

    constructor() {
        registry = new MockRegistry();
        forwarder = new GenesisForwarder(address(registry), "HmmMine");
        MockIMD imd = new MockIMD();
        address intake = makeAddr("forwarder test intake");
        address signer = makeAddr("forwarder test signer");
        address dev = makeAddr("forwarder test dev");
        for (uint256 i; i < 3; ++i) {
            tokens[i] = new HmmToken();
            SwarmOracleAdapter adapter = new SwarmOracleAdapter(intake, signer, 5, 4);
            mines[i] = new HmmMine(
                address(tokens[i]),
                address(imd),
                intake,
                bytes32("oracle.request@oracle-1"),
                address(forwarder),
                address(adapter),
                dev,
                500,
                600,
                ERA,
                0
            );
            tokens[i].transfer(address(forwarder), REMAINDER);
            held[i] = REMAINDER;
            _record(uint64(i + 1), "custom_token", address(tokens[i]), address(mines[i]));
        }
        _record(10, "custom_token", address(tokens[0]), address(mines[1]));
        _record(11, "custom_token", address(tokens[1]), address(mines[2]));
        _record(12, "evm_contracts", address(tokens[2]), address(mines[2]));
        ILaunchRegistry.Artifact[] memory missing = new ILaunchRegistry.Artifact[](1);
        missing[0] = ILaunchRegistry.Artifact("token", "HmmToken", address(tokens[0]));
        registry.record(13, "custom_token", missing);
    }

    function _record(uint64 id, bytes32 kind, address token, address mine) internal {
        ILaunchRegistry.Artifact[] memory artifacts = new ILaunchRegistry.Artifact[](4);
        // Unrelated artifact and wrong role must not influence resolution; the mine may precede the token.
        artifacts[0] = ILaunchRegistry.Artifact("distributor", "HmmMine", address(this));
        artifacts[1] = ILaunchRegistry.Artifact("other", "HmmMine", mine);
        artifacts[2] = ILaunchRegistry.Artifact("other", "Unrelated", address(this));
        artifacts[3] = ILaunchRegistry.Artifact("token", "HmmToken", token);
        registry.record(id, kind, artifacts);
    }

    function donate(uint256 tokenSeed, uint256 amountSeed) external {
        uint256 i = tokenSeed % 3;
        uint256 maximum = tokens[i].balanceOf(address(this));
        if (maximum > 1_000_000 ether) maximum = 1_000_000 ether;
        uint256 amount = bound(amountSeed, 0, maximum);
        tokens[i].transfer(address(forwarder), amount);
        held[i] += amount;
        donated[i] += amount;
    }

    function forward(uint256 tokenSeed, uint256 callerSeed) external {
        uint256 i = tokenSeed % 3;
        address caller = address(uint160(uint256(keccak256(abi.encode("forward caller", callerSeed)))));
        uint64 id = uint64(i + 1);
        uint256 amount = held[i];
        if (amount == 0) {
            vm.prank(caller);
            vm.expectRevert(abi.encodeWithSelector(GenesisForwarder.NothingHeld.selector, address(tokens[i])));
            forwarder.forward(id);
        } else {
            vm.prank(caller);
            assertEq(forwarder.forward(id), amount);
            if (initialGenesis[i] == 0) {
                initialGenesis[i] = block.timestamp;
                initialReserve[i] = amount;
            }
            forwarded[i] += amount;
            held[i] = 0;
        }
    }

    function invalidLaunch(uint8 kind) external {
        kind %= 5;
        uint64 id = uint64(10 + kind);
        bytes memory expected;
        if (kind < 2) expected = abi.encodeWithSelector(GenesisForwarder.WrongMine.selector, address(mines[kind + 1]));
        else if (kind == 3) expected = abi.encodeWithSelector(GenesisForwarder.MissingArtifact.selector, id);
        else expected = abi.encodeWithSelector(GenesisForwarder.NotCustomTokenLaunch.selector, id);
        vm.expectRevert(expected);
        forwarder.forward(id);
    }

    function advance(uint256 secondsSeed) external {
        vm.warp(block.timestamp + bound(secondsSeed, 1, 365 days));
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 100
/// forge-config: default.invariant.fail-on-revert = true
contract ForwarderReservesInvariantTest is Test {
    ForwarderReservesHandler internal handler;

    function setUp() public {
        vm.warp(1_800_000_000);
        handler = new ForwarderReservesHandler();
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = handler.donate.selector;
        selectors[1] = handler.forward.selector;
        selectors[2] = handler.invalidLaunch.selector;
        selectors[3] = handler.advance.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_eachLaunchRetainsItsEntireOwnReserve() public view {
        for (uint256 i; i < 3; ++i) {
            HmmToken token = handler.tokens(i);
            HmmMine mine = handler.mines(i);
            assertEq(token.totalSupply(), handler.SUPPLY());
            assertEq(token.balanceOf(address(handler.forwarder())), handler.held(i));
            assertEq(token.balanceOf(address(mine)), handler.forwarded(i));
            assertEq(handler.held(i) + handler.forwarded(i), handler.REMAINDER() + handler.donated(i));
            assertEq(token.balanceOf(address(handler)) + handler.held(i) + handler.forwarded(i), handler.SUPPLY());
            assertEq(mine.reserve(), handler.initialReserve(i));
            assertEq(mine.genesis(), handler.initialGenesis(i));
            assertEq(mine.baseRate(), handler.initialReserve(i) / (2 * handler.ERA()));
            assertEq(mine.started(), handler.initialGenesis(i) != 0);
            assertEq(mine.steward(), address(0));
            for (uint256 j; j < 3; ++j) {
                if (j != i) assertEq(token.balanceOf(address(handler.mines(j))), 0, "no cross-launch transfer");
            }
        }
    }

    function afterInvariant() public {
        for (uint256 i; i < 3; ++i) {
            handler.forward(i, i);
        }
        invariant_eachLaunchRetainsItsEntireOwnReserve();
        for (uint256 i; i < 3; ++i) {
            assertEq(handler.held(i), 0);
            assertTrue(handler.mines(i).started());
        }
    }
}

contract ForwarderAtomicityTest is Test {
    function test_startFailureRollsBackTheWholeTokenTransferAndCanBeRetried() public {
        vm.warp(1_800_000_000);
        MockRegistry registry = new MockRegistry();
        GenesisForwarder forwarder = new GenesisForwarder(address(registry), "HmmMine");
        HmmToken token = new HmmToken();
        MockIMD imd = new MockIMD();
        SwarmOracleAdapter adapter = new SwarmOracleAdapter(address(this), makeAddr("signer"), 5, 4);
        HmmMine mine = new HmmMine(
            address(token),
            address(imd),
            address(this),
            bytes32("oracle.request@oracle-1"),
            address(forwarder),
            address(adapter),
            makeAddr("dev"),
            500,
            600,
            180 days,
            0
        );
        ILaunchRegistry.Artifact[] memory artifacts = new ILaunchRegistry.Artifact[](2);
        artifacts[0] = ILaunchRegistry.Artifact("token", "HmmToken", address(token));
        artifacts[1] = ILaunchRegistry.Artifact("other", "HmmMine", address(mine));
        registry.record(1, "custom_token", artifacts);
        uint256 threshold = 2 * 180 days;
        token.transfer(address(forwarder), threshold - 1);
        vm.expectRevert(HmmMine.NothingToMine.selector);
        forwarder.forward(1);
        assertEq(token.balanceOf(address(forwarder)), threshold - 1);
        assertEq(token.balanceOf(address(mine)), 0);
        assertEq(mine.genesis(), 0);
        assertEq(mine.reserve(), 0);
        token.transfer(address(forwarder), 1);
        assertEq(forwarder.forward(1), threshold);
        assertEq(mine.baseRate(), 1);
        assertEq(mine.reserve(), threshold);
        assertEq(token.balanceOf(address(forwarder)), 0);
    }
}
