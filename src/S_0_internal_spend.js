/*
REFERENCES:
  + https://medium.com/@nagasha/how-to-build-and-broadcast-a-bitcoin-transaction-using-bitcoinjs-bitcoinjs-lib-on-testnet-2d9c8ac725d6
  + https://www.youtube.com/watch?v=fE-PSB9ndI4
  + https://mempool.space/testnet/docs/api/rest#get-address-transactions
  # main: https://medium.com/@bitcoindeezy/bitcoin-basics-programming-with-bitcoinjs-lib-4a69218c0431
  # taproot: + https://dev.to/eunovo/a-guide-to-creating-taproot-scripts-with-bitcoinjs-lib-4oph
             + https://ordinallabs.medium.com/understanding-taproot-addresses-a-simple-guide-5475da0fb3d3
  # specific for taproot spend: 
             + https://github.com/bitcoinjs/bitcoinjs-lib/blob/master/test/integration/taproot.spec.ts
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

// Initialize the ECC library
bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

// GEN address taproot for 3 spend: 1 key path - 2 script path
/*
3 Covenant staker:
  User - Scalar - Provider
  3 path:
    - internal key: Forcing withdraw - (Schnorr signature for User + Scalar + Provider)
    - Script path:
      + Staking: User withdraw after time lock
      + Slashing: 2-of-3 spend
*/
const keypair_internal = ECPair.fromWIF(process.env.internalWIF, network);

const keypair_user = ECPair.fromWIF(process.env.userWIF, network);
const keypair_scalar = ECPair.fromWIF(process.env.scalarWIF, network);
const keypair_provider = ECPair.fromWIF(process.env.providerWIF, network);

const delay_time = 0x00400001; // 512 seconds
const staking_script_asm = [
  bitcoin.script.number.encode(delay_time),
  bitcoin.opcodes.OP_CHECKSEQUENCEVERIFY,
  bitcoin.opcodes.OP_DROP,
  toXOnly(keypair_user.publicKey),
  bitcoin.opcodes.OP_CHECKSIG,
];

const staking_script = bitcoin.script.compile(staking_script_asm);

// Slashing script: 2-of-3 spend mulsig
// Stack: [User - Scalar - Provider
/*
WARNING: tapscript disabled OP_CHECKMULTISIG and OP_CHECKMULTISIGVERIFY opcodes 
Let use OP_CHECKSIGADD
Material: https://github.com/babylonchain/btc-staking-ts/blob/main/src/utils/stakingScript.ts
*/
const threshold = 2;
const slashing_script_asm = [
  toXOnly(keypair_user.publicKey),
  bitcoin.opcodes.OP_CHECKSIG,
  toXOnly(keypair_scalar.publicKey),
  bitcoin.opcodes.OP_CHECKSIGADD,
  toXOnly(keypair_provider.publicKey),
  bitcoin.opcodes.OP_CHECKSIGADD,
  bitcoin.script.number.encode(threshold),
  bitcoin.opcodes.OP_GREATERTHANOREQUAL,
];

const slashing_script = bitcoin.script.compile(slashing_script_asm);

// Construct taptree
const LEAF_VERSION_TAPSCRIPT = 0xc0;

// Construct taptree - must be in MAST from
const scriptTree = [
  {
    output: staking_script,
  },
  {
    output: slashing_script,
  },
];

// Gen taproot address
const script_p2tr = bitcoin.payments.p2tr({
  internalPubkey: toXOnly(keypair_internal.publicKey),
  scriptTree,
  network,
});

// Construct redeem
// Tapleaf version: https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki
const staking_redeem = {
  output: staking_script,
  redeemVersion: LEAF_VERSION_TAPSCRIPT,
};
const slashing_redeem = {
  output: slashing_script,
  redeemVersion: LEAF_VERSION_TAPSCRIPT,
};
async function createTransaction() {
  const txb = new bitcoin.Psbt({ network });
  // Default setting
  txb.setVersion(2);
  txb.setLocktime(0);

  const preUTXO = bitcoin.Transaction.fromHex(
    "02000000000101e7e5ab26e7df7f60a0f32324b63e61b356883d5541a4083fb2a4f405c07cc7ba0100000000ffffffef02a08601000000000022512011b16c0dda755f6a932a9fd673107d852faa16fdb16831d3c5bd90626bd4171c400d030000000000160014d6daf3fba915fed7eb3a88d850faccb9fd00db1702483045022100e14cf67c0539ea98a09a252f9fe8f7220af815d4c4102afe2d8b1b8821181e3f02206072ed6bcfbebcb680b2da1c32a50279004a2f70c53991fc8f6832ceb388c94b0121022ae24aecee27d2f6b4c80836dfe1e86a6f9a14a4dd3b1d269bdeda4e6834e82f00000000"
  );
  txb.addInputs([
    {
      hash: "7797eaed5c31f872b99f6fa7a9f123f4bf8bd729154301aac4c33ff3c6ed548c",
      index: 0, // Index of the output in the previous transaction
      witnessUtxo: {
        script: preUTXO.outs[0].script,
        value: preUTXO.outs[0].value,
      },
      tapInternalKey: toXOnly(keypair_internal.publicKey),
      tapMerkleRoot: script_p2tr.hash,
      sequence: 0xfffffffd, // big endian
    },
  ]);
  txb.addOutputs([
    {
      address: "tb1q6md087afzhld06e63rv9p7kvh87spkchyguwg0",
      value: preUTXO.outs[0].value - 50000, // Amount in satoshis
    },
  ]);
  // Create tweaked key to spend key path

  const tweakedKeyPair = tweakSigner(keypair_internal, { tweakHash: script_p2tr.hash });
  txb.signInput(0, tweakedKeyPair); // NOTE, with taproot spend, we need to use Tweaked Signer
  txb.finalizeAllInputs();

  const tx = txb.extractTransaction();
  return tx.toHex();
}
const res = createTransaction()
  .then((transaction) => {
    console.log(transaction);
    // API(process.env.url_internal, "sendrawtransaction", transaction);
    // Require to test
    API(process.env.url_internal, "testmempoolaccept", [transaction]);
  })
  .catch((error) => {
    console.log(error);
  });
