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
const { API, NumtoHex } = require("./util/utils");
const { p2pk } = require("bitcoinjs-lib/src/payments");
const {
  witnessStackToScriptWitness,
} = require("./util/witness_stack_to_script_witness");
const { Hex } = require("bitcoinjs-lib/src/types");

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

const delay_block = 2;

const staking_script_asm = `${NumtoHex(
  delay_block
)} OP_CHECKSEQUENCEVERIFY OP_DROP ${toXOnly(keypair_user.publicKey).toString(
  "hex"
)} OP_CHECKSIG`;

const staking_script = bitcoin.script.fromASM(staking_script_asm);
// Slashing script: 2-of-3 spend mulsig
// Stack: [User - Scalar - Provider
const numberOfStaker = 3;
const minimumOfStaker = 2;
const slashing_script_asm = `${NumtoHex(minimumOfStaker)} ${toXOnly(
  keypair_user.publicKey
).toString("hex")} ${toXOnly(keypair_scalar.publicKey).toString(
  "hex"
)} ${toXOnly(keypair_provider.publicKey).toString("hex")} ${NumtoHex(
  numberOfStaker
)} OP_CHECKMULTISIG`;

const slashing_script = bitcoin.script.fromASM(slashing_script_asm);

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
    "0200000000010190b9932f0fa23ec0b2963df7db1cbeee4fbd06cba8936a5f6c457274290838050000000000fdffffff04a08601000000000022512034ccbb62218308dddd0a1f70ec311ff41d1fe340c2ae402fba20da6c24480470a08601000000000022512034ccbb62218308dddd0a1f70ec311ff41d1fe340c2ae402fba20da6c24480470a08601000000000022512034ccbb62218308dddd0a1f70ec311ff41d1fe340c2ae402fba20da6c24480470400d030000000000160014d6daf3fba915fed7eb3a88d850faccb9fd00db170247304402205dcae40c3422f5373e8d84aa76e785993b0165a7b0dc702832bf6e0efc2b1b4f02201eddc1f7acaa73d2ad63780825248eaecc4a7adefb48dc167f26b34b0af3639e0121022ae24aecee27d2f6b4c80836dfe1e86a6f9a14a4dd3b1d269bdeda4e6834e82f00000000"
  );
  txb.addInputs([
    {
      hash: "7b1e01733cf7e9f8d493a09fc5a3bbe1b19f72379a7155fc4553f6e2983f567d",
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
    API(process.env.url_internal, "sendrawtransaction", transaction);
    // Require to test
    // API(process.env.url_internal, "testmempoolaccept", [transaction]);
  })
  .catch((error) => {
    console.log(error);
  });
