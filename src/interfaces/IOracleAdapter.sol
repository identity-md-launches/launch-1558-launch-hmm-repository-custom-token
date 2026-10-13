// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice What HmmMine needs from the contract that receives the swarm's answers for it.
/// The adapter is the Intake callback target: it verifies an answer and tells the mine to credit or fail a question.
interface IOracleAdapter {
    /// @notice The mine this adapter reports to.
    function mine() external view returns (address);

    /// @notice Binds the adapter to the calling mine. Idempotent for that mine; reverts for any other.
    function bind() external;

    /// @notice The selectors the Intake calls back on: one for an answer, one for a refusal or a failure.
    function callbackSelectors() external view returns (bytes4 onResult, bytes4 onFailure);
}
