// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IIntake} from "./interfaces/IIntake.sol";
import {IOracleAdapter} from "./interfaces/IOracleAdapter.sol";
import {IHmmMine} from "./interfaces/IHmmMine.sol";

/// @title HmmMine: proof of thought
/// @notice HMM is mined by asking the IMD swarm questions. Anyone proposes a question and anyone backs it with IMD; once
/// it holds the Intake's price it is asked, and the payment goes to the swarm. The mine writes the swarm's JSON
/// `oracle.request` body itself from a validated `Spec`, so a proposer cannot slip in fields (a foreign `consumer`, a
/// `deliver`, a tiny panel) that would make the answer not count while the other backers pay for it.
/// When a panel of agents agrees and the oracle's signed answer verifies, the question's backers mine a share of the
/// block (round) the answer lands in, in proportion to the IMD they put in. A question the swarm refuses or cannot
/// agree on mines nothing: every HMM that leaves this contract stands for an answer the swarm agreed on.
///
/// Emission follows a fixed schedule from `genesis`: `baseRate` per second, halving every `eraLength`, summing to at
/// most the reserve. A round with no answer emits nothing; what it would have emitted rolls into the next round that
/// gets one. `devBps` of every round goes to `dev`.
///
/// Trust: the IMD Intake (immutable), and the oracle adapter the question was asked through, which decides whether
/// an answer counts. The mine is deployed with no steward: `steward` starts at zero and only the steward can name one,
/// so nobody can ever queue a new adapter or action id, and the rules are fixed for good. The timelocked config logic
/// below (`queueConfig`, `applyConfig`, `setSteward`) is kept as reviewed; it is reachable only in tests, through a
/// subclass that sets a steward. Were a steward ever set, it could swap the adapter behind a `CONFIG_DELAY` timelock:
/// a strong power (an adapter decides which questions mine), which is why this mine has none.
contract HmmMine is IHmmMine, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Open, // raising IMD
        Asked, // paid to the Intake, waiting for the swarm
        Answered, // answer verified: backers mine a share of `round`
        Failed // refused, unanswered, or an answer that did not count
    }

    /// @notice A question as the mine writes it into the swarm's oracle body (see imd.fun/docs/#oracle-body).
    struct Spec {
        string question; // 1-2000 bytes of printable ASCII, without `"` or `\`
        uint8 answerType; // 0 bool, 1 address, 2 bytes32, 3 uint256
        uint8 evidence; // 0 chain (the swarm reproduces it from chain data), 1 panel (public sources)
        uint32 chainId; // the chain the question is about
        uint16 windowHours; // the window: the last 1-720 hours before the ask
        uint16 panelSize; // 5-100 agents
        uint16 quorum; // matching answers needed: at least 4, and more than half the panel
        uint16 toleranceBps; // uint256 answers only: how far answers may differ and still agree
    }

    /// @dev Four slots; what an answer updates (adapter, round, status) shares one.
    struct Question {
        bytes32 bodyHash;
        address proposer;
        uint64 deadline;
        uint32 version; // the config (adapter, action) it was proposed under
        uint128 target;
        uint128 raised;
        bytes32 requestId;
        address adapter;
        uint32 round;
        Status status;
    }

    struct Round {
        uint128 shares; // IMD paid by the questions answered in the round
        uint128 reward; // HMM for the round's backers, after the dev share
    }

    /// @notice A snapshot for front ends.
    struct Stats {
        uint256 reserve;
        uint256 genesis;
        uint256 baseRate;
        uint256 assigned;
        uint256 claimed;
        uint256 devOwed;
        uint256 devPaid;
        uint256 questions;
        uint256 round;
        uint256 roundEndsAt;
        uint256 era;
        uint256 rate;
        uint256 pot;
        uint256 roundShares;
        uint256 price;
        uint256 nextHalvingAt;
    }

    uint256 public constant MAX_QUESTION_BYTES = 2000;
    uint256 public constant MIN_PANEL = 5;
    uint256 public constant MAX_PANEL = 100;
    uint256 public constant MIN_QUORUM = 4;
    uint256 public constant MAX_WINDOW_HOURS = 720;
    uint256 public constant MIN_BACKING = 0.01 ether; // 0.01 IMD, unless less is left to raise
    uint256 public constant FUNDING_WINDOW = 3 days;
    uint256 public constant CONFIG_DELAY = 3 days;
    uint256 public constant MAX_DEV_BPS = 1000;
    uint256 internal constant MAX_ERAS = 64;
    /// @dev Transient flag: an Intake request was already made in this transaction. The swarm serves only the first
    /// request of a transaction, so a second would be paid for and never answered.
    uint256 internal constant ASKED_SLOT = 0x534c0e59f1b4114882e507990b4fa198c48a38b755fa8f7328f2ce350a78199c;

    IERC20 public immutable hmm;
    IERC20 public immutable imd;
    IIntake public immutable intake;
    address public immutable forwarder;
    address public immutable dev;
    uint256 public immutable devBps;
    uint256 public immutable roundLength;
    uint256 public immutable eraLength;
    uint256 public immutable genesisDelay;

    bytes32 public action;
    address public adapter;
    /// @notice Bumped by every applied config; a question can only be asked under the config it was proposed under.
    uint32 public configVersion;
    address public steward;
    address public pendingAdapter;
    bytes32 public pendingAction;
    uint256 public pendingEta;

    uint256 public reserve;
    uint256 public genesis;
    uint256 public baseRate;
    /// @notice HMM emitted into answered rounds so far (backers' rewards plus the dev share).
    uint256 public assigned;
    uint256 public claimedTotal;
    uint256 public devPaid;
    /// @notice IMD held for questions still raising.
    uint256 public openRaised;
    uint256 public questionCount;

    mapping(uint256 id => Question) internal _questions;
    mapping(bytes32 requestId => uint256 id) public questionOf;
    mapping(uint256 id => mapping(address backer => uint256 amount)) public backing;
    mapping(uint256 round => Round) public rounds;

    event Started(uint256 reserve, uint256 genesis, uint256 baseRate);
    event Proposed(uint256 indexed id, address indexed proposer, uint256 target, uint256 deadline, bytes body);
    event Backed(uint256 indexed id, address indexed backer, uint256 amount, uint256 raised);
    event Asked(uint256 indexed id, bytes32 indexed requestId, address adapter);
    event RoundOpened(uint256 indexed round, uint256 emitted, uint256 devShare);
    event Answered(uint256 indexed id, bytes32 indexed requestId, uint256 indexed round, uint256 shares);
    event Failed(uint256 indexed id, bytes32 indexed requestId, uint8 status, bytes32 reason);
    event Refunded(uint256 indexed id, address indexed backer, uint256 amount);
    event Claimed(uint256 indexed id, address indexed backer, uint256 amount);
    event DevPaid(address indexed dev, uint256 amount);
    event ConfigQueued(address adapter, bytes32 action, uint256 eta);
    event ConfigCancelled();
    event ConfigApplied(address adapter, bytes32 action);
    event StewardChanged(address indexed previous, address indexed next);

    error ZeroAddress();
    error ZeroAction();
    error BadSchedule();
    error DevShareTooHigh();
    error NotForwarder();
    error AlreadyStarted();
    error NothingToMine();
    error NotLive();
    error BadQuestion();
    error BadSpec();
    error NotSold();
    error TooSmall();
    error NotOpen();
    error FundingClosed();
    error BodyMismatch();
    error PriceRose(uint256 price, uint256 target);
    error OneAskPerTransaction();
    error CompleterMustBeEOA();
    error ConfigChanged();
    error NotAsked();
    error NotAdapter();
    error NotRefundable();
    error NothingToRefund();
    error NotSteward();
    error NothingQueued();
    error TooEarly(uint256 eta);
    error AdapterNotBound();

    modifier onlySteward() {
        if (msg.sender != steward) revert NotSteward();
        _;
    }

    /// @param hmm_ The mined token (the launch's `$token`).
    /// @param imd_ IMD on this chain: what questions are paid in.
    /// @param intake_ The IMD Intake (version 2).
    /// @param action_ The oracle action id, `bytes32("oracle.request@oracle-1")` today.
    /// @param forwarder_ The GenesisForwarder that will move the mining reserve in and start the clock.
    /// @param adapter_ The oracle adapter for new questions; bound to this mine here.
    /// @param dev_ Receives `devBps` of every round.
    /// @param devBps_ Dev share of every round, at most `MAX_DEV_BPS`.
    /// @param roundLength_ Seconds per round (block).
    /// @param eraLength_ Seconds per halving era.
    /// @param genesisDelay_ Seconds between the reserve arriving and the first round.
    constructor(
        address hmm_,
        address imd_,
        address intake_,
        bytes32 action_,
        address forwarder_,
        address adapter_,
        address dev_,
        uint256 devBps_,
        uint256 roundLength_,
        uint256 eraLength_,
        uint256 genesisDelay_
    ) {
        if (
            hmm_ == address(0) || imd_ == address(0) || intake_ == address(0) || forwarder_ == address(0)
                || adapter_ == address(0) || dev_ == address(0)
        ) revert ZeroAddress();
        if (action_ == bytes32(0)) revert ZeroAction();
        if (devBps_ > MAX_DEV_BPS) revert DevShareTooHigh();
        if (roundLength_ == 0 || eraLength_ < roundLength_ || eraLength_ > 100 * 365 days) revert BadSchedule();
        if (genesisDelay_ > 30 days) revert BadSchedule();

        hmm = IERC20(hmm_);
        imd = IERC20(imd_);
        intake = IIntake(intake_);
        forwarder = forwarder_;
        dev = dev_;
        devBps = devBps_;
        roundLength = roundLength_;
        eraLength = eraLength_;
        genesisDelay = genesisDelay_;
        action = action_;
        adapter = adapter_;

        IOracleAdapter(adapter_).bind();
        emit ConfigApplied(adapter_, action_);
    }

    /* ─────────────────────────────── start ─────────────────────────────── */

    /// @inheritdoc IHmmMine
    function token() external view returns (address) {
        return address(hmm);
    }

    /// @inheritdoc IHmmMine
    function started() public view returns (bool) {
        return genesis != 0;
    }

    /// @inheritdoc IHmmMine
    /// @dev Whatever HMM the mine holds now is the reserve; HMM sent here later is never emitted.
    function start() external {
        if (msg.sender != forwarder) revert NotForwarder();
        if (genesis != 0) revert AlreadyStarted();
        uint256 balance = hmm.balanceOf(address(this));
        if (balance == 0) revert NothingToMine();
        uint256 rate = balance / (2 * eraLength);
        if (rate == 0) revert NothingToMine();
        reserve = balance;
        baseRate = rate;
        genesis = block.timestamp + genesisDelay;
        emit Started(balance, genesis, rate);
    }

    /* ───────────────────────────── questions ───────────────────────────── */

    /// @notice Proposes a question and backs it with `amount` IMD (capped at the price). With the full price it is
    /// asked at once. Its body (`bodyOf(spec)`) goes on chain for good.
    /// @return id The question id.
    function propose(Spec calldata spec, uint256 amount) external nonReentrant returns (uint256 id) {
        _requireLive();
        bytes memory body = bodyOf(spec);
        uint256 price = intake.priceOf(action, address(imd));
        if (price == 0) revert NotSold();
        if (amount > price) amount = price;
        if (amount < Math.min(MIN_BACKING, price)) revert TooSmall();

        id = ++questionCount;
        Question storage q = _questions[id];
        q.bodyHash = keccak256(body);
        q.proposer = msg.sender;
        q.deadline = uint64(block.timestamp + FUNDING_WINDOW);
        q.version = configVersion;
        q.target = uint128(price);
        q.status = Status.Open;
        emit Proposed(id, msg.sender, price, q.deadline, body);

        _back(id, q, amount, body);
    }

    /// @notice Backs an open question with `amount` IMD (capped at what is left to raise). The backer who completes
    /// the price passes the question's body (from its `Proposed` event), and the question is asked in this call. When
    /// others have IMD in it, the completing backer must be an account calling directly (see `_back`).
    function back(uint256 id, uint256 amount, bytes calldata body) external nonReentrant {
        _requireLive();
        Question storage q = _questions[id];
        if (q.status != Status.Open) revert NotOpen();
        if (block.timestamp > q.deadline) revert FundingClosed();
        uint256 left = q.target - q.raised;
        if (amount > left) amount = left;
        if (amount < Math.min(MIN_BACKING, left)) revert TooSmall();
        _back(id, q, amount, body);
    }

    /// @notice Returns the caller's IMD from a question that did not raise its price before its deadline.
    function refund(uint256 id) external nonReentrant {
        Question storage q = _questions[id];
        if (q.status != Status.Open || block.timestamp <= q.deadline) revert NotRefundable();
        uint256 amount = backing[id][msg.sender];
        if (amount == 0) revert NothingToRefund();
        backing[id][msg.sender] = 0;
        q.raised -= uint128(amount);
        openRaised -= amount;
        imd.safeTransfer(msg.sender, amount);
        emit Refunded(id, msg.sender, amount);
    }

    /// @notice Claims the caller's HMM from answered questions whose round has ended.
    function claim(uint256[] calldata ids) external nonReentrant returns (uint256 total) {
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];
            uint256 amount = claimable(id, msg.sender);
            if (amount == 0) continue;
            backing[id][msg.sender] = 0;
            total += amount;
            emit Claimed(id, msg.sender, amount);
        }
        if (total != 0) {
            claimedTotal += total;
            hmm.safeTransfer(msg.sender, total);
        }
    }

    /// @notice Sends the dev share accrued so far to `dev`. Anyone may call.
    function payDev() external nonReentrant returns (uint256 amount) {
        amount = devOwed();
        if (amount == 0) return 0;
        devPaid += amount;
        hmm.safeTransfer(dev, amount);
        emit DevPaid(dev, amount);
    }

    /* ─────────────────────────── the swarm's word ─────────────────────────── */

    /// @inheritdoc IHmmMine
    function credit(bytes32 requestId) external nonReentrant {
        uint256 id = questionOf[requestId];
        Question storage q = _questions[id];
        if (id == 0 || q.status != Status.Asked) revert NotAsked();
        if (msg.sender != q.adapter) revert NotAdapter();

        // A question is asked only after genesis, so its answer always lands in a round.
        uint256 r = (block.timestamp - genesis) / roundLength;
        Round storage round = rounds[r];
        if (round.shares == 0) {
            // First answer of the round: it carries everything emitted since the last answered round ended.
            uint256 cumulative = emittedAt(genesis + (r + 1) * roundLength);
            uint256 emitted = cumulative - assigned;
            assigned = cumulative;
            // Rounded up here and down in `devOwed`, so rewards plus the dev share never exceed `assigned`.
            uint256 devShare = Math.mulDiv(emitted, devBps, 10_000, Math.Rounding.Ceil);
            round.reward = uint128(emitted - devShare);
            emit RoundOpened(r, emitted, devShare);
        }
        uint256 shares = q.target;
        round.shares += uint128(shares);
        q.round = uint32(r);
        q.status = Status.Answered;
        emit Answered(id, requestId, r, shares);
    }

    /// @inheritdoc IHmmMine
    function fail(bytes32 requestId, uint8 status, bytes32 reason) external nonReentrant {
        uint256 id = questionOf[requestId];
        Question storage q = _questions[id];
        if (id == 0 || q.status != Status.Asked) revert NotAsked();
        if (msg.sender != q.adapter) revert NotAdapter();
        q.status = Status.Failed;
        emit Failed(id, requestId, status, reason);
    }

    /* ─────────────────────────────── steward ─────────────────────────────── */

    /// @notice Queues a new adapter and action id for questions asked after `applyConfig`.
    function queueConfig(address nextAdapter, bytes32 nextAction) external onlySteward {
        if (nextAdapter == address(0)) revert ZeroAddress();
        if (nextAction == bytes32(0)) revert ZeroAction();
        pendingAdapter = nextAdapter;
        pendingAction = nextAction;
        pendingEta = block.timestamp + CONFIG_DELAY;
        emit ConfigQueued(nextAdapter, nextAction, pendingEta);
    }

    function cancelConfig() external onlySteward {
        if (pendingEta == 0) revert NothingQueued();
        delete pendingAdapter;
        delete pendingAction;
        delete pendingEta;
        emit ConfigCancelled();
    }

    /// @notice Applies the queued config once its delay has passed. Anyone may call.
    function applyConfig() external nonReentrant {
        uint256 eta = pendingEta;
        if (eta == 0) revert NothingQueued();
        if (block.timestamp < eta) revert TooEarly(eta);
        address next = pendingAdapter;
        IOracleAdapter(next).bind();
        if (IOracleAdapter(next).mine() != address(this)) revert AdapterNotBound();
        adapter = next;
        action = pendingAction;
        ++configVersion;
        delete pendingAdapter;
        delete pendingAction;
        delete pendingEta;
        emit ConfigApplied(next, action);
    }

    /// @notice Hands the steward role on; `address(0)` renounces it for good.
    function setSteward(address next) external onlySteward {
        emit StewardChanged(steward, next);
        steward = next;
    }

    /* ─────────────────────────────── views ─────────────────────────────── */

    function question(uint256 id) external view returns (Question memory) {
        return _questions[id];
    }

    /// @notice The oracle body the mine sends for `spec`: compact JSON, fixed field order. Reverts if `spec` breaks a
    /// rule, so front ends can preview (and check with the swarm) exactly what will be asked.
    function bodyOf(Spec calldata spec) public pure returns (bytes memory) {
        _checkSpec(spec);
        bytes memory head = abi.encodePacked(
            '{"v":1,"question":"',
            spec.question,
            '","chainId":',
            Strings.toString(spec.chainId),
            ',"window":{"hours":',
            Strings.toString(spec.windowHours),
            '},"answerType":"',
            _answerTypeName(spec.answerType),
            '","evidence":"',
            spec.evidence == 0 ? _CHAIN : _PANEL
        );
        bytes memory tail = abi.encodePacked(
            '","panelSize":',
            Strings.toString(spec.panelSize),
            ',"quorum":',
            Strings.toString(spec.quorum),
            ',"validForSeconds":86400',
            spec.answerType == 3
                ? abi.encodePacked(',"toleranceBps":', Strings.toString(spec.toleranceBps))
                : bytes(""),
            "}"
        );
        return bytes.concat(head, tail);
    }

    /// @notice The dev share accrued and not yet paid: `devBps` of everything emitted into answered rounds.
    function devOwed() public view returns (uint256) {
        return assigned * devBps / 10_000 - devPaid;
    }

    /// @notice HMM `backer` can claim from question `id` now.
    function claimable(uint256 id, address backer) public view returns (uint256) {
        Question storage q = _questions[id];
        if (q.status != Status.Answered) return 0;
        uint256 r = q.round;
        if (block.timestamp < roundEnd(r)) return 0;
        uint256 amount = backing[id][backer];
        if (amount == 0) return 0;
        Round storage round = rounds[r];
        return Math.mulDiv(round.reward, amount, round.shares);
    }

    /// @notice HMM emitted by the schedule from genesis to `t`, whether or not rounds were answered.
    function emittedAt(uint256 t) public view returns (uint256 total) {
        uint256 g = genesis;
        if (g == 0 || t <= g) return 0;
        uint256 elapsed = t - g;
        uint256 era = elapsed / eraLength;
        uint256 rate = baseRate;
        uint256 full = era < MAX_ERAS ? era : MAX_ERAS;
        for (uint256 i; i < full; ++i) {
            total += rate * eraLength;
            rate >>= 1;
        }
        if (era < MAX_ERAS) total += rate * (elapsed - era * eraLength);
    }

    /// @notice Emission per second at `t`.
    function rateAt(uint256 t) public view returns (uint256) {
        uint256 g = genesis;
        if (g == 0 || t < g) return 0;
        uint256 era = (t - g) / eraLength;
        return era < MAX_ERAS ? baseRate >> era : 0;
    }

    function roundEnd(uint256 r) public view returns (uint256) {
        return genesis + (r + 1) * roundLength;
    }

    /// @notice The current round; zero before genesis.
    function currentRound() public view returns (uint256) {
        uint256 g = genesis;
        if (g == 0 || block.timestamp < g) return 0;
        return (block.timestamp - g) / roundLength;
    }

    /// @notice HMM the current round's backers would share (after the dev share) if it ended now with its answers.
    function pot() public view returns (uint256) {
        if (!_live()) return 0;
        uint256 r = currentRound();
        Round storage round = rounds[r];
        if (round.shares != 0) return round.reward;
        uint256 emitted = emittedAt(roundEnd(r)) - assigned;
        return emitted - Math.mulDiv(emitted, devBps, 10_000, Math.Rounding.Ceil);
    }

    function stats() external view returns (Stats memory s) {
        s.reserve = reserve;
        s.genesis = genesis;
        s.baseRate = baseRate;
        s.assigned = assigned;
        s.claimed = claimedTotal;
        s.devOwed = devOwed();
        s.devPaid = devPaid;
        s.questions = questionCount;
        s.price = intake.priceOf(action, address(imd));
        if (genesis == 0) return s;
        s.round = currentRound();
        s.roundEndsAt = roundEnd(s.round);
        uint256 t = block.timestamp < genesis ? genesis : block.timestamp;
        s.era = (t - genesis) / eraLength;
        s.rate = rateAt(t);
        s.nextHalvingAt = genesis + (s.era + 1) * eraLength;
        s.pot = pot();
        s.roundShares = rounds[s.round].shares;
    }

    /* ─────────────────────────────── internal ─────────────────────────────── */

    function _live() internal view returns (bool) {
        uint256 g = genesis;
        return g != 0 && block.timestamp >= g;
    }

    function _requireLive() internal view {
        if (!_live()) revert NotLive();
    }

    string internal constant _CHAIN = "chain";
    string internal constant _PANEL = "panel";

    function _answerTypeName(uint8 t) internal pure returns (string memory) {
        if (t == 0) return "bool";
        if (t == 1) return "address";
        if (t == 2) return "bytes32";
        return "uint256";
    }

    function _checkSpec(Spec calldata spec) internal pure {
        bytes calldata text = bytes(spec.question);
        uint256 n = text.length;
        if (n == 0 || n > MAX_QUESTION_BYTES) revert BadQuestion();
        for (uint256 i; i < n; ++i) {
            bytes1 c = text[i];
            // printable ASCII only, and nothing that could end or escape the JSON string
            if (c < 0x20 || c > 0x7e || c == 0x22 || c == 0x5c) revert BadQuestion();
        }
        uint256 chainId = spec.chainId;
        if (
            spec.answerType > 3 || spec.evidence > 1
                || (chainId != 1 && chainId != 56 && chainId != 4663 && chainId != 8453 && chainId != 42161)
                || spec.windowHours == 0 || spec.windowHours > MAX_WINDOW_HOURS || spec.panelSize < MIN_PANEL
                || spec.panelSize > MAX_PANEL || spec.quorum < MIN_QUORUM || spec.quorum > spec.panelSize
                || uint256(spec.quorum) * 2 <= spec.panelSize
                || (spec.answerType == 3 ? spec.toleranceBps > 10_000 : spec.toleranceBps != 0)
        ) revert BadSpec();
    }

    function _back(uint256 id, Question storage q, uint256 amount, bytes memory body) internal {
        imd.safeTransferFrom(msg.sender, address(this), amount);
        uint256 mine_ = backing[id][msg.sender] + amount;
        backing[id][msg.sender] = mine_;
        uint256 raised = q.raised + amount;
        q.raised = uint128(raised);
        openRaised += amount;
        emit Backed(id, msg.sender, amount, raised);
        if (raised == q.target) {
            // The swarm serves only the first Intake request of a transaction. When other backers' IMD is in the
            // question, the account completing it must call directly (tx.origin), so no earlier request can precede
            // the mine's in this transaction; someone asking with only their own IMD may use any account.
            // forge-lint: disable-next-line(tx-origin)
            if (mine_ != raised && msg.sender != tx.origin) revert CompleterMustBeEOA();
            _ask(id, q, body);
        }
    }

    function _ask(uint256 id, Question storage q, bytes memory body) internal {
        if (keccak256(body) != q.bodyHash) revert BodyMismatch();
        if (q.version != configVersion) revert ConfigChanged();
        uint256 askedThisTx;
        assembly ("memory-safe") {
            askedThisTx := tload(ASKED_SLOT)
        }
        if (askedThisTx != 0) revert OneAskPerTransaction();
        assembly ("memory-safe") {
            tstore(ASKED_SLOT, 1)
        }

        uint256 price = q.target;
        bytes32 act = action;
        uint256 live = intake.priceOf(act, address(imd));
        if (live == 0) revert NotSold();
        if (live > price) revert PriceRose(live, price);

        address a = adapter;
        q.adapter = a;
        q.status = Status.Asked;
        openRaised -= price;

        (bytes4 onResult, bytes4 onFailure) = IOracleAdapter(a).callbackSelectors();
        imd.forceApprove(address(intake), price);
        bytes32 requestId =
            intake.requestWithFailure(act, body, IIntake.Callback(a, onResult), onFailure, address(imd), price);
        q.requestId = requestId;
        questionOf[requestId] = id;
        emit Asked(id, requestId, a);
    }
}
