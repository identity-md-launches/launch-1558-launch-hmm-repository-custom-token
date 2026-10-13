// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {HmmMine} from "../../src/HmmMine.sol";
import {HmmToken} from "../../src/HmmToken.sol";
import {SwarmOracleAdapter} from "../../src/SwarmOracleAdapter.sol";
import {GenesisForwarder} from "../../src/GenesisForwarder.sol";
import {ILaunchRegistry} from "../../src/interfaces/ILaunchRegistry.sol";
import {IIntake} from "../../src/interfaces/IIntake.sol";
import {IProjectFactory} from "../../script/IProjectFactory.sol";
import {HmmLaunch} from "../../script/HmmLaunch.sol";

interface IIntakeAdmin {
    function writer() external view returns (address);
    function payTo() external view returns (address);
    function callbackGas() external view returns (uint64);
    function complete(bytes32 requestId, uint8 status, bytes32 resultHash, string calldata uri, bytes calldata args)
        external;
}

/// @notice The whole launch, rehearsed on a fork of Ethereum mainnet against IMD's real contracts: the ProjectFactory
/// deploys the token, adapter and mine exactly as the swarm's deployer would, records them in the real registry and
/// seeds the real Uniswap v4 pool; the forwarder starts the mine; a question is paid through the real Intake with real
/// IMD; the real Intake delivers the answer within its real callback stipend; the backer claims.
/// Run: FOUNDRY_PROFILE=fork forge test (MAINNET_RPC_URL defaults to the local node at http://127.0.0.1:8545).
contract LaunchForkTest is Test {
    IProjectFactory internal constant FACTORY = IProjectFactory(HmmLaunch.PROJECT_FACTORY);
    IERC20 internal constant IMD = IERC20(HmmLaunch.IMD);
    IIntakeAdmin internal constant INTAKE = IIntakeAdmin(HmmLaunch.INTAKE);
    ILaunchRegistry internal constant REGISTRY = ILaunchRegistry(HmmLaunch.LAUNCH_REGISTRY);
    address internal constant SIMD_VAULT = 0x9Efa934D9fAd4AE28c998a40195646b965a97247; // holds ~1.8M IMD
    uint64 internal constant N = 990_001; // a launch number nobody has used

    uint256 internal oraclePk = 0x0DDBA11;
    address internal steward = makeAddr("steward");
    address internal dev = makeAddr("dev");
    address internal requester = makeAddr("requester");
    address internal miner = makeAddr("miner");
    address internal friend = makeAddr("friend");

    GenesisForwarder internal forwarder;
    HmmLaunch.Roles internal roles;
    HmmLaunch.Plan internal plan;
    HmmMine internal mine;
    SwarmOracleAdapter internal adapter;
    IERC20 internal hmm;
    address internal distributor;

    function setUp() public {
        vm.createSelectFork(vm.envOr("MAINNET_RPC_URL", string("http://127.0.0.1:8545")));
        // This launch uses the forwarder already deployed on mainnet, including its unconditional start() call.
        forwarder = GenesisForwarder(0x876C2FB3eAa91D32Ef03186853bB82433b949a71);
        assertEq(address(forwarder.registry()), HmmLaunch.LAUNCH_REGISTRY);
        assertEq(forwarder.mineName(), HmmLaunch.MINE_NAME);
        // The real oracle key cannot sign here, so the rehearsal's adapter trusts a test key; everything else is real.
        roles = HmmLaunch.Roles({
            forwarder: address(forwarder),
            steward: steward,
            dev: dev,
            oracleSigner: vm.addr(oraclePk),
            intake: HmmLaunch.INTAKE,
            imd: HmmLaunch.IMD
        });
        (IProjectFactory.CustomParams memory c, HmmLaunch.Plan memory p) =
            HmmLaunch.rehearsalParams(FACTORY, N, roles, requester);
        plan = p;
        vm.prank(FACTORY.deployer());
        address[] memory contracts;
        address token;
        (token, contracts, distributor) = FACTORY.launchCustom(c);
        assertEq(token, p.token, "token at the predicted address");
        assertEq(contracts[0], p.adapter);
        assertEq(contracts[1], p.mine);
        hmm = IERC20(token);
        mine = HmmMine(p.mine);
        adapter = SwarmOracleAdapter(p.adapter);

        // fund two users with real IMD from the sIMD vault
        vm.startPrank(SIMD_VAULT);
        IMD.transfer(miner, 10 ether);
        IMD.transfer(friend, 10 ether);
        vm.stopPrank();
        vm.prank(miner);
        IMD.approve(address(mine), type(uint256).max);
        vm.prank(friend);
        IMD.approve(address(mine), type(uint256).max);
    }

    function test_launch_splitsSupplyAndRecordsArtifacts() public view {
        assertEq(hmm.totalSupply(), HmmLaunch.SUPPLY);
        assertEq(hmm.balanceOf(distributor), HmmLaunch.SUPPLY / 10, "swarm share to the Merkle distributor");
        uint256 remainder = hmm.balanceOf(address(forwarder));
        assertGe(remainder, HmmLaunch.SUPPLY * 6500 / 10_000, "at least 65% left for mining");
        assertLt(remainder, HmmLaunch.SUPPLY * 6510 / 10_000);
        assertEq(hmm.balanceOf(FACTORY.registry()), 0);

        ILaunchRegistry.Artifact[] memory arts = REGISTRY.artifactsOf(N);
        bool sawToken;
        bool sawMine;
        for (uint256 i; i < arts.length; ++i) {
            if (arts[i].role == "token") sawToken = arts[i].addr == address(hmm);
            if (arts[i].name == HmmLaunch.MINE_NAME) {
                sawMine = arts[i].addr == address(mine) && arts[i].role == "other";
            }
        }
        assertTrue(sawToken && sawMine, "registry names the token and the mine");
        assertEq(REGISTRY.launchOf(N).kind, bytes32("custom_token"));

        (IProjectFactory.PoolKey memory key,,, address req) = FACTORY.positionOf(N);
        assertEq(req, requester, "the launch's 1% LP fee goes to the requester");
        assertTrue(key.currency0 == address(hmm) || key.currency1 == address(hmm));
        assertTrue(key.currency0 == address(IMD) || key.currency1 == address(IMD));
        assertEq(key.fee, 12_500);
        assertEq(adapter.mine(), address(mine), "the mine bound its adapter during the launch");
        assertFalse(mine.started());
    }

    function test_forward_thenMineAQuestionThroughTheRealIntake() public {
        uint256 remainder = hmm.balanceOf(address(forwarder));
        forwarder.forward(N);
        assertTrue(mine.started());
        assertEq(mine.reserve(), remainder);
        assertEq(hmm.balanceOf(address(mine)), remainder);

        uint256 id = _askPooled();
        _answerThroughTheRealIntake(id);
        _claimAndCheck(id);
    }

    /// @dev A pooled question: the friend proposes with 0.2 IMD, the miner completes it; the swarm's treasury is paid.
    function _askPooled() internal returns (uint256 id) {
        HmmMine.Spec memory spec = HmmMine.Spec({
            question: "At the window's closing block, was totalSupply() of the ERC-20 contract 0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7 on Ethereum mainnet greater than 4000000000000000000000000 (raw units, 18 decimals)?",
            answerType: 0,
            evidence: 0,
            chainId: 1,
            windowHours: 24,
            panelSize: 5,
            quorum: 4,
            toleranceBps: 0
        });
        bytes memory body = mine.bodyOf(spec);
        assertEq(IIntake(HmmLaunch.INTAKE).priceOf(HmmLaunch.ACTION, address(IMD)), 0.5 ether, "the live Intake price");
        uint256 treasuryBefore = IMD.balanceOf(INTAKE.payTo());
        vm.prank(friend, friend);
        id = mine.propose(spec, 0.2 ether);
        vm.prank(miner, miner);
        mine.back(id, 1 ether, body);
        HmmMine.Question memory q = mine.question(id);
        assertEq(uint8(q.status), uint8(HmmMine.Status.Asked));
        assertEq(IMD.balanceOf(INTAKE.payTo()) - treasuryBefore, 0.5 ether, "the swarm's treasury was paid");
        (address payer, address target,, bool done) = IIntake(HmmLaunch.INTAKE).requests(q.requestId);
        assertEq(payer, address(mine));
        assertEq(target, address(adapter));
        assertFalse(done);
    }

    /// @dev The real writer completes through the real Intake, which calls back with its real 200k stipend.
    function _answerThroughTheRealIntake(uint256 id) internal {
        assertEq(INTAKE.callbackGas(), 200_000);
        bytes32 rid = mine.question(id).requestId;
        SwarmOracleAdapter.Attestation memory a = _attestation();
        bytes memory args = abi.encode(rid, a, _sign(a));
        vm.recordLogs();
        vm.prank(INTAKE.writer());
        INTAKE.complete(rid, 0, keccak256(args), "/oracle/requests/x/attestation", args);
        assertTrue(_delivered(), "callback delivered within the real stipend");
        assertEq(uint8(mine.question(id).status), uint8(HmmMine.Status.Answered));
    }

    function _claimAndCheck(uint256 id) internal {
        uint256 r = mine.question(id).round;
        vm.warp(mine.roundEnd(r));
        (uint128 shares, uint128 reward) = mine.rounds(r);
        assertEq(shares, 0.5 ether);
        vm.prank(miner, miner);
        uint256 minerGot = mine.claim(_ids(id));
        vm.prank(friend, friend);
        uint256 friendGot = mine.claim(_ids(id));
        assertEq(minerGot, uint256(reward) * 3 / 5);
        assertEq(friendGot, uint256(reward) - minerGot, "last claimant receives rounding dust");
        assertEq(hmm.balanceOf(miner), minerGot);

        assertGt(mine.devOwed(), 0);
        mine.payDev();
        assertEq(hmm.balanceOf(dev), mine.devPaid());
    }

    function test_refusal_throughTheRealIntake_closesTheQuestion() public {
        forwarder.forward(N);
        vm.prank(miner, miner);
        uint256 id = mine.propose(
            HmmMine.Spec({
                question: "Will this be refused?",
                answerType: 0,
                evidence: 1,
                chainId: 1,
                windowHours: 24,
                panelSize: 5,
                quorum: 4,
                toleranceBps: 0
            }),
            1 ether
        );
        bytes32 rid = mine.question(id).requestId;
        bytes memory args = abi.encode(rid, uint8(1), bytes32("body_invalid"), uint16(0), uint16(0), bytes(""));
        vm.recordLogs();
        vm.prank(INTAKE.writer());
        INTAKE.complete(rid, 1, bytes32(0), "/intake/1/x", args);
        assertTrue(_delivered());
        assertEq(uint8(mine.question(id).status), uint8(HmmMine.Status.Failed));
    }

    function test_requester_canMoveTheFeeStream() public {
        address vault = makeAddr("revenueWallet");
        vm.prank(requester);
        FACTORY.setRequester(N, vault);
        (,,, address req) = FACTORY.positionOf(N);
        assertEq(req, vault);
    }

    function test_fixedForwarderMatchesSourceAndForwardsLateHMMWithoutRestarting() public {
        GenesisForwarder compiled = new GenesisForwarder(HmmLaunch.LAUNCH_REGISTRY, HmmLaunch.MINE_NAME);
        assertEq(address(forwarder).code, address(compiled).code, "the fixed deployed forwarder matches the source");
        forwarder.forward(N);
        uint256 id = _askPooled();
        _answerThroughTheRealIntake(id);
        _claimAndCheck(id);
        uint256 reserve = mine.reserve();
        uint256 genesis = mine.genesis();
        uint256 rate = mine.baseRate();
        uint256 assigned = mine.assigned();
        uint256 claimed = mine.claimedTotal();
        uint256 balance = hmm.balanceOf(address(mine));
        vm.prank(miner);
        hmm.transfer(address(forwarder), 1 ether);
        assertEq(forwarder.forward(N), 1 ether);
        assertEq(hmm.balanceOf(address(forwarder)), 0);
        assertEq(hmm.balanceOf(address(mine)), balance + 1 ether);
        assertEq(mine.reserve(), reserve);
        assertEq(mine.genesis(), genesis);
        assertEq(mine.baseRate(), rate);
        assertEq(mine.assigned(), assigned);
        assertEq(mine.claimedTotal(), claimed);
    }

    /* helpers */

    function _attestation() internal view returns (SwarmOracleAdapter.Attestation memory a) {
        a.requestId = bytes32(uint256(0xabcdef) << 128);
        a.chainId = 1;
        a.questionHash = keccak256("q");
        a.answerType = 0;
        a.answer = abi.encode(true);
        a.fromBlock = uint64(block.number - 7200);
        a.toBlock = uint64(block.number - 5);
        a.blockHash = blockhash(block.number - 5);
        a.panelJobId = bytes32(uint256(0x1234) << 128);
        a.panelSize = 5;
        a.quorum = 4;
        a.agreed = 5;
        a.issuedAt = uint64(block.timestamp);
        a.expiresAt = uint64(block.timestamp + 1 days);
    }

    function _sign(SwarmOracleAdapter.Attestation memory a) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, adapter.digest(a, block.chainid, address(adapter)));
        return abi.encodePacked(r, s, v);
    }

    function _delivered() internal returns (bool) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("Completed(bytes32,uint8,bytes32,string,bool)");
        for (uint256 i = logs.length; i > 0; --i) {
            if (logs[i - 1].emitter == HmmLaunch.INTAKE && logs[i - 1].topics[0] == topic) {
                (,,, bool d) = abi.decode(logs[i - 1].data, (uint8, bytes32, string, bool));
                return d;
            }
        }
        revert("no Completed event");
    }

    function _ids(uint256 a) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = a;
    }
}
