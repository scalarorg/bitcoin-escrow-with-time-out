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
// create embeded data for Security checking for transaction (based on Babylonchain)
// magic bytes for 4 bytes
let magic_bytes = Buffer.from("01020304", "hex")
// version for 1 byte
let version = Buffer.from([0])
// staker publicKey for 32 bytes
let staker_publicKey = Buffer.from("1111111111111111111111111111111111111111111111111111111111111111", "hex")
// dApp publicKey for 32 bytes
let dApp_publicKey = Buffer.from("2222222222222222222222222222222222222222222222222222222222222222", "hex")
// serialize
let data_staking = Buffer.concat([magic_bytes, version, staker_publicKey, dApp_publicKey])
const embeded_staking_data = [
  bitcoin.opcodes.OP_RETURN, // OP_RETURN should be a single byte
  data_staking
]
const staking_script = bitcoin.script.compile(embeded_staking_data)


// create embeded Minting script
// chainID random for 8 bytes
let chainID = Buffer.from("aaaaaaaaaaaaaaaa", "hex");
// address random for 20 bytes
let address_from = Buffer.from("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "hex")
// address random for 20 bytes
let address_to = Buffer.from("cccccccccccccccccccccccccccccccccccccccc", "hex")
// amount random for 32 bytes
let amount = Buffer.from("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "hex")
// serialize
let data_minting = Buffer.concat([chainID, address_from, address_to, amount])
const embeded_minting_data = [
  bitcoin.opcodes.OP_RETURN, // OP_RETURN should be a single byte
  data_minting
]
const minting_script = bitcoin.script.compile(embeded_minting_data)
const script_embeded = bitcoin.payments.embed({ data: [staking_script,minting_script], network: network })

async function createTransaction() {
  const txb = new bitcoin.Psbt({ network });
  // Default setting
  txb.setVersion(2);
  txb.setLocktime(0);

  const preUTXO = bitcoin.Transaction.fromHex(
    "0200000000010187ac3d5f31e1477e8f71acbc1dec0ed5afdc86ccf30d88fd194509b4e44d0e5f0000000000ffffffef031027000000000000225120032de3625c66e422222c934742174caf0b7177d547c82e44d96874d729f5f0960000000000000000536a4c50aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbccccccccccccccccccccccccccccccccccccccccffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7094000000000000160014d6daf3fba915fed7eb3a88d850faccb9fd00db1702483045022100b99250c01e96ceb1d1d5f134c07d980aaf9deac4cd80da1c177effbabbe511e202204ecd7c61a6972a4de78d08ed9dd6e21ef973fb11dfa79083df1215cc26ca3bf10121022ae24aecee27d2f6b4c80836dfe1e86a6f9a14a4dd3b1d269bdeda4e6834e82f00000000"
  );
  txb.addInputs([
    {
      hash: preUTXO.getId(),
      index: 2, // Index of the output in the previous transaction
      witnessUtxo: {
        script: preUTXO.outs[2].script,
        value: preUTXO.outs[2].value,
      },
      sequence: 0xfffffffd, // big endian
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
      script: script_embeded.data[1],
      value: 0, // Amount in satoshis
    },
    {
      address: process.env.changeAddress,
      value: 28000 - 2000,
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
    API(process.env.url_internal, "sendrawtransaction", transaction);
    // API(process.env.url_internal, "testmempoolaccept", [transaction]);
  })
  .catch((error) => {
    console.log(error);
  });

