// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HmmToken} from "../src/HmmToken.sol";
import {HmmMine} from "../src/HmmMine.sol";
import {SwarmOracleAdapter} from "../src/SwarmOracleAdapter.sol";
import {ILaunchRegistry} from "../src/interfaces/ILaunchRegistry.sol";
import {IProjectFactory} from "./IProjectFactory.sol";

/// @notice Everything about the hmm launch in one place: mainnet addresses, the parameters the launch request names,
/// and how the IMD factory will assemble the contracts (creation code, predicted addresses, constructor arguments).
/// The launch request (`launch/`), the mainnet-fork rehearsal and the devnet all build from this, so they cannot drift.
library HmmLaunch {
    // ── Ethereum mainnet, verified on chain 2026-10-12 ──
    address internal constant IMD = 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7;
    address internal constant INTAKE = 0xa43e6F75ee006411F79Ac1C84120606C2330DE82;
    address internal constant PROJECT_FACTORY = 0xfF03410d0Fe5fa8f7F59F743de35E333D9857120;
    address internal constant LAUNCH_REGISTRY = 0x7c9D5ee697BfF5Ac4F10E2E54d3f40c44e48fE23;
    address internal constant ORACLE_SIGNER = 0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982;
    bytes32 internal constant ACTION = bytes32("oracle.request@oracle-1");

    // ── hmm parameters ──
    uint256 internal constant SUPPLY = 1_000_000_000 ether;
    uint16 internal constant POOL_BPS = 2500; // 25% opens the pool; the swarm takes 10%; 65% is mined
    uint256 internal constant MIN_PANEL = 5;
    uint256 internal constant MIN_QUORUM = 4;
    uint256 internal constant DEV_BPS = 500; // 5% of every round
    uint256 internal constant ROUND_LENGTH = 10 minutes;
    uint256 internal constant ERA_LENGTH = 180 days;
    uint256 internal constant GENESIS_DELAY = 0;
    bytes32 internal constant TOKEN_NAME = "HmmToken";
    bytes32 internal constant ADAPTER_NAME = "SwarmOracleAdapter";
    bytes32 internal constant MINE_NAME = "HmmMine";

    struct Roles {
        address forwarder; // GenesisForwarder, the launch's remainderTo
        address steward; // unused: HmmMine takes no steward argument (kept so callers' roles stay the same)
        address dev; // receives the dev share of every round
        address oracleSigner; // the swarm's oracle signer (a test key on forks and the devnet)
        address intake;
        address imd;
    }

    struct Plan {
        bytes tokenCode;
        bytes adapterCode;
        bytes mineCode;
        address token;
        address adapter;
        address mine;
    }

    function mainnetRoles(address forwarder, address steward, address dev) internal pure returns (Roles memory) {
        return Roles(forwarder, steward, dev, ORACLE_SIGNER, INTAKE, IMD);
    }

    function adapterArgs(Roles memory r) internal pure returns (bytes memory) {
        return abi.encode(r.intake, r.oracleSigner, MIN_PANEL, MIN_QUORUM);
    }

    function mineArgs(Roles memory r, address token, address adapter) internal pure returns (bytes memory) {
        return abi.encode(
            token,
            r.imd,
            r.intake,
            ACTION,
            r.forwarder,
            adapter,
            r.dev,
            DEV_BPS,
            ROUND_LENGTH,
            ERA_LENGTH,
            GENESIS_DELAY
        );
    }

    /// @notice The creation code and addresses the factory will produce for launch `n`, in deployment order:
    /// the token, then the adapter (contract 0), then the mine (contract 1, which binds the adapter).
    function plan(IProjectFactory factory, uint64 n, Roles memory r) internal view returns (Plan memory p) {
        p.tokenCode = type(HmmToken).creationCode;
        p.token = factory.predictToken(n, p.tokenCode);
        p.adapterCode = abi.encodePacked(type(SwarmOracleAdapter).creationCode, adapterArgs(r));
        p.adapter = factory.predictContract(n, 0, p.adapterCode);
        p.mineCode = abi.encodePacked(type(HmmMine).creationCode, mineArgs(r, p.token, p.adapter));
        p.mine = factory.predictContract(n, 1, p.mineCode);
    }

    /// @notice A `launchCustom` call as the swarm's deployer would make it, opening the pool at the price INFER opened
    /// at (14,444 IMD for the whole supply) with 25% of the supply single-sided. For rehearsals only: on mainnet the
    /// swarm computes the pool seed from the request's `initialMarketCapWei`.
    function rehearsalParams(IProjectFactory factory, uint64 n, Roles memory r, address requester)
        internal
        view
        returns (IProjectFactory.CustomParams memory c, Plan memory p)
    {
        p = plan(factory, n, r);
        c.launchNumber = n;
        c.tokenCreationCode = p.tokenCode;
        c.tokenName = TOKEN_NAME;
        c.contractCreationCodes = new bytes[](2);
        c.contractCreationCodes[0] = p.adapterCode;
        c.contractCreationCodes[1] = p.mineCode;
        c.contractNames = new bytes32[](2);
        c.contractNames[0] = ADAPTER_NAME;
        c.contractNames[1] = MINE_NAME;
        c.expectedContracts = new address[](2);
        c.expectedContracts[0] = p.adapter;
        c.expectedContracts[1] = p.mine;
        c.totalSupply = SUPPLY;
        c.poolBps = POOL_BPS;
        c.remainderTo = r.forwarder;
        c.merkleRoot = keccak256("hmm rehearsal swarm share");
        c.contributorLockSeconds = 3600;
        c.sweepDelaySeconds = 365 days;
        c.pairedCurrency = r.imd;
        c.tickSpacing = 60;
        // INFER's opening price (IMD per token, token as currency0) and the liquidity that takes 99.95% of 25%.
        uint160 sqrtPrice = 301113346248416432001292334;
        if (p.token < r.imd) {
            c.sqrtPriceX96 = sqrtPrice;
            c.tickLower = -111420;
            c.tickUpper = 887220;
        } else {
            c.sqrtPriceX96 = uint160((uint256(1) << 192) / sqrtPrice);
            c.tickLower = -887220;
            c.tickUpper = 111420;
        }
        c.liquidity = 951457104014699884102278;
        c.record = ILaunchRegistry.Launch({
            kind: "custom_token",
            launchNumber: n,
            recordedAt: 0,
            sourceCommit: bytes32(uint256(0x1)),
            manifestHash: keccak256("manifest"),
            attestationHash: keccak256("attestation"),
            verifierKey: keccak256("verifier"),
            sourceRepoUrl: "https://github.com/identity-md-launches/hmm-rehearsal"
        });
        c.agentIds = new uint256[](1);
        c.agentIds[0] = 51000;
        c.requester = requester;
    }
}
