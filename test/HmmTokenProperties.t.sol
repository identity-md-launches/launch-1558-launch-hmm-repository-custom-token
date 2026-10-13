// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {HmmToken} from "src/HmmToken.sol";

/// @notice Transfer properties apply equally to the factory, pool, distributor and ordinary holders.
contract HmmTokenPropertiesTest is Test {
    HmmToken internal token;
    address internal factory = makeAddr("token factory");
    address internal holder = makeAddr("token holder");
    address internal recipient = makeAddr("token recipient");
    address internal spender = makeAddr("token spender");
    uint256 internal constant SUPPLY = 1_000_000_000 ether;

    function setUp() public {
        vm.prank(factory);
        token = new HmmToken();
        vm.prank(factory);
        token.transfer(holder, SUPPLY);
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_transferAndTransferFromHaveNoFee(uint256 seed, bool delegated) public {
        uint256 amount = bound(seed, 0, SUPPLY);
        if (delegated) {
            vm.prank(holder);
            assertTrue(token.approve(spender, amount));
            vm.prank(spender);
            assertTrue(token.transferFrom(holder, recipient, amount));
            assertEq(token.allowance(holder, spender), 0);
        } else {
            vm.prank(holder);
            assertTrue(token.transfer(recipient, amount));
        }
        assertEq(token.balanceOf(holder), SUPPLY - amount);
        assertEq(token.balanceOf(recipient), amount);
        assertEq(token.balanceOf(factory), 0);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_selfTransfersAndZeroTransfersPreserveBalances() public {
        vm.prank(holder);
        assertTrue(token.transfer(holder, SUPPLY));
        vm.prank(recipient);
        assertTrue(token.transfer(holder, 0));
        vm.prank(holder);
        token.approve(spender, 7);
        vm.prank(spender);
        assertTrue(token.transferFrom(holder, holder, 7));
        assertEq(token.allowance(holder, spender), 0);
        assertEq(token.balanceOf(holder), SUPPLY);
        assertEq(token.balanceOf(recipient), 0);
    }

    function test_infiniteAllowanceIsNotSpentAndCanBeRevoked() public {
        vm.prank(holder);
        token.approve(spender, type(uint256).max);
        vm.prank(spender);
        token.transferFrom(holder, recipient, SUPPLY);
        assertEq(token.allowance(holder, spender), type(uint256).max);
        vm.prank(holder);
        token.approve(spender, 0);
        vm.prank(spender);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, spender, 0, 1));
        token.transferFrom(holder, recipient, 1);
    }

    function test_failedTransferFromRollsBackTheAllowance() public {
        vm.prank(holder);
        token.approve(spender, SUPPLY + 1);
        vm.prank(spender);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, holder, SUPPLY, SUPPLY + 1)
        );
        token.transferFrom(holder, recipient, SUPPLY + 1);
        assertEq(token.allowance(holder, spender), SUPPLY + 1);
        assertEq(token.balanceOf(holder), SUPPLY);
        assertEq(token.balanceOf(recipient), 0);
    }

    function test_zeroReceiverAndSpenderAreRejectedWithoutBurning() public {
        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        token.transfer(address(0), 0);
        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidSpender.selector, address(0)));
        token.approve(address(0), 1);
        vm.prank(holder);
        token.approve(spender, 1);
        vm.prank(spender);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        token.transferFrom(holder, address(0), 1);
        assertEq(token.allowance(holder, spender), 1);
        assertEq(token.balanceOf(address(0)), 0);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_factoryAndStrangerHaveNoAdministrativeOrBurnPowers() public {
        bytes[] memory calls = new bytes[](12);
        calls[0] = abi.encodeWithSignature("mint(address,uint256)", recipient, 1);
        calls[1] = abi.encodeWithSignature("burn(uint256)", 1);
        calls[2] = abi.encodeWithSignature("burnFrom(address,uint256)", holder, 1);
        calls[3] = abi.encodeWithSignature("pause()");
        calls[4] = abi.encodeWithSignature("blacklist(address)", holder);
        calls[5] = abi.encodeWithSignature("freeze(address)", holder);
        calls[6] = abi.encodeWithSignature("seize(address,address,uint256)", holder, recipient, 1);
        calls[7] = abi.encodeWithSignature("transferOwnership(address)", recipient);
        calls[8] = abi.encodeWithSignature("setMinter(address)", recipient);
        calls[9] = abi.encodeWithSignature("initialize(address)", recipient);
        calls[10] = abi.encodeWithSignature("upgradeTo(address)", recipient);
        calls[11] = abi.encodeWithSignature("setFee(uint256)", 1000);
        for (uint256 i; i < calls.length; ++i) {
            for (uint256 j; j < 2; ++j) {
                vm.prank(j == 0 ? factory : spender);
                (bool ok,) = address(token).call(calls[i]);
                assertFalse(ok, "unexpected administrative entry point");
                assertEq(token.balanceOf(holder), SUPPLY);
                assertEq(token.totalSupply(), SUPPLY);
            }
        }
        vm.prank(holder);
        assertTrue(token.transfer(recipient, SUPPLY), "holder remains free to move everything");
    }
}

