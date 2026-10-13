// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The mine's surface used by its adapter and its genesis forwarder.
interface IHmmMine {
    function token() external view returns (address);

    function forwarder() external view returns (address);

    function started() external view returns (bool);

    /// @notice Called once by the forwarder after it moved the mining reserve in.
    function start() external;

    /// @notice Called by a question's adapter when the swarm's answer verified.
    function credit(bytes32 requestId) external;

    /// @notice Called by a question's adapter when the swarm refused, failed or gave an answer that does not count.
    function fail(bytes32 requestId, uint8 status, bytes32 reason) external;
}
