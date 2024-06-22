/*
REFERENCES:
  + https://medium.com/@nagasha/how-to-build-and-broadcast-a-bitcoin-transaction-using-bitcoinjs-bitcoinjs-lib-on-testnet-2d9c8ac725d6
  + https://www.youtube.com/watch?v=fE-PSB9ndI4
  + https://mempool.space/testnet/docs/api/rest#get-address-transactions
  # main: https://medium.com/@bitcoindeezy/bitcoin-basics-programming-with-bitcoinjs-lib-4a69218c0431
  # taproot: + https://dev.to/eunovo/a-guide-to-creating-taproot-scripts-with-bitcoinjs-lib-4oph
             + https://ordinallabs.medium.com/understanding-taproot-addresses-a-simple-guide-5475da0fb3d3
*/
require("dotenv").config();
const mempoolJS = require("@mempool/mempool.js");
const axios = require("axios");

const bitcoin = require("bitcoinjs-lib");
const ECPairFactory = require("ecpair").default;
const ecc = require("tiny-secp256k1");

// utils
const { tweakSigner, toXOnly } = require("./util/taproot-utils");
const { API } = require("./util/utils");
const { p2pk } = require("bitcoinjs-lib/src/payments");
const {
  witnessStackToScriptWitness,
} = require("./util/witness_stack_to_script_witness");

// Initialize the ECC library
bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

const keypair_taproot = ECPair.fromWIF(process.env.changeWIF, network);

// GEN address taproot for 3 spend: 1 key path - 2 script path
const secret_bytes = Buffer.from("SECRET");
const hash = bitcoin.crypto.hash160(secret_bytes);

// Construct script to pay to hash_lock_keypair if the correct preimage/secret is provided
const hash_script_asm = `OP_HASH160 ${hash.toString(
  "hex"
)} OP_EQUALVERIFY ${toXOnly(keypair_taproot.publicKey).toString(
  "hex"
)} OP_CHECKSIG`;
const hash_lock_script = bitcoin.script.fromASM(hash_script_asm);

const p2pk_script_asm = `${toXOnly(keypair_taproot.publicKey).toString(
  "hex"
)} OP_CHECKSIG`;
const p2pk_script = bitcoin.script.fromASM(p2pk_script_asm);

// Construct taptree
// Tapleaf version: https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki
const LEAF_VERSION_TAPSCRIPT = 0xc0;

// Construct redeem
const hash_lock_redeem = {
  output: hash_lock_script,
  redeemVersion: LEAF_VERSION_TAPSCRIPT,
};
const p2pk_redeem = {
  output: p2pk_script,
  redeemVersion: LEAF_VERSION_TAPSCRIPT,
};

// Construct taptree
const scriptTree = [
  {
    output: hash_lock_script,
  },
  {
    output: p2pk_script,
  },
];

// Gen taproot address
const script_p2tr = bitcoin.payments.p2tr({
  internalPubkey: toXOnly(keypair_taproot.publicKey),
  scriptTree,
  network,
});

async function createTransaction(changeWIF) {
  const keyPair = ECPair.fromWIF(changeWIF, network);
  const txb = new bitcoin.Psbt({ network });
  // Default setting
  txb.setVersion(2);
  txb.setLocktime(0);

  const preUTXO = bitcoin.Transaction.fromHex(
    "02000000000101b078821e5c451e4c03b0a89321f7eb44343bade1fa736bbe22cb3d4f961c6a1f0000000000fdffffff01400d030000000000225120d42eaf3cb8da8a131a1d0e6def14ec7448d0f800d08f95513ce6989e949a5077024730440220485c20469e41e3d8ee59381278d678bae992a04a627df00879a911522ee11faf02206e1526ec5925dbd25c476770748c0ecaf5b95f0a84acc6cd948a61bad40ed3660121022ae24aecee27d2f6b4c80836dfe1e86a6f9a14a4dd3b1d269bdeda4e6834e82f00000000"
  );
  txb.addInputs([
    {
      hash: "320a8ffd66e24612318a99dae55d1cd0e25f4fc07c7889f5f0121cfa55ba1130",
      index: 0, // Index of the output in the previous transaction
      witnessUtxo: {
        script: preUTXO.outs[0].script,
        value: preUTXO.outs[0].value,
      },
      tapInternalKey: toXOnly(keyPair.publicKey),
      tapMerkleRoot: script_p2tr.hash,
      sequence: 0xfffffffd, // big endian
    },
  ]);

  txb.addOutputs([
    {
      address: script_p2tr.address,
      value: preUTXO.outs[0].value - 50000, // Amount in satoshis
    },
  ]);
  // Create tweaked key to spend key path
  const tweakedKeyPair = tweakSigner(keyPair, { tweakHash: script_p2tr.hash });
  txb.signInput(0, tweakedKeyPair); // NOTE, with taproot spend, we need to use Tweaked Signer
  txb.finalizeAllInputs();

  const tx = txb.extractTransaction();
  return tx.toHex();
}
const res = createTransaction(process.env.changeWIF, false)
  .then((transaction) => {
    console.log(transaction);
    // API(process.env.url_internal, "sendrawtransaction", transaction);
    // Require to test
    API(process.env.url_internal, "testmempoolaccept", [transaction]);
  })
  .catch((error) => {
    console.log(error);
  });
