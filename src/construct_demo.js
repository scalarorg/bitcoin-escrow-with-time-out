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
    "0200000000010154c4cbc008b93268975784fa7b38576c6fff9e5a5886deb34dad216054babafe0100000000fdffffff0190d0030000000000160014d6daf3fba915fed7eb3a88d850faccb9fd00db170440a0667ce2072432d9da5db91ac7e4fd734887a710fc4aa270232e21dfb2c099183d398245d52c60a0b1c38e9f76d4b7fb22c8528cb896e7bf28e38e16356026930653454352455439a9142d261cc8cd214eccdfe4b0fa6a1d9576ae08a0c388202ae24aecee27d2f6b4c80836dfe1e86a6f9a14a4dd3b1d269bdeda4e6834e82fac41c02ae24aecee27d2f6b4c80836dfe1e86a6f9a14a4dd3b1d269bdeda4e6834e82f27672ddb89164c52dbd1609ff005a722c449f21ba270120c40bee5fe89116c8d00000000"
  );
  txb.addInputs([
    {
      hash: "1f6a1c964f3dcb22be6b73fae1ad3b3444ebf72193a8b0034c1e455c1e8278b0",
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
      value: preUTXO.outs[0].value - 50000, // Amount in satoshis
    },
  ]);
  txb.signInput(0, keyPair); // NOTE, with taproot spend, we need to use Tweaked Signer
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