/// @dev Independent ledger: randomized approvals and transfers are checked against inputs, not token getters.
contract HmmTokenLedgerHandler is Test {
    HmmToken public immutable token;
    address[5] public actors;
    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowances;
    uint256 public successfulTransfers;
    uint256 public rejectedTransfers;

    constructor() {
        token = new HmmToken();
        for (uint256 i; i < actors.length; ++i) {
            actors[i] = address(uint160(uint256(keccak256(abi.encode("token actor", i)))));
            balances[actors[i]] = token.totalSupply() / actors.length;
            token.transfer(actors[i], balances[actors[i]]);
        }
    }

    function approve(uint256 ownerSeed, uint256 spenderSeed, uint256 amount, bool infinite) external {
        address owner = actors[ownerSeed % actors.length];
        address spender = actors[spenderSeed % actors.length];
        amount = infinite ? type(uint256).max : bound(amount, 0, token.totalSupply());
        vm.prank(owner);
        assertTrue(token.approve(spender, amount));
        allowances[owner][spender] = amount;
    }

    function transfer(uint256 fromSeed, uint256 toSeed, uint256 seed, bool invalid) external {
        address from = actors[fromSeed % actors.length];
        address to = actors[toSeed % actors.length];
        uint256 amount = invalid ? balances[from] + 1 : bound(seed, 0, balances[from]);
        if (invalid) {
            vm.prank(from);
            vm.expectRevert(
                abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, from, balances[from], amount)
            );
            token.transfer(to, amount);
            ++rejectedTransfers;
        } else {
            vm.prank(from);
            assertTrue(token.transfer(to, amount));
            balances[from] -= amount;
            balances[to] += amount;
            ++successfulTransfers;
        }
    }

    function transferFrom(uint256 spenderSeed, uint256 fromSeed, uint256 toSeed, uint256 seed, bool invalid) external {
        address spender = actors[spenderSeed % actors.length];
        address from = actors[fromSeed % actors.length];
        address to = actors[toSeed % actors.length];
        uint256 approved = allowances[from][spender];
        uint256 limit = approved < balances[from] ? approved : balances[from];
        uint256 amount = invalid ? limit + 1 : bound(seed, 0, limit);
        if (invalid) {
            bytes memory reason = approved < amount
                ? abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, spender, approved, amount)
                : abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, from, balances[from], amount);
            vm.prank(spender);
            vm.expectRevert(reason);
            token.transferFrom(from, to, amount);
            ++rejectedTransfers;
        } else {
            vm.prank(spender);
            assertTrue(token.transferFrom(from, to, amount));
            if (approved != type(uint256).max) allowances[from][spender] -= amount;
            balances[from] -= amount;
            balances[to] += amount;
            ++successfulTransfers;
        }
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 100
/// forge-config: default.invariant.fail-on-revert = true
contract HmmTokenLedgerInvariantTest is Test {
    HmmTokenLedgerHandler internal handler;
    HmmToken internal token;

    function setUp() public {
        handler = new HmmTokenLedgerHandler();
        token = handler.token();
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = handler.approve.selector;
        selectors[1] = handler.transfer.selector;
        selectors[2] = handler.transferFrom.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_balancesAndAllowancesMatchTheIndependentLedger() public view {
        uint256 total;
        for (uint256 i; i < 5; ++i) {
            address actor = handler.actors(i);
            assertEq(token.balanceOf(actor), handler.balances(actor));
            total += token.balanceOf(actor);
            for (uint256 j; j < 5; ++j) {
                address spender = handler.actors(j);
                assertEq(token.allowance(actor, spender), handler.allowances(actor, spender));
            }
        }
        assertEq(total, 1_000_000_000 ether);
        assertEq(token.totalSupply(), total);
        assertEq(token.balanceOf(address(handler)), 0);
        assertEq(token.balanceOf(address(0)), 0);
    }
}
