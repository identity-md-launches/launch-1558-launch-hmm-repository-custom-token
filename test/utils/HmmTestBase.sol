// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HmmMineStewarded} from "./HmmMineStewarded.sol";
import {Test, Vm} from "forge-std/Test.sol";

import {HmmToken} from "../../src/HmmToken.sol";
import {HmmMine} from "../../src/HmmMine.sol";
import {SwarmOracleAdapter} from "../../src/SwarmOracleAdapter.sol";
import {GenesisForwarder} from "../../src/GenesisForwarder.sol";
import {ILaunchRegistry} from "../../src/interfaces/ILaunchRegistry.sol";
import {Intake} from "../external/Intake.sol";
import {MockIMD, MockRegistry} from "./Mocks.sol";

/// @notice Shared world for unit tests: the real Intake code, a mock IMD and registry, and a launched, started mine.
abstract contract HmmTestBase is Test {
    bytes32 internal constant ACTION = bytes32("oracle.request@oracle-1");
    uint256 internal constant PRICE = 0.5 ether;
    uint256 internal constant ROUND = 10 minutes;
    uint256 internal constant ERA = 180 days;
    uint256 internal constant DEV_BPS = 500;
    uint256 internal constant SUPPLY = 1_000_000_000 ether;
    uint256 internal constant SWARM_SHARE = SUPPLY / 10;
    uint256 internal constant POOL_SHARE = SUPPLY / 4;
    uint256 internal constant RESERVE = SUPPLY - SWARM_SHARE - POOL_SHARE; // 65%
    uint64 internal constant LAUNCH = 1500;

    uint256 internal oraclePk = 0xA11CE;
    address internal oracleSigner;
    address internal owner = makeAddr("intakeOwner");
    address internal payTo = makeAddr("imdTreasury");
    address internal writer = makeAddr("intakeWriter");
    address internal factory = makeAddr("factory");
    address internal steward = makeAddr("steward");
    address internal dev = makeAddr("dev");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    MockIMD internal imd;
    Intake internal intake;
    MockRegistry internal registry;
    GenesisForwarder internal forwarder;
    HmmToken internal hmm;
    SwarmOracleAdapter internal adapter;
    HmmMine internal mine;

    uint256 internal oracleNonce;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        oracleSigner = vm.addr(oraclePk);
        imd = new MockIMD();
        intake = new Intake(owner, payTo, writer, makeAddr("quoteSigner"));
        vm.prank(owner);
        intake.setPrice(ACTION, address(imd), PRICE);
        registry = new MockRegistry();
        forwarder = new GenesisForwarder(address(registry), bytes32("HmmMine"));

        (hmm, adapter, mine) = _launch(LAUNCH, 0);
        _startMine(LAUNCH);

        for (uint256 i; i < 3; ++i) {
            address who = [alice, bob, carol][i];
            imd.mint(who, 1_000 ether);
            vm.prank(who);
            imd.approve(address(mine), type(uint256).max);
        }
    }

    /* ───────────── launch, as the factory would ───────────── */

    function _launch(uint64 n, uint256 genesisDelay)
        internal
        returns (HmmToken token, SwarmOracleAdapter a, HmmMine m)
    {
        vm.startPrank(factory);
        token = new HmmToken();
        a = new SwarmOracleAdapter(address(intake), oracleSigner, 5, 4);
        m = new HmmMineStewarded(
            address(token),
            address(imd),
            address(intake),
            ACTION,
            address(forwarder),
            address(a),
            steward,
            dev,
            DEV_BPS,
            ROUND,
            ERA,
            genesisDelay
        );
        // swarm share and pool share leave; the remainder goes to the launch's remainderTo
        token.transfer(makeAddr("distributor"), SWARM_SHARE);
        token.transfer(makeAddr("pool"), POOL_SHARE);
        token.transfer(address(forwarder), token.balanceOf(factory));
        vm.stopPrank();

        ILaunchRegistry.Artifact[] memory arts = new ILaunchRegistry.Artifact[](4);
        arts[0] = ILaunchRegistry.Artifact("token", "HmmToken", address(token));
        arts[1] = ILaunchRegistry.Artifact("other", "SwarmOracleAdapter", address(a));
        arts[2] = ILaunchRegistry.Artifact("other", "HmmMine", address(m));
        arts[3] = ILaunchRegistry.Artifact("distributor", "MerkleDistributor", makeAddr("distributor"));
        registry.record(n, "custom_token", arts);
    }

    function _startMine(uint64 n) internal {
        forwarder.forward(n);
    }

    /* ───────────── questions ───────────── */

    /// @dev A chain-evidence yes/no question with the default 5/4 panel.
    function _spec(string memory question) internal pure returns (HmmMine.Spec memory) {
        return HmmMine.Spec({
            question: question,
            answerType: 0,
            evidence: 0,
            chainId: 1,
            windowHours: 24,
            panelSize: 5,
            quorum: 4,
            toleranceBps: 0
        });
    }

    /// @dev The body the mine writes for `_spec(question)` (what the completing backer passes back).
    function _body(string memory question) internal view returns (bytes memory) {
        return mine.bodyOf(_spec(question));
    }

    /// @dev `who` proposes and fully funds a question; returns its id and Intake request id.
    function _ask(address who, string memory question) internal returns (uint256 id, bytes32 rid) {
        vm.prank(who, who);
        id = mine.propose(_spec(question), PRICE);
        rid = mine.question(id).requestId;
    }

    /* ───────────── the swarm's answers ───────────── */

    function _attestation() internal returns (SwarmOracleAdapter.Attestation memory a) {
        a.requestId = bytes32(uint256(keccak256(abi.encode("oracle", ++oracleNonce))) << 128);
        a.chainId = 1;
        a.questionHash = keccak256(abi.encode("question", oracleNonce));
        a.answerType = 0;
        a.answer = abi.encode(true);
        a.fromBlock = 100;
        a.toBlock = 200;
        a.blockHash = keccak256("block");
        a.panelJobId = bytes32(uint256(keccak256(abi.encode("panel", oracleNonce))) << 128);
        a.panelSize = 5;
        a.quorum = 4;
        a.agreed = 5;
        a.issuedAt = uint64(block.timestamp);
        a.expiresAt = uint64(block.timestamp + 1 days);
    }

    function _sign(SwarmOracleAdapter.Attestation memory a, address consumer, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 d = SwarmOracleAdapter(consumer).digest(a, block.chainid, consumer);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    /// @dev The writer completes `rid` with a valid, signed answer for its adapter. Returns whether the Intake
    /// reported the callback as delivered.
    function _answer(bytes32 rid) internal returns (bool delivered) {
        (, address target,,) = intake.requests(rid);
        SwarmOracleAdapter.Attestation memory a = _attestation();
        return _complete(rid, abi.encode(rid, a, _sign(a, target, oraclePk)));
    }

    function _answerWith(bytes32 rid, SwarmOracleAdapter.Attestation memory a, bytes memory sig)
        internal
        returns (bool)
    {
        return _complete(rid, abi.encode(rid, a, sig));
    }

    function _complete(bytes32 rid, bytes memory args) internal returns (bool delivered) {
        vm.recordLogs();
        vm.prank(writer);
        intake.complete(rid, 0, keccak256(args), "/oracle/requests/x/attestation", args);
        delivered = _delivered();
    }

    /// @dev The writer reports a refusal (1) or an unanswered request (2).
    function _failure(bytes32 rid, uint8 status, bytes32 reason) internal returns (bool delivered) {
        bytes memory args = abi.encode(rid, status, reason, uint16(2), uint16(5), bytes(""));
        vm.recordLogs();
        vm.prank(writer);
        intake.complete(rid, status, bytes32(0), "/intake/x", args);
        delivered = _delivered();
    }

    function _delivered() internal returns (bool) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("Completed(bytes32,uint8,bytes32,string,bool)");
        for (uint256 i = logs.length; i > 0; --i) {
            if (logs[i - 1].emitter == address(intake) && logs[i - 1].topics[0] == topic) {
                (,,, bool d) = abi.decode(logs[i - 1].data, (uint8, bytes32, string, bool));
                return d;
            }
        }
        revert("no Completed event");
    }

    function _status(uint256 id) internal view returns (HmmMine.Status) {
        return mine.question(id).status;
    }

    function _ids(uint256 a) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = a;
    }

    function _ids(uint256 a, uint256 b) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](2);
        ids[0] = a;
        ids[1] = b;
    }

    function _roundOf(uint256 id) internal view returns (uint256) {
        return mine.question(id).round;
    }

    function _warpPastRound(uint256 id) internal {
        vm.warp(mine.roundEnd(_roundOf(id)));
    }
}
