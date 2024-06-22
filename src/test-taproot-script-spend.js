require("dotenv").config();
const mempoolJS = require("@mempool/mempool.js");
const axios = require("axios");

const bitcoin = require("bitcoinjs-lib");
const ECPairFactory = require("ecpair").default;
const ecc = require("tiny-secp256k1");

// utils
const { tweakSigner, toXOnly } = require("../util/taproot-utils");
const { API } = require("../util/utils");
const { p2pk } = require("bitcoinjs-lib/src/payments");
const { witnessStackToScriptWitness} = require("../util/witness_stack_to_script_witness")

// Initialize the ECC library
bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

const keypair_taproot = ECPair.fromWIF(process.env.changeWIF, network);

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

const hash_lock_redeem = {
  output: hash_lock_script,
  redeemVersion: LEAF_VERSION_TAPSCRIPT,
};
const p2pk_redeem = {
  output: p2pk_script,
  redeemVersion: LEAF_VERSION_TAPSCRIPT,
};

const scriptTree = [
  {
    output: hash_lock_script,
  },
  {
    output: p2pk_script,
  },
];

const p2pk_p2tr = bitcoin.payments.p2tr({
  internalPubkey: toXOnly(keypair_taproot.publicKey),
  scriptTree,
  redeem: p2pk_redeem,
  network,
});

const hash_lock_p2tr = bitcoin.payments.p2tr({
  internalPubkey: toXOnly(keypair_taproot.publicKey),
  scriptTree,
  redeem: hash_lock_redeem,
  network,
});

const tapLeafScript = {
  leafVersion: LEAF_VERSION_TAPSCRIPT,
  script: hash_lock_redeem.output,
  controlBlock: hash_lock_p2tr.witness[p2pk_p2tr.witness.length - 1],
};

async function createTransaction_p2pk_psbt(changeWIF, receiverWIF) {
  const keyPair = ECPair.fromWIF(changeWIF, network);
  const txb = new bitcoin.Psbt({ network });
  // Default setting
  txb.setVersion(2);
  txb.setLocktime(0);

  const preUTXO = bitcoin.Transaction.fromHex(
    "02000000000101552412d4c2ea26f991d559c4df90be3e532e3f55b0f89ac1cd4570c485f3a7250000000000fdffffff04e093040000000000225120d42eaf3cb8da8a131a1d0e6def14ec7448d0f800d08f95513ce6989e949a5077e093040000000000225120d42eaf3cb8da8a131a1d0e6def14ec7448d0f800d08f95513ce6989e949a5077e093040000000000225120d42eaf3cb8da8a131a1d0e6def14ec7448d0f800d08f95513ce6989e949a5077108a2e0000000000160014d6daf3fba915fed7eb3a88d850faccb9fd00db17024730440220166411f14998a9d755f734d46c3b7d6ae22a6ea345cd58318f19c8d1ac3ca44802203fd55af625e2baac462b3fe7d70c7d86ea2eee23e5e76e8a81c69342dc16e2be0121022ae24aecee27d2f6b4c80836dfe1e86a6f9a14a4dd3b1d269bdeda4e6834e82f00000000"
  );
  txb.addInputs([
    // PUBKEY SPEND

    // {
    //   hash: "febaba546021ad4db3de86585a9eff6f6c57387bfa8457976832b908c0cbc454",
    //   index: 0, // Index of the output in the previous transaction
    //   witnessUtxo: {
    //     script: preUTXO.outs[0].script,
    //     value: preUTXO.outs[0].value,
    //   },
    //   tapLeafScript: [
    //     {
    //       leafVersion: LEAF_VERSION_TAPSCRIPT,
    //       script: p2pk_redeem.output,
    //       controlBlock: p2pk_p2tr.witness[p2pk_p2tr.witness.length - 1]
    //     }
    //   ],
    //   sequence: 0xfffffffd, // big endian
    // },
    {
      hash: "febaba546021ad4db3de86585a9eff6f6c57387bfa8457976832b908c0cbc454",
      index: 1, // Index of the output in the previous transaction
      witnessUtxo: {
        script: preUTXO.outs[0].script,
        value: preUTXO.outs[0].value,
      },
      tapLeafScript: [tapLeafScript],
      sequence: 0xfffffffd, // big endian
    },
  ]);

  const change_address = bitcoin.payments.p2wpkh({
    pubkey: keyPair.publicKey,
    network,
  }).address;
  txb.addOutputs([
    {
      address: change_address,
      value: preUTXO.outs[0].value,
    },
  ]);

  txb.signInput(0, keyPair); 

  function customFinalizer(_inputIndex, input) {
    const scriptSolution = [input.tapScriptSig[0].signature, secret_bytes];
    const witness = scriptSolution
      .concat(tapLeafScript.script)
      .concat(tapLeafScript.controlBlock);

    return {
      finalScriptWitness: witnessStackToScriptWitness(witness),
    };
  }

  txb.finalizeInput(0, customFinalizer);

  const tx = txb.extractTransaction();
  return tx.toHex();
}

const res = createTransaction_p2pk_psbt(process.env.changeWIF, false)
  .then((transaction) => {
    console.log(transaction);
    // API(process.env.url_internal, "sendrawtransaction", transaction);
    // API(process.env.url_internal,"testmempoolaccept", [transaction])
  })
  .catch((error) => {
    console.log(error);
  });
