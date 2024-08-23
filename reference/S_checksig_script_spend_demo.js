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
const { testnet } = require("bitcoinjs-lib/src/networks");

// Initialize the ECC library
bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;
// ----------------------------------------------------------------
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

// Create the transaction spending from the existing P2TR output
const p2pk_tapleaf = bitcoin.payments.p2tr({
  internalPubkey: toXOnly(keypair_taproot.publicKey),
  scriptTree,
  redeem: p2pk_redeem,
  network: testnet,
});
// ----------------------------------------------------------------
async function createTransaction(changeWIF) {
  const keyPair = ECPair.fromWIF(changeWIF, network);
  const txb = new bitcoin.Psbt({ network });
  // Default setting
  txb.setVersion(2);
  txb.setLocktime(0);

  const preUTXO = bitcoin.Transaction.fromHex(
    "020000000001029fe1444290d103f3583855183ab78b4d49a0ef345b2b3caf03e4c38a1a4f33680000000000fdffffff96a19b6fbad03dcdada4d2a3b39a43b9774de70369e21876ffdacab2e7ad51280000000000fdffffff03f049020000000000225120d42eaf3cb8da8a131a1d0e6def14ec7448d0f800d08f95513ce6989e949a5077f049020000000000225120d42eaf3cb8da8a131a1d0e6def14ec7448d0f800d08f95513ce6989e949a5077f049020000000000225120d42eaf3cb8da8a131a1d0e6def14ec7448d0f800d08f95513ce6989e949a507702483045022100e2278ede62b8b8bcf26a3b9be59c05bc4ccff0f1ff18ab43ba94f413dc3371fc02202e620c33255c1dfba7fb7e11411738b62610d5aa0ddda960c92fbc1b253396e10121022ae24aecee27d2f6b4c80836dfe1e86a6f9a14a4dd3b1d269bdeda4e6834e82f0247304402201cd00508f5ff0f949beb811766de171c4700d9f714cf2079a72fc5560e99ac0302207947323942be06d3222c82c58be7772093c759bfa4d1676ed5164b55ebad8d2b0121022ae24aecee27d2f6b4c80836dfe1e86a6f9a14a4dd3b1d269bdeda4e6834e82f00000000"
  );
  txb.addInputs([
    {
      hash: "54cd0a57f9a769643f161ad76d8436403b3753f912b8278fc7a1fbdd67150a6e",
      index: 1, // Index of the output in the previous transaction
      witnessUtxo: {
        script: preUTXO.outs[0].script,
        value: preUTXO.outs[0].value,
      },
      tapLeafScript: [
        {
          leafVersion: p2pk_redeem.redeemVersion,
          script: p2pk_redeem.output,
          // why last witness:
          // + Script Execution
          // + Leaf Script Validation
          controlBlock: p2pk_tapleaf.witness[p2pk_tapleaf.witness.length - 1],
        },
      ],
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
  txb.signInput(0, keyPair);
  txb.finalizeAllInputs();

  const tx = txb.extractTransaction();
  return tx.toHex();
}
const res = createTransaction(process.env.changeWIF, false)
  .then((transaction) => {
    console.log(transaction);
    API(process.env.url_internal, "sendrawtransaction", transaction);
    // Require to test
    // API(process.env.url_internal, "testmempoolaccept", [transaction]);
  })
  .catch((error) => {
    console.log(error);
  });
