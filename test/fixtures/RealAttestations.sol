// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SwarmOracleAdapter} from "../../src/SwarmOracleAdapter.sol";

/// @notice Real answers signed by the IMD oracle, fetched from api.imd.fun/oracle/requests/:id/attestation on
/// 2026-10-12. They pin the adapter's EIP-712 encoding to what the swarm's signer actually signs.
library RealAttestations {
    struct Vector {
        SwarmOracleAdapter.Attestation a;
        uint256 domainChainId;
        address verifyingContract;
        bytes signature;
        address signer;
    }

    address internal constant SIGNER = 0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982;

    function all() internal pure returns (Vector[] memory v) {
        v = new Vector[](5);
        // bb6cf154-938a-49e8-ac66-307753f2735f: bool answer, consumer 0x0000000000000000000000000000000000000000 on chain 1
        v[0].a = SwarmOracleAdapter.Attestation({
            requestId: 0xbb6cf154938a49e8ac66307753f2735f00000000000000000000000000000000,
            chainId: 1,
            questionHash: 0x8ad3cbbca8810621772ea74b6000ec7807ba4a0f06b416851bd739ae6729053b,
            answerType: 0,
            answer: hex"0000000000000000000000000000000000000000000000000000000000000001",
            figure: 0,
            fromBlock: 26171451,
            toBlock: 26178636,
            blockHash: 0x0c26f3080188592b9c8908a1e3b76744db29867809eb49b528031427b16d48ea,
            panelJobId: 0xbd6cefc956984493bc499035016ad65100000000000000000000000000000000,
            panelSize: 20,
            quorum: 14,
            agreed: 14,
            issuedAt: 1791835251,
            expiresAt: 1791921651
        });
        v[0].domainChainId = 1;
        v[0].verifyingContract = address(0);
        v[0].signature =
            hex"2449c9bd195e01b057e12462c897fa3d97c91a740f4790e223868da2d8d40e6271885e6c89354a131e007bcc9c28818ddd05f8ab07a848e0bda0945b3650c3e51c";
        v[0].signer = SIGNER;
        // ba6cb26d-bb0f-4772-b468-3f80da4db388: bool answer, consumer 0x5f63cDEaD0F5f693B8964d82B56155f55645ccEA on chain 11155111
        v[1].a = SwarmOracleAdapter.Attestation({
            requestId: 0xba6cb26dbb0f4772b4683f80da4db38800000000000000000000000000000000,
            chainId: 1,
            questionHash: 0x83f4833ac2b94806a6420e9ec5f431ef2526cba2b05e00eeb947b166a1078dbd,
            answerType: 0,
            answer: hex"0000000000000000000000000000000000000000000000000000000000000001",
            figure: 0,
            fromBlock: 26177926,
            toBlock: 26178226,
            blockHash: 0xbf138c2758871b6770b2b2fbd82e676175ce10d65d9ca5e17d1017cf78444f99,
            panelJobId: 0xd36b5d03d4354f57ab03a6a6171a283a00000000000000000000000000000000,
            panelSize: 15,
            quorum: 11,
            agreed: 11,
            issuedAt: 1791830422,
            expiresAt: 1791916822
        });
        v[1].domainChainId = 11155111;
        v[1].verifyingContract = address(0x5f63cDEaD0F5f693B8964d82B56155f55645ccEA);
        v[1].signature =
            hex"c72a5ef3580f0625ab2c626dd5bf665451839c286119783a2b6362f538c0c2b566e553325d4bc4738a7c9e9931e7638cdaf95f9ae07eb497a5ad49d2b73c2b071c";
        v[1].signer = SIGNER;
        // fc54f6b7-996d-4db5-a8f0-4693b3a59d5d: uint256 answer, consumer 0xEE8D6Bf22AC414fF4A5E6Faf6e9B413407a50e21 on chain 11155111
        v[2].a = SwarmOracleAdapter.Attestation({
            requestId: 0xfc54f6b7996d4db5a8f04693b3a59d5d00000000000000000000000000000000,
            chainId: 1,
            questionHash: 0xd4dd8bc16fa36ae2c7e50319248745e3e48cf962ac5903ddf667e9791a3bfb06,
            answerType: 3,
            answer: hex"0000000000000000000000000000000000000000000000000000000000000024",
            figure: 36,
            fromBlock: 26177917,
            toBlock: 26178217,
            blockHash: 0xe111ae36869d1d593d01b252f10a724ee1e5319389a8548527d0889b1bfc5e5a,
            panelJobId: 0xdaa159dd6f904e87938f3590c30ef6f600000000000000000000000000000000,
            panelSize: 30,
            quorum: 17,
            agreed: 17,
            issuedAt: 1791830210,
            expiresAt: 1791833810
        });
        v[2].domainChainId = 11155111;
        v[2].verifyingContract = address(0xEE8D6Bf22AC414fF4A5E6Faf6e9B413407a50e21);
        v[2].signature =
            hex"fb8d9c449d25460164d909479f87120521447490bc1c439a7ebaacacac55c02c6e37a2cd31ef80d2446c20034d14f112ac88d3e21a320be04cf2d6df2806c7a41c";
        v[2].signer = SIGNER;
        // 3363f84b-6b48-4e24-92dc-a819558ffdb4: address[] answer, consumer 0x0000000000000000000000000000000000000000 on chain 1
        v[3].a = SwarmOracleAdapter.Attestation({
            requestId: 0x3363f84b6b484e2492dca819558ffdb400000000000000000000000000000000,
            chainId: 1,
            questionHash: 0x7cf49fdc0948b248d78e037f2fa2a7fc668c9a719341893c93326cf4d94d5f64,
            answerType: 4,
            answer: hex"000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000030000000000000000000000005bc838fda95acc0cf34e68c1aff691b0abbb3c36000000000000000000000000d61b05ba5a560b56cb3aea0420d898f79229b4e4000000000000000000000000000000000004444c5dc75cb358380d2e3de08a90",
            figure: 9764902195898563686533517,
            fromBlock: 26166392,
            toBlock: 26173591,
            blockHash: 0xbe52e0feb2716f1c5d6b32ca18072775a9cc5c961122b63330d8df3eb882e36a,
            panelJobId: 0x2182de00fb954fc1907ac282dc4ba23700000000000000000000000000000000,
            panelSize: 20,
            quorum: 14,
            agreed: 14,
            issuedAt: 1791774624,
            expiresAt: 1791778224
        });
        v[3].domainChainId = 1;
        v[3].verifyingContract = address(0);
        v[3].signature =
            hex"31e08bfd52efe073b5eae7fd16f9567d7e092dc97c63ddc578550d41e5da213500a124c6e6b8c1daf6c050c48010856aa91eb486429dc1b87e92a63eb686455b1b";
        v[3].signer = SIGNER;
        // 99f49123-221b-412c-b57c-90520c049f46: address answer, consumer 0x0000000000000000000000000000000000000000 on chain 1
        v[4].a = SwarmOracleAdapter.Attestation({
            requestId: 0x99f49123221b412cb57c90520c049f4600000000000000000000000000000000,
            chainId: 1,
            questionHash: 0x5f96e4147fa67b0d7efd46018556b7e50f1b0f8b06a5a3263710bce3d5667d3c,
            answerType: 1,
            answer: hex"000000000000000000000000fa0efea559bde229031c2b0a219472316647759c",
            figure: 0,
            fromBlock: 26163601,
            toBlock: 26170778,
            blockHash: 0x364f98280b95da6d73e6b8a3c4ecca9da8ef8dcaf6a13d6ba6bdaed8c9b1dc54,
            panelJobId: 0x4eb55de9241c4d3fa60a1ae80819702400000000000000000000000000000000,
            panelSize: 5,
            quorum: 4,
            agreed: 5,
            issuedAt: 1791740758,
            expiresAt: 1791827158
        });
        v[4].domainChainId = 1;
        v[4].verifyingContract = address(0);
        v[4].signature =
            hex"9463199c3efa425f64816a9a755466413b91e8259f109bf41a06266869a48f9b0297b6f0fda08474fd737f4052ec2424c00f0766930c7e4eaf7a3acdffb72f011c";
        v[4].signer = SIGNER;
    }
}
