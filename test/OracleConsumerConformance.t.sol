// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HmmTestBase} from "./utils/HmmTestBase.sol";
import {HmmMine} from "../src/HmmMine.sol";
import {SwarmOracleAdapter} from "../src/SwarmOracleAdapter.sol";

/// @notice Protocol vector copied from the supplied oracle-consumer reference. Only consumer setup and API names
/// are adapted: the mine uses same-chain Intake v2 callbacks, with the adapter as the EIP-712 verifying contract.
contract OracleConsumerConformanceTest is HmmTestBase {
    uint256 constant VECTOR_CHAIN = 11155111;
    address constant VECTOR_CONSUMER = 0x0000000000000000000000000000000000002748;
    bytes32 constant VECTOR_DIGEST = 0x95fefa8b7c529852f4e2b6aec888930eb2bf5078e6443a85808e36df19e1325c;
    bytes constant VECTOR_SIGNATURE =
        hex"a26b14918607eb565af126beb54d3c5d19e923c41506def500b3521a4f9aa6d603ab44fd22f15dd2191732961a7131e4641244add8b0f09f20e6ae64381be8481b";
    address constant SIGNER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    uint256 constant SIGNER_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint64 constant ISSUED_AT = 1800000000;
    uint64 constant EXPIRES_AT = 1800003600;
    string constant CALLBACK =
        "onOracleResult(bytes32,(bytes32,uint256,bytes32,uint8,bytes,uint256,uint64,uint64,bytes32,bytes32,uint16,uint16,uint16,uint64,uint64),bytes)";

    function setUp() public override {
        super.setUp();
        vm.chainId(VECTOR_CHAIN);
        vm.warp(ISSUED_AT);
        deployCodeTo(
            "SwarmOracleAdapter.sol:SwarmOracleAdapter", abi.encode(address(intake), SIGNER, 5, 4), VECTOR_CONSUMER
        );
        adapter = SwarmOracleAdapter(VECTOR_CONSUMER);
        mine = new HmmMine(
            address(hmm),
            address(imd),
            address(intake),
            ACTION,
            address(forwarder),
            VECTOR_CONSUMER,
            dev,
            500,
            ROUND,
            ERA,
            0
        );
        vm.prank(makeAddr("pool"));
        hmm.transfer(address(mine), 1 ether);
        vm.prank(address(forwarder));
        mine.start();
        vm.prank(alice);
        imd.approve(address(mine), type(uint256).max);
    }

    function vector() internal pure returns (SwarmOracleAdapter.Attestation memory a) {
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = bytes32(uint256(1));
        a = SwarmOracleAdapter.Attestation({
            requestId: 0x0000000000004000800000000000000100000000000000000000000000000000,
            chainId: 1,
            questionHash: 0x2117f4362ebfa37aa8a8c0fed548604fe09ac46faf8ae7559cd64780f26a46fb,
            answerType: 5,
            answer: abi.encode(ids),
            figure: 12345,
            fromBlock: 100,
            toBlock: 200,
            blockHash: bytes32(uint256(7)),
            panelJobId: 0x0000000000004000800000000000000200000000000000000000000000000000,
            panelSize: 5,
            quorum: 4,
            agreed: 5,
            issuedAt: ISSUED_AT,
            expiresAt: EXPIRES_AT
        });
    }

    function test_digestMatchesTheProtocol() public view {
        assertEq(adapter.digest(vector(), VECTOR_CHAIN, VECTOR_CONSUMER), VECTOR_DIGEST);
        assertEq(adapter.check(vector(), VECTOR_SIGNATURE), bytes32(0));
    }

    function test_callbackSelectorIsCanonical() public view {
        assertEq(adapter.onOracleResult.selector, bytes4(keccak256(bytes(CALLBACK))));
    }

    function test_acceptsTheProtocolSignatureAsDelivered() public {
        (uint256 id, bytes32 rid) = _ask(alice, "protocol vector");
        assertTrue(_answerWith(rid, vector(), VECTOR_SIGNATURE), "callback fits the Intake's 200,000 gas");
        assertTrue(adapter.used(vector().requestId));
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Answered));
    }

    function test_acceptsAFreshSignatureFromTheVectorKeyIncludingNoAnswer() public {
        (uint256 id, bytes32 rid) = _ask(alice, "false is an answer too");
        SwarmOracleAdapter.Attestation memory a = vector();
        a.requestId = keccak256("another request");
        a.answerType = 0;
        a.answer = abi.encode(false);
        assertTrue(_answerWith(rid, a, _sign(a, VECTOR_CONSUMER, SIGNER_KEY)));
        assertTrue(adapter.used(a.requestId));
        assertEq(uint8(_status(id)), uint8(HmmMine.Status.Answered));
    }
}
