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
/*
WARNING: tapscript disabled OP_CHECKMULTISIG and OP_CHECKMULTISIGVERIFY opcodes 
Let use OP_CHECKSIGADD
THIS SCRIPT is not work
*/
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
    "020000000001015ebc81a3e17a9c38fc1a505da980546829831d2c6e59ac9af986753705cd11910100000000fdffffff02f877080000000000160014d6daf3fba915fed7eb3a88d850faccb9fd00db177390fe5600000000160014dea5cec1d786dbfabab914bdf01a98d19a2f616502473044022040be7ccf5cbde991f5b53c35234b685143bee076438f029bce920e19722ae497022046914f76039c2b342d7c5e867720c3a389cf81d6fd381d4cb305ee7422a654d1012102c22a22aa02faf47edc07a35e7ab41110d66e77308c7563e667541b1672fd3f5000000000"
  );
  txb.addInputs([
    {
      hash: "053808297472456c5f6a93a8cb06bd4feebe1cdbf73d96b2c03ea20f2f93b990",
      index: 0, // Index of the output in the previous transaction
      witnessUtxo: {
        script: preUTXO.outs[0].script,
        value: preUTXO.outs[0].value,
      },
      sequence: 0xfffffffd, // big endian
    },
  ]);
  txb.addOutputs([
    {
      address: script_p2tr.address,
      value: 100000, // Amount in satoshis
    },
    {
      address: script_p2tr.address,
      value: 100000, // Amount in satoshis
    },
    {
      address: script_p2tr.address,
      value: 100000, // Amount in satoshis
    },
    {
      address: "tb1q6md087afzhld06e63rv9p7kvh87spkchyguwg0",
      value: 200000, // Amount in satoshis
    },
  ]);
  const keyPair_signInput = ECPair.fromWIF(process.env.changeWIF, network);
  txb.signAllInputs(keyPair_signInput);
  txb.finalizeAllInputs();

  const tx = txb.extractTransaction();
  return tx.toHex();
}
const res = createTransaction()
  .then((transaction) => {
    console.log(transaction);
    API(process.env.url_internal, "sendrawtransaction", transaction);
    // API(process.env.url_internal, "testmempoolaccept", [transaction]);
  })
  .catch((error) => {
    console.log(error);
  });
