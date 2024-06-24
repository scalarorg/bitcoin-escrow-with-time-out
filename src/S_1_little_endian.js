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
const { API, sequence } = require("./util/utils");
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

const delay_time = 1; // 1 unit = 512s
console.log(sequence(delay_time))
const staking_script_asm = `01004000 OP_CHECKSEQUENCEVERIFY OP_DROP ${toXOnly(keypair_user.publicKey).toString(
  "hex"
)} OP_CHECKSIG`;
const staking_script = bitcoin.script.fromASM(staking_script_asm);

// Slashing script: 2-of-3 spend mulsig
// Stack: [User - Scalar - Provider
/*
WARNING: tapscript disabled OP_CHECKMULTISIG and OP_CHECKMULTISIGVERIFY opcodes 
Let use OP_CHECKSIGADD
THIS SCRIPT is not work
*/
const slashing_script_asm = `${toXOnly(keypair_user.publicKey).toString(
  "hex"
)} OP_CHECKSIG`;

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

// Construct redeem
// Tapleaf version: https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki
const staking_redeem = {
  output: staking_script,
  redeemVersion: LEAF_VERSION_TAPSCRIPT,
};

// Construct taproot information
const custom_tapLeaf_stakingPart = bitcoin.payments.p2tr({
  internalPubkey: toXOnly(keypair_internal.publicKey),
  scriptTree,
  redeem: staking_redeem,
  network: network,
});

// tapLeaf information
const tapLeafScript = {
  leafVersion: staking_redeem.redeemVersion,
  script: staking_redeem.output,
  // why last witness:
  // + Script Execution
  // + Leaf Script Validation
  controlBlock: custom_tapLeaf_stakingPart.witness[custom_tapLeaf_stakingPart.witness.length - 1],
};
async function createTransaction() {
  const txb = new bitcoin.Psbt({ network });
  // Default setting
  txb.setVersion(2);
  txb.setLocktime(0);

  const preUTXO = bitcoin.Transaction.fromHex(
    "020000000001011c14a7899d099fdd04faae4626bdb2e596d6fa141b1eddfa790fe909dae176140000000000ffffffef02a086010000000000225120deff53f2c98c021c92ae710a79d6b804736223bdbfd1e1758b8816745707729f801a060000000000160014d6daf3fba915fed7eb3a88d850faccb9fd00db17024730440220732d9f4e2b2a1701b19a10face55025f9a4442c395f0ed2b683fb3f2fecd4f93022016ab93e1bf8e242afbce9af93529f109b7256d011e3f334e862e4a1054dc13f50121022ae24aecee27d2f6b4c80836dfe1e86a6f9a14a4dd3b1d269bdeda4e6834e82f00000000"
  );
  txb.addInputs([
    {
      hash: "bac77cc005f4a4b23f08a441553d8856b3613eb62423f3a0607fdfe726abe5e7",
      index: 0, // Index of the output in the previous transaction
      witnessUtxo: {
        script: preUTXO.outs[0].script,
        value: preUTXO.outs[0].value,
      },
      tapLeafScript: [tapLeafScript],
      sequence: 0x00400001, // big endian
    },
  ]);
  txb.addOutputs([
    {
      address: "tb1q6md087afzhld06e63rv9p7kvh87spkchyguwg0",
      value: preUTXO.outs[0].value - 50000, // Amount in satoshis
    },
  ]);

  txb.signInput(0, keypair_user); 
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