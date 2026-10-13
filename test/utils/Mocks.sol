// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ILaunchRegistry} from "../../src/interfaces/ILaunchRegistry.sol";

/// @notice Stand-in for IMD in unit tests: a plain ERC-20 anyone can mint.
contract MockIMD is ERC20 {
    constructor() ERC20("Identity.md", "IMD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice A plain token used for copycat and wrong-token scenarios.
contract MockToken is ERC20 {
    constructor(string memory n, uint256 supply) ERC20(n, n) {
        _mint(msg.sender, supply);
    }
}

/// @notice Records launches the way the IMD LaunchRegistry exposes them.
contract MockRegistry is ILaunchRegistry {
    mapping(uint64 => Launch) internal _launches;
    mapping(uint64 => Artifact[]) internal _artifacts;

    function record(uint64 n, bytes32 kind, Artifact[] memory artifacts) external {
        _launches[n].kind = kind;
        _launches[n].launchNumber = n;
        _launches[n].recordedAt = uint64(block.timestamp);
        delete _artifacts[n];
        for (uint256 i; i < artifacts.length; ++i) {
            _artifacts[n].push(artifacts[i]);
        }
    }

    function launchOf(uint64 n) external view returns (Launch memory) {
        return _launches[n];
    }

    function artifactsOf(uint64 n) external view returns (Artifact[] memory) {
        return _artifacts[n];
    }
}
