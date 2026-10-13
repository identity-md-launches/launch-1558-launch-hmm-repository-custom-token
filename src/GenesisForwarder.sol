// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ILaunchRegistry} from "./interfaces/ILaunchRegistry.sol";
import {IHmmMine} from "./interfaces/IHmmMine.sol";

/// @title GenesisForwarder
/// @notice The launch's `remainderTo`. The IMD factory sends the mining reserve here, because a launch can only name an
/// address that exists before it; `forward` then moves it into the launch's own HmmMine and starts the clock.
///
/// Stateless and permissionless: `forward(n)` reads launch `n` from the factory's registry, finds its token and the
/// contract named `mineName`, checks that mine mines that token and points back here, and hands it every unit of that
/// token this contract holds. A launch can only ever send its own token to its own mine, so a copycat launch that
/// names this forwarder cannot touch another launch's reserve.
contract GenesisForwarder {
    using SafeERC20 for IERC20;

    bytes32 public constant CUSTOM_TOKEN = "custom_token";
    bytes32 public constant ROLE_TOKEN = "token";
    bytes32 public constant ROLE_OTHER = "other";

    ILaunchRegistry public immutable registry;
    bytes32 public immutable mineName;

    event Forwarded(uint64 indexed launchNumber, address indexed token, address indexed mine, uint256 amount);

    error ZeroAddress();
    error NotCustomTokenLaunch(uint64 launchNumber);
    error MissingArtifact(uint64 launchNumber);
    error WrongMine(address mine);
    error NothingHeld(address token);

    /// @param registry_ The chain's `ProjectFactory.registry()`.
    /// @param mineName_ The mine's contract name as the registry records it, e.g. bytes32("HmmMine").
    constructor(address registry_, bytes32 mineName_) {
        if (registry_ == address(0) || mineName_ == bytes32(0)) revert ZeroAddress();
        registry = ILaunchRegistry(registry_);
        mineName = mineName_;
    }

    /// @notice Moves launch `launchNumber`'s reserve into its mine and starts mining. Anyone may call, once per mine.
    function forward(uint64 launchNumber) external returns (uint256 amount) {
        if (registry.launchOf(launchNumber).kind != CUSTOM_TOKEN) revert NotCustomTokenLaunch(launchNumber);
        ILaunchRegistry.Artifact[] memory artifacts = registry.artifactsOf(launchNumber);

        address token;
        address mine;
        for (uint256 i; i < artifacts.length; ++i) {
            ILaunchRegistry.Artifact memory a = artifacts[i];
            if (a.role == ROLE_TOKEN && token == address(0)) token = a.addr;
            else if (a.role == ROLE_OTHER && a.name == mineName && mine == address(0)) mine = a.addr;
        }
        if (token == address(0) || mine == address(0)) revert MissingArtifact(launchNumber);
        if (IHmmMine(mine).token() != token || IHmmMine(mine).forwarder() != address(this)) revert WrongMine(mine);

        amount = IERC20(token).balanceOf(address(this));
        if (amount == 0) revert NothingHeld(token);
        IERC20(token).safeTransfer(mine, amount);
        IHmmMine(mine).start(); // reverts if this mine already started
        emit Forwarded(launchNumber, token, mine, amount);
    }
}
