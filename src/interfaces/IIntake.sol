// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The parts of the IMD Intake (version 2) that hmm uses. One deployment per chain at
/// 0xa43e6f75ee006411f79ac1c84120606c2330de82; see https://imd.fun/docs/#intake.
interface IIntake {
    struct Callback {
        address target;
        bytes4 selector;
    }

    /// @notice Pays for `action` and asks it, pulling `amount` of `asset` from the caller.
    function requestWithFailure(
        bytes32 action,
        bytes calldata body,
        Callback calldata callback,
        bytes4 onFailure,
        address asset,
        uint256 amount
    ) external payable returns (bytes32 requestId);

    /// @notice Price per action and asset; zero means the action is not sold in that asset.
    function priceOf(bytes32 action, address asset) external view returns (uint256 amount);

    function requests(bytes32 requestId)
        external
        view
        returns (address payer, address callbackTarget, bytes4 callbackSelector, bool completed);

    function callbackGas() external view returns (uint64);
}
