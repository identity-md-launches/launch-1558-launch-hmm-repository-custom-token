// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IIntake} from "./interfaces/IIntake.sol";
import {IOracleAdapter} from "./interfaces/IOracleAdapter.sol";
import {IHmmMine} from "./interfaces/IHmmMine.sol";

/// @title SwarmOracleAdapter
/// @notice Receives the IMD swarm's answers for an HmmMine and decides whether they count. It is the Intake callback
/// target of every question the mine asks through it, so the oracle signs those answers for this contract.
///
/// An answer counts when: the Intake is the caller and the request named this contract; the oracle signer signed it
/// (EIP-712, domain "IdentityMD Oracle" version 2, this chain, this contract); the panel had at least `minPanel`
/// members, a quorum of at least `minQuorum`, and at least the quorum and a majority of the panel agreed; it has not
/// expired; and the same oracle answer was never counted before. Anything else is reported to the mine as a failure,
/// with a reason, so the question's backers see why it mined nothing.
contract SwarmOracleAdapter is IOracleAdapter {
    /// @dev Mirrors the swarm's `OracleAttestation`, field for field: the Intake ABI-encodes the callback with it.
    struct Attestation {
        bytes32 requestId;
        uint256 chainId;
        bytes32 questionHash;
        uint8 answerType;
        bytes answer;
        uint256 figure;
        uint64 fromBlock;
        uint64 toBlock;
        bytes32 blockHash;
        bytes32 panelJobId;
        uint16 panelSize;
        uint16 quorum;
        uint16 agreed;
        uint64 issuedAt;
        uint64 expiresAt;
    }

    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "OracleAttestation(bytes32 requestId,uint256 chainId,bytes32 questionHash,uint8 answerType,bytes answer,uint256 figure,uint64 fromBlock,uint64 toBlock,bytes32 blockHash,bytes32 panelJobId,uint16 panelSize,uint16 quorum,uint16 agreed,uint64 issuedAt,uint64 expiresAt)"
    );
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant NAME_HASH = keccak256("IdentityMD Oracle");
    bytes32 public constant VERSION_HASH = keccak256("2");

    /// @notice Status the mine records for an answer that arrived but does not count.
    uint8 public constant REJECTED = 3;
    /// @notice Longest answer logged in full in `Thought` (every scalar answer is 32 bytes).
    uint256 public constant MAX_LOGGED_ANSWER = 128;

    IIntake public immutable intake;
    address public immutable signer;
    uint16 public immutable minPanel;
    uint16 public immutable minQuorum;

    address public mine;
    /// @notice Oracle answers (by the oracle's own request id) already counted.
    mapping(bytes32 oracleRequestId => bool) public used;

    event Bound(address indexed mine);
    /// @notice An answer that counted. `answer` is `abi.encode` of the value (see imd.fun/docs/#oracle), logged only
    /// up to `MAX_LOGGED_ANSWER` bytes so a long answer cannot run the callback out of gas; `answerHash` always is.
    event Thought(
        bytes32 indexed requestId,
        bytes32 indexed oracleRequestId,
        uint256 chainId,
        uint8 answerType,
        bytes32 answerHash,
        bytes answer,
        uint16 panelSize,
        uint16 quorum,
        uint16 agreed
    );
    event Rejected(bytes32 indexed requestId, bytes32 indexed oracleRequestId, bytes32 reason);
    event Unanswered(bytes32 indexed requestId, uint8 status, bytes32 reason, uint16 agreed, uint16 answered);

    error ZeroAddress();
    error BadPanelRules();
    error AlreadyBound(address mine);
    error NotBound();
    error NotIntake();
    error UnknownRequest(bytes32 requestId);

    /// @param intake_ The IMD Intake (version 2) on this chain.
    /// @param signer_ The swarm's oracle signer (0x5598aa9146215bc13eb26f2c692ad1461fd32982 on 2026-10-12).
    /// @param minPanel_ Fewest panel members an answer needs.
    /// @param minQuorum_ Lowest quorum an answer needs.
    /// @dev No mine argument: the mine claims this adapter by calling `bind()` from its own constructor, which a launch
    /// runs in the same transaction as this deployment. (IMD's launch checker refuses zero-address arguments.)
    constructor(address intake_, address signer_, uint256 minPanel_, uint256 minQuorum_) {
        if (intake_ == address(0) || signer_ == address(0)) revert ZeroAddress();
        if (minQuorum_ < 2 || minPanel_ < minQuorum_ || minPanel_ > 100) revert BadPanelRules();
        intake = IIntake(intake_);
        signer = signer_;
        minPanel = uint16(minPanel_);
        minQuorum = uint16(minQuorum_);
    }

    /// @inheritdoc IOracleAdapter
    function bind() external {
        address bound = mine;
        if (bound == msg.sender) return;
        if (bound != address(0)) revert AlreadyBound(bound);
        mine = msg.sender;
        emit Bound(msg.sender);
    }

    /// @inheritdoc IOracleAdapter
    function callbackSelectors() external pure returns (bytes4 onResult, bytes4 onFailure) {
        return (this.onOracleResult.selector, this.onOracleFailure.selector);
    }

    /// @notice The Intake's callback for an answer: `(bytes32 requestId, Attestation a, bytes signature)`.
    function onOracleResult(bytes32 requestId, Attestation calldata a, bytes calldata signature) external {
        if (msg.sender != address(intake)) revert NotIntake();
        address m = mine;
        if (m == address(0)) revert NotBound();
        // Status-0 arguments are the writer's: check the request is one the Intake is completing for us.
        (, address target,, bool completed) = intake.requests(requestId);
        if (target != address(this) || !completed) revert UnknownRequest(requestId);

        bytes32 answerHash = keccak256(a.answer);
        bytes32 reason = _check(a, answerHash, signature);
        if (reason != bytes32(0)) {
            IHmmMine(m).fail(requestId, REJECTED, reason);
            emit Rejected(requestId, a.requestId, reason);
            return;
        }
        used[a.requestId] = true;
        IHmmMine(m).credit(requestId);
        _thought(requestId, a, answerHash);
    }

    function _thought(bytes32 requestId, Attestation calldata a, bytes32 answerHash) internal {
        bytes memory shown;
        if (a.answer.length <= MAX_LOGGED_ANSWER) shown = a.answer;
        emit Thought(
            requestId, a.requestId, a.chainId, a.answerType, answerHash, shown, a.panelSize, a.quorum, a.agreed
        );
    }

    /// @notice The Intake's callback for a refusal (status 1) or a request that ended without an answer (status 2).
    /// Unsigned for now, so it only closes the question; it never moves value.
    function onOracleFailure(
        bytes32 requestId,
        uint8 status,
        bytes32 reason,
        uint16 agreed,
        uint16 answered,
        bytes calldata /* signature: empty until the swarm signs failures */
    ) external {
        if (msg.sender != address(intake)) revert NotIntake();
        address m = mine;
        if (m == address(0)) revert NotBound();
        IHmmMine(m).fail(requestId, status, reason);
        emit Unanswered(requestId, status, reason, agreed, answered);
    }

    /// @notice Why an answer would not count, or zero if it would.
    function check(Attestation calldata a, bytes calldata signature) external view returns (bytes32) {
        return _check(a, keccak256(a.answer), signature);
    }

    /// @notice The EIP-712 digest the oracle signs for `a` under the domain of `verifyingContract` on `chainId`.
    function digest(Attestation calldata a, uint256 chainId, address verifyingContract)
        external
        pure
        returns (bytes32)
    {
        return _digest(a, keccak256(a.answer), chainId, verifyingContract);
    }

    function _check(Attestation calldata a, bytes32 answerHash, bytes calldata signature)
        internal
        view
        returns (bytes32)
    {
        if (used[a.requestId]) return "reused";
        if (a.panelSize < minPanel) return "panel_too_small";
        if (a.quorum < minQuorum) return "quorum_too_low";
        if (a.agreed < a.quorum || uint256(a.agreed) * 2 <= a.panelSize) return "not_agreed";
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > a.expiresAt) return "expired";
        (address recovered, ECDSA.RecoverError err,) =
            ECDSA.tryRecover(_digest(a, answerHash, block.chainid, address(this)), signature);
        if (err != ECDSA.RecoverError.NoError || recovered != signer) return "bad_signature";
        return bytes32(0);
    }

    function _digest(Attestation calldata a, bytes32 answerHash, uint256 chainId, address verifyingContract)
        internal
        pure
        returns (bytes32)
    {
        bytes32 domain = keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, chainId, verifyingContract));
        // Two encodes (words concatenate exactly) keep the stack shallow without via-IR.
        bytes32 structHash = keccak256(
            bytes.concat(
                abi.encode(
                    ATTESTATION_TYPEHASH,
                    a.requestId,
                    a.chainId,
                    a.questionHash,
                    a.answerType,
                    answerHash,
                    a.figure,
                    a.fromBlock
                ),
                abi.encode(
                    a.toBlock, a.blockHash, a.panelJobId, a.panelSize, a.quorum, a.agreed, a.issuedAt, a.expiresAt
                )
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }
}
