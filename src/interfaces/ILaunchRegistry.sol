// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The IMD ProjectFactory's public launch record (`ProjectFactory.registry()`).
/// Roles and names are left-aligned ASCII: role "token", "distributor", "hook" or "other"; name = contract name.
interface ILaunchRegistry {
    struct Launch {
        bytes32 kind;
        uint64 launchNumber;
        uint64 recordedAt;
        bytes32 sourceCommit;
        bytes32 manifestHash;
        bytes32 attestationHash;
        bytes32 verifierKey;
        string sourceRepoUrl;
    }

    struct Artifact {
        bytes32 role;
        bytes32 name;
        address addr;
    }

    function launchOf(uint64 launchNumber) external view returns (Launch memory);

    function artifactsOf(uint64 launchNumber) external view returns (Artifact[] memory);
}
