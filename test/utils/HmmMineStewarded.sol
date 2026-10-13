// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {HmmMine} from "../../src/HmmMine.sol";

/// @notice Test-only: an HmmMine with a steward, so the tests can exercise the timelocked config logic that the real
/// mine (which has no steward) can never reach. Same arguments as HmmMine, plus `steward_` in its old place.
contract HmmMineStewarded is HmmMine {
    constructor(
        address hmm_,
        address imd_,
        address intake_,
        bytes32 action_,
        address forwarder_,
        address adapter_,
        address steward_,
        address dev_,
        uint256 devBps_,
        uint256 roundLength_,
        uint256 eraLength_,
        uint256 genesisDelay_
    ) HmmMine(hmm_, imd_, intake_, action_, forwarder_, adapter_, dev_, devBps_, roundLength_, eraLength_, genesisDelay_) {
        steward = steward_;
        emit StewardChanged(address(0), steward_);
    }
}
