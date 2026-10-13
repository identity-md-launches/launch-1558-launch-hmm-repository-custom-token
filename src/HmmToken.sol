// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title hmm
/// @notice A plain, fixed-supply ERC-20. The whole supply is minted once to the deployer (the IMD launch factory).
/// No owner, no mint after construction, no fee and no rule on transfer: everything hmm does lives in HmmMine.
contract HmmToken is ERC20 {
    uint256 public constant SUPPLY = 1_000_000_000 ether;

    constructor() ERC20("hmm", "HMM") {
        _mint(msg.sender, SUPPLY);
    }
}
