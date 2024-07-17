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

async function createTransaction() {
  const txb = new bitcoin.Psbt({ network });
  // Default setting
  txb.setVersion(2);
  txb.setLocktime(0);

  const preUTXO = bitcoin.Transaction.fromHex(
    "0200000000010127905ed6760af2eec038bf3cf45c4c3a95daf2e6d27161c4c811d2511bd239c30000000000ffffffef01401f000000000000160014d6daf3fba915fed7eb3a88d850faccb9fd00db1705405b95f8876eb74d085ddc632feb2b0af53f539fbd4c38e8af727f7de544c34b51cc163fd97769915088661f83239f563bfecf64eeaadb7cc35ca3a04566fa3c0f40faf74e43745ae217ad057ababd43570e1aa12cc3453bd2203471bdca84381ff372ea35b0558eff69573dc19cfdb822401a86098acd22639a7b4afd983d579be540ba5f9acd48a0eecd44b2e6770c8f5af3de4dca6a143fa267dc7882395af2f6f19966e2aa150e27d15a8d41134d45f68a27d89d3908222bee4d4fb465a2cbe19666202ae24aecee27d2f6b4c80836dfe1e86a6f9a14a4dd3b1d269bdeda4e6834e82fad20b40c15a2294af054263240ceb2acfc724382c5b56e780435382a109b39eeadd5ad20ca6a77df4f9afa2f67f4800f42859a240ca4fa4f1cf22f1782c7bfb564efd341ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0ec1c1b1947117a2f8072ea6b842a4d077494daf40560d105d03591bfead6189e00000000"
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
      value: 6000, // Amount in satoshis
    },
    {
      address: process.env.changeAddress,
      value: 2000 - 2000,
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
    // API(process.env.url_internal, "testmempoolaccept", [transaction]);
  })
  .catch((error) => {
    console.log(error);
  });
