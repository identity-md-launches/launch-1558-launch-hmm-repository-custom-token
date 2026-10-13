// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {HmmTestBase} from "./utils/HmmTestBase.sol";
import {RealAttestations} from "./fixtures/RealAttestations.sol";
import {SwarmOracleAdapter} from "../src/SwarmOracleAdapter.sol";
import {HmmMine} from "../src/HmmMine.sol";

contract SwarmOracleAdapterTest is HmmTestBase {
    /* ───────────── the encoding matches what the swarm signs ───────────── */

    /// @dev Five answers the IMD oracle really signed (bool, uint256, address, address[]; with and without a consumer
    /// contract; mainnet and Sepolia domains) must recover to the real oracle signer.
    function test_realSwarmSignatures_recoverTheOracleSigner() public view {
        RealAttestations.Vector[] memory v = RealAttestations.all();
        for (uint256 i; i < v.length; ++i) {
            bytes32 d = adapter.digest(v[i].a, v[i].domainChainId, v[i].verifyingContract);
            assertEq(ECDSA.recover(d, v[i].signature), RealAttestations.SIGNER, "real attestation must verify");
        }
    }

    /// @dev Changing any signed field must break the signature.
    function testFuzz_realSignature_breaksOnAnyTamper(uint8 field, uint256 noise) public view {
        RealAttestations.Vector memory v = RealAttestations.all()[0];
        SwarmOracleAdapter.Attestation memory a = v.a;
        noise = bound(noise, 1, type(uint16).max);
        field = uint8(bound(field, 0, 15));
        if (field == 0) a.requestId = bytes32(uint256(a.requestId) ^ noise);
        else if (field == 1) a.chainId += noise;
        else if (field == 2) a.questionHash = bytes32(uint256(a.questionHash) ^ noise);
        else if (field == 3) a.answerType = uint8(uint256(a.answerType) + 1 + noise % 4);
        else if (field == 4) a.answer = abi.encode(uint256(noise) + 7);
        else if (field == 5) a.figure += noise;
        else if (field == 6) a.fromBlock += uint64(noise);
        else if (field == 7) a.toBlock += uint64(noise);
        else if (field == 8) a.blockHash = bytes32(uint256(a.blockHash) ^ noise);
        else if (field == 9) a.panelJobId = bytes32(uint256(a.panelJobId) ^ noise);
        else if (field == 10) a.panelSize = uint16(uint256(a.panelSize) ^ noise);
        else if (field == 11) a.quorum = uint16(uint256(a.quorum) ^ noise);
        else if (field == 12) a.agreed = uint16(uint256(a.agreed) ^ noise);
        else if (field == 13) a.issuedAt += uint64(noise);
        else if (field == 14) a.expiresAt += uint64(noise);
        bytes32 d = adapter.digest(a, field == 15 ? v.domainChainId + noise : v.domainChainId, v.verifyingContract);
        (address rec,,) = ECDSA.tryRecover(d, v.signature);
        assertTrue(rec != RealAttestations.SIGNER);
    }

    function test_selectors_matchTheSwarmsCallbackShape() public view {
        (bytes4 onResult, bytes4 onFailure) = adapter.callbackSelectors();
        // the selector IMD's docs give for an oracle callback, and the failure shape the Intake checks
        assertEq(onResult, bytes4(0x510379c7));
        assertEq(onFailure, bytes4(keccak256("onOracleFailure(bytes32,uint8,bytes32,uint16,uint16,bytes)")));
    }

    /* ───────────── the rules an answer must meet ───────────── */

    function test_check_reasons() public {
        SwarmOracleAdapter.Attestation memory a = _attestation();
        bytes memory sig = _sign(a, address(adapter), oraclePk);
        assertEq(adapter.check(a, sig), bytes32(0));

        SwarmOracleAdapter.Attestation memory b = _attestation();
        b.panelSize = 4;
        assertEq(adapter.check(b, _sign(b, address(adapter), oraclePk)), bytes32("panel_too_small"));

        b = _attestation();
        b.quorum = 3;
        b.agreed = 5;
        assertEq(adapter.check(b, _sign(b, address(adapter), oraclePk)), bytes32("quorum_too_low"));

        b = _attestation();
        b.agreed = 3;
        assertEq(adapter.check(b, _sign(b, address(adapter), oraclePk)), bytes32("not_agreed"));

        // quorum met, but not a majority of a large panel
        b = _attestation();
        b.panelSize = 20;
        b.quorum = 4;
        b.agreed = 10;
        assertEq(adapter.check(b, _sign(b, address(adapter), oraclePk)), bytes32("not_agreed"));
        b.agreed = 11;
        assertEq(adapter.check(b, _sign(b, address(adapter), oraclePk)), bytes32(0));

        b = _attestation();
        b.expiresAt = uint64(block.timestamp - 1);
        assertEq(adapter.check(b, _sign(b, address(adapter), oraclePk)), bytes32("expired"));

        b = _attestation();
        assertEq(adapter.check(b, _sign(b, address(adapter), 0xB0B)), bytes32("bad_signature"));
        // signed for another consumer
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(oraclePk, adapter.digest(b, block.chainid, address(mine)));
        assertEq(adapter.check(b, abi.encodePacked(r, ss, v)), bytes32("bad_signature"));
        // signed for this adapter on another chain
        (v, r, ss) = vm.sign(oraclePk, adapter.digest(b, 11155111, address(adapter)));
        assertEq(adapter.check(b, abi.encodePacked(r, ss, v)), bytes32("bad_signature"));
        // malformed signature
        assertEq(adapter.check(b, hex"1234"), bytes32("bad_signature"));
    }

    function test_onlyTheIntakeCallsBack() public {
        SwarmOracleAdapter.Attestation memory a = _attestation();
        bytes memory sig = _sign(a, address(adapter), oraclePk);
        vm.expectRevert(SwarmOracleAdapter.NotIntake.selector);
        adapter.onOracleResult(bytes32(uint256(1)), a, sig);
        vm.expectRevert(SwarmOracleAdapter.NotIntake.selector);
        adapter.onOracleFailure(bytes32(uint256(1)), 2, "x", 0, 0, "");
    }

    function test_unknownRequestIsRefused() public {
        SwarmOracleAdapter.Attestation memory a = _attestation();
        bytes memory sig = _sign(a, address(adapter), oraclePk);
        vm.prank(address(intake));
        vm.expectRevert(abi.encodeWithSelector(SwarmOracleAdapter.UnknownRequest.selector, bytes32(uint256(1))));
        adapter.onOracleResult(bytes32(uint256(1)), a, sig);
    }

    /* ───────────── binding ───────────── */

    function test_bind_onceAndIdempotent() public {
        SwarmOracleAdapter fresh = new SwarmOracleAdapter(address(intake), oracleSigner, 5, 4);
        assertEq(fresh.mine(), address(0));
        vm.prank(alice);
        fresh.bind();
        assertEq(fresh.mine(), alice);
        vm.prank(alice);
        fresh.bind(); // same caller: no-op
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(SwarmOracleAdapter.AlreadyBound.selector, alice));
        fresh.bind();
    }

    function test_unboundAdapterRefusesCallbacks() public {
        SwarmOracleAdapter fresh = new SwarmOracleAdapter(address(intake), oracleSigner, 5, 4);
        SwarmOracleAdapter.Attestation memory a = _attestation();
        bytes memory sig = _sign(a, address(fresh), oraclePk);
        vm.prank(address(intake));
        vm.expectRevert(SwarmOracleAdapter.NotBound.selector);
        fresh.onOracleResult(bytes32(uint256(1)), a, sig);
    }

    function test_constructor_validates() public {
        vm.expectRevert(SwarmOracleAdapter.ZeroAddress.selector);
        new SwarmOracleAdapter(address(0), oracleSigner, 5, 4);
        vm.expectRevert(SwarmOracleAdapter.ZeroAddress.selector);
        new SwarmOracleAdapter(address(intake), address(0), 5, 4);
        vm.expectRevert(SwarmOracleAdapter.BadPanelRules.selector);
        new SwarmOracleAdapter(address(intake), oracleSigner, 5, 1);
        vm.expectRevert(SwarmOracleAdapter.BadPanelRules.selector);
        new SwarmOracleAdapter(address(intake), oracleSigner, 3, 4);
        vm.expectRevert(SwarmOracleAdapter.BadPanelRules.selector);
        new SwarmOracleAdapter(address(intake), oracleSigner, 101, 4);
    }

    /* ───────────── events a front end reads ───────────── */

    function test_thoughtEvent_carriesTheAnswer() public {
        (uint256 id, bytes32 rid) = _ask(alice, "q");
        SwarmOracleAdapter.Attestation memory a = _attestation();
        a.answerType = 3;
        a.answer = abi.encode(uint256(42));
        bytes memory sig = _sign(a, address(adapter), oraclePk);
        vm.expectEmit(true, true, false, true, address(adapter));
        emit SwarmOracleAdapter.Thought(
            rid, a.requestId, a.chainId, 3, keccak256(abi.encode(uint256(42))), abi.encode(uint256(42)), 5, 4, 5
        );
        _answerWith(rid, a, sig);
        assertEq(uint8(mine.question(id).status), uint8(HmmMine.Status.Answered));
        assertTrue(adapter.used(a.requestId));
    }

    /// @dev A long (list) answer is delivered and counted; the event logs its hash and leaves the bytes out, so the
    /// callback stays inside the Intake's stipend (a 3,000-entry list here).
    function test_longAnswer_isCountedAndHashed() public {
        (uint256 id, bytes32 rid) = _ask(alice, "q");
        SwarmOracleAdapter.Attestation memory a = _attestation();
        address[] memory list = new address[](3000);
        for (uint256 i; i < list.length; ++i) {
            list[i] = address(uint160(0x1000 + i));
        }
        a.answerType = 4;
        a.answer = abi.encode(list);
        bytes memory sig = _sign(a, address(adapter), oraclePk);
        vm.expectEmit(true, true, false, true, address(adapter));
        emit SwarmOracleAdapter.Thought(rid, a.requestId, a.chainId, 4, keccak256(a.answer), "", 5, 4, 5);
        assertTrue(_answerWith(rid, a, sig), "delivered within the 200k stipend");
        assertEq(uint8(mine.question(id).status), uint8(HmmMine.Status.Answered));
    }
}
