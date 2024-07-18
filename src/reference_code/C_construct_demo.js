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

// Construct taptree - must be in MAST from
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

  const preUTXO_0 = bitcoin.Transaction.fromHex(
    "0200000000010154c4cbc008b93268975784fa7b38576c6fff9e5a5886deb34dad216054babafe0000000000fdffffff0190d0030000000000160014d6daf3fba915fed7eb3a88d850faccb9fd00db1703403f484cda634b36892cc63a9ea504498fd7c131f72232842fa360dc52777c7ea5fe9890e1bf2991d9b4ac5ae1b4c7e0abaef115243a332a4fccc7bc3b01aecebb22202ae24aecee27d2f6b4c80836dfe1e86a6f9a14a4dd3b1d269bdeda4e6834e82fac41c02ae24aecee27d2f6b4c80836dfe1e86a6f9a14a4dd3b1d269bdeda4e6834e82f66efef60710d808e50cbbf6b2a5b3036e42306c495392c5b21f5de738788a14a00000000"
  );
  const preUTXO_1 = bitcoin.Transaction.fromHex(
    "0200000000010154c4cbc008b93268975784fa7b38576c6fff9e5a5886deb34dad216054babafe0200000000fdffffff0190d0030000000000160014d6daf3fba915fed7eb3a88d850faccb9fd00db1701407d943acf66113276835637aed02cb12a57a1109bdc7fe2ed85f597eaa8a50dd4354bc17dbbe548d3f78efb788a64b09b0183614020cd578e682fa9b00cecfdf700000000"
  );
  txb.addInputs([
    {
      hash: "68334f1a8ac3e403af3c2b5b34efa0494d8bb73a18553858f303d1904244e19f",
      index: 0, // Index of the output in the previous transaction
      witnessUtxo: {
        script: preUTXO_0.outs[0].script,
        value: preUTXO_0.outs[0].value,
      },
      sequence: 0xfffffffd, // big endian
    },
    {
      hash: "2851ade7b2cadaff7618e26903e74d77b9439ab3a3d2a4adcd3dd0ba6f9ba196",
      index: 0, // Index of the output in the previous transaction
      witnessUtxo: {
        script: preUTXO_1.outs[0].script,
        value: preUTXO_1.outs[0].value,
      },
      sequence: 0xfffffffd, // big endian
    },
  ]);
  txb.addOutputs([
    {
      address: script_p2tr.address,
      value: 150000, // Amount in satoshis
    },
    {
      address: script_p2tr.address,
      value: 150000, // Amount in satoshis
    },
    {
      address: script_p2tr.address,
      value: 150000, // Amount in satoshis
    },
  ]);
  txb.signAllInputs(keyPair)
  txb.finalizeAllInputs();

  const tx = txb.extractTransaction();
  return tx.toHex();
}
const res = createTransaction(process.env.changeWIF)
  .then((transaction) => {
    console.log(transaction);
    API(process.env.url_internal, "sendrawtransaction", transaction);
    // API(process.env.url_internal, "testmempoolaccept", [transaction]);
  })
  .catch((error) => {
    console.log(error);
  });
