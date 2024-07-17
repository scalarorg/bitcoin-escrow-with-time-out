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

const bitcoin = require("bitcoinjs-lib");
const ECPairFactory = require("ecpair").default;
const ecc = require("tiny-secp256k1");

// utils
const { tweakSigner, toXOnly } = require("../util/taproot-utils");
const { API, feesRecommended } = require("../util/utils");

// Initialize the ECC library
bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

// GEN address taproot for 3 spend: 1 key path - 2 script path
/*
3 Covenant staker:
  User - dApp - custodials...
  3 path:
    - internal key: NUMS vector
    - Script path:
      + Burn: User + dApp + custodials...
      + slashing = Lost private keys: dApp + custodials...
      + Burn without dApp: User + custodials...
      
*/
const keypair_user = ECPair.fromWIF(process.env.userWIF, network);
const keypair_dApp = ECPair.fromWIF(process.env.dAppWIF, network);
const keypair_custodial1 = ECPair.fromWIF(process.env.custodial1WIF, network);
const keypair_custodial2 = ECPair.fromWIF(process.env.custodial2WIF, network);
const keypair_custodial3 = ECPair.fromWIF(process.env.custodial3WIF, network);

let threshold = 2;

const burn_script_asm = [
  toXOnly(keypair_user.publicKey),
  bitcoin.opcodes.OP_CHECKSIGVERIFY,
  toXOnly(keypair_dApp.publicKey),
  bitcoin.opcodes.OP_CHECKSIGVERIFY,
  toXOnly(keypair_custodial1.publicKey),
  bitcoin.opcodes.OP_CHECKSIG,
  toXOnly(keypair_custodial2.publicKey),
  bitcoin.opcodes.OP_CHECKSIGADD,
  toXOnly(keypair_custodial3.publicKey),
  bitcoin.opcodes.OP_CHECKSIGADD,
  bitcoin.script.number.encode(threshold),
  bitcoin.opcodes.OP_GREATERTHANOREQUAL,
];
const burn_script = bitcoin.script.compile(burn_script_asm);

const slashing_and_lost_key_script_asm = [
  toXOnly(keypair_user.publicKey),
  bitcoin.opcodes.OP_CHECKSIGVERIFY,
  toXOnly(keypair_custodial1.publicKey),
  bitcoin.opcodes.OP_CHECKSIG,
  toXOnly(keypair_custodial2.publicKey),
  bitcoin.opcodes.OP_CHECKSIGADD,
  toXOnly(keypair_custodial3.publicKey),
  bitcoin.opcodes.OP_CHECKSIGADD,
  bitcoin.script.number.encode(threshold),
  bitcoin.opcodes.OP_GREATERTHANOREQUAL,
];
const slashing_lost_key_script = bitcoin.script.compile(
  slashing_and_lost_key_script_asm
);

const burn_without_dApp_script_asm = [
  toXOnly(keypair_user.publicKey),
  bitcoin.opcodes.OP_CHECKSIGVERIFY,
  toXOnly(keypair_custodial1.publicKey),
  bitcoin.opcodes.OP_CHECKSIG,
  toXOnly(keypair_custodial2.publicKey),
  bitcoin.opcodes.OP_CHECKSIGADD,
  toXOnly(keypair_custodial3.publicKey),
  bitcoin.opcodes.OP_CHECKSIGADD,
  bitcoin.script.number.encode(threshold),
  bitcoin.opcodes.OP_GREATERTHANOREQUAL,
];
const burn_without_dApp_script = bitcoin.script.compile(
  burn_without_dApp_script_asm
);

// Construct taptree - must be in MAST from
const scriptTree = [
  {
    output: burn_script,
  },
  [
    {
      output: slashing_lost_key_script,
    },
    {
      output: burn_without_dApp_script,
    },
  ],
];

// Gen taproot address
const NUMS = Buffer.from(
  "0250929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0",
  "hex"
);
const script_p2tr = bitcoin.payments.p2tr({
  internalPubkey: toXOnly(NUMS),
  scriptTree,
  network,
});

// create embeded script

// chainID random for 8 bytes
let chainID = Buffer.from("aaaaaaaaaaaaaaaa", "hex");
// address random for 20 bytes
let address_from = Buffer.from("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "hex")
// address random for 20 bytes
let address_to = Buffer.from("cccccccccccccccccccccccccccccccccccccccc", "hex")
// amount random for 32 bytes
let amount = Buffer.from("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "hex")
// serialize
let data = Buffer.concat([chainID, address_from, address_to, amount])
const embeded_data = [
  bitcoin.opcodes.OP_RETURN, // OP_RETURN should be a single byte
  data
]
const script = bitcoin.script.compile(embeded_data)
const script_embeded = bitcoin.payments.embed({ data: [script], network: network })

async function createTransaction() {
  const txb = new bitcoin.Psbt({ network });
  // Default setting
  txb.setVersion(2);
  txb.setLocktime(0);

  const preUTXO = bitcoin.Transaction.fromHex(
    "0200000000010109b41632070f1bc62c6dc2bfe775006d753c3c7640399058e67f10062c19e04e0200000000fdffffff0150c3000000000000160014d6daf3fba915fed7eb3a88d850faccb9fd00db170440f63df2c4b8480de994ef793d86bd75a759e14549c5bef28be4e85b5439b55ec98178f3ddaf67ca5525f4d0344a03a80c2152a7ee0f9f6f204f7a1d60bff05e8940558609792be7cf60177b88218328e68c30be8d3c9dbade33f15d443e5cb22aefc002987585e0f274e312be601841febb6b9ec00e9933e1d9a16a13eda4840b7246202ae24aecee27d2f6b4c80836dfe1e86a6f9a14a4dd3b1d269bdeda4e6834e82fac20b40c15a2294af054263240ceb2acfc724382c5b56e780435382a109b39eeadd5ba529c61c173b67c58970767eb6bfb99b8a48061ae7668a839b644b5e10902e3aaac1d2b45d856bd07eedf9858553327cf705fffbffc6fb24821a1e1dbe88513a9aae4ce0a1df8f18244a9dfd90a7dcacc2bf2a6cdad885ba56796a507fb538ff2cc03cbca00000000"
  );
  txb.addInputs([
    {
      hash: preUTXO.getId(),
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
      value: 10000, // Amount in satoshis
    },
    {
      script: script_embeded.data[0],
      value: 0, // Amount in satoshis
    },
    {
      address: process.env.changeAddress,
      value: 40000 - 2000,
    },
    
  ]);
  const keyPair_signInput = ECPair.fromWIF(process.env.userWIF, network);
  txb.signAllInputs(keyPair_signInput);
  txb.finalizeAllInputs();
  const tx = txb.extractTransaction();
  return tx.toHex();
}
const res = createTransaction()
  .then(async (transaction) => {
    // console.log(transaction)
    // API(process.env.url_internal, "sendrawtransaction", transaction);
    API(process.env.url_internal, "testmempoolaccept", [transaction]);
  })
  .catch((error) => {
    console.log(error);
  });

