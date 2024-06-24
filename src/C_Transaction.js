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
      + Slashing: 2-of-3 spend: User - Scalar - Provider 
      
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
// Case: User + Scalar
// Case: User + Provider
/*
WARNING: tapscript disabled OP_CHECKMULTISIG and OP_CHECKMULTISIGVERIFY opcodes 
Let use OP_CHECKSIGADD
Material: https://github.com/babylonchain/btc-staking-ts/blob/main/src/utils/stakingScript.ts
NOTE:
It seems that OP_CHECKSIGADD not work as we want:
let split script in to 3 path:
 + User - Scalar
 + User - Provider
 + Scalar - Provider
*/
let threshold = 2;

const UC_slashing_script_asm = [
  toXOnly(keypair_user.publicKey),
  bitcoin.opcodes.OP_CHECKSIG,
  toXOnly(keypair_scalar.publicKey),
  bitcoin.opcodes.OP_CHECKSIGADD,
  bitcoin.script.number.encode(threshold),
  bitcoin.opcodes.OP_NUMEQUAL,
];
const UC_slashing_scrip = bitcoin.script.compile(UC_slashing_script_asm);

const UP_slashing_script_asm = [
  toXOnly(keypair_user.publicKey),
  bitcoin.opcodes.OP_CHECKSIG,
  toXOnly(keypair_provider.publicKey),
  bitcoin.opcodes.OP_CHECKSIGADD,
  bitcoin.script.number.encode(threshold),
  bitcoin.opcodes.OP_NUMEQUAL,
];
const UP_slashing_scrip = bitcoin.script.compile(UP_slashing_script_asm);

const CP_slashing_script_asm = [
  toXOnly(keypair_scalar.publicKey),
  bitcoin.opcodes.OP_CHECKSIG,
  toXOnly(keypair_provider.publicKey),
  bitcoin.opcodes.OP_CHECKSIGADD,
  bitcoin.script.number.encode(threshold),
  bitcoin.opcodes.OP_NUMEQUAL,
];
const CP_slashing_scrip = bitcoin.script.compile(CP_slashing_script_asm);
// Construct taptree
const LEAF_VERSION_TAPSCRIPT = 0xc0;

// Construct taptree - must be in MAST from
const scriptTree = [
  {
    output: staking_script,
  },
  [
    {
      output: UC_slashing_scrip,
    },
    [
      {
        output: UP_slashing_scrip,
      },
      {
        output: CP_slashing_scrip,
      },
    ],
  ],
];

// Gen taproot address
const script_p2tr = bitcoin.payments.p2tr({
  internalPubkey: toXOnly(keypair_internal.publicKey),
  scriptTree,
  network,
});

async function createTransaction() {
  const txb = new bitcoin.Psbt({ network });
  // Default setting
  txb.setVersion(2);
  txb.setLocktime(0);

  const preUTXO = bitcoin.Transaction.fromHex(
    "0200000000010190cd907f561ad0cca71ecc0865b71d76f98f0fc6bcbe149774d08aa47b788b330100000000fdffffff02f877080000000000160014d6daf3fba915fed7eb3a88d850faccb9fd00db17f930200000000000160014dea5cec1d786dbfabab914bdf01a98d19a2f6165024730440220047c4aa7b13d3dbc978eae8be3dbfc685133946e6cefe488a38b264aba71211802206f37f2a51a185f1c5a333c6f2d872b10403666b4b5e05dcb25182683809e545f012102c22a22aa02faf47edc07a35e7ab41110d66e77308c7563e667541b1672fd3f5000000000"
  );
  txb.addInputs([
    {
      hash: "5e73cffefbb04a522aebacd294a61c1a544e60c145d49b69017289fbf4f5ca1a",
      index: 0, // Index of the output in the previous transaction
      witnessUtxo: {
        script: preUTXO.outs[0].script,
        value: preUTXO.outs[0].value,
      },
      // make sure this nsequence must less than 0xEFFFFFFF to ensure CSV and CLTV can be used
      sequence: 0xefffffff, // big endian
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
      address: script_p2tr.address,
      value: 100000, // Amount in satoshis
    },
    {
      address: "tb1q6md087afzhld06e63rv9p7kvh87spkchyguwg0",
      value: 100000, // Amount in satoshis
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
