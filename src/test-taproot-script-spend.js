require("dotenv").config();
const mempoolJS = require("@mempool/mempool.js");
const axios = require("axios");

const bitcoin = require("bitcoinjs-lib");
const ECPairFactory = require("ecpair").default;
const ecc = require("tiny-secp256k1");

// utils
const { tweakSigner, toXOnly } = require("../util/taproot-utils");
const { API } = require("../util/utils");

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
const scriptTree = [
  {
    output: hash_lock_script,
  },
  {
    output: p2pk_script,
  },
];
const script_p2tr = bitcoin.payments.p2tr({
  internalPubkey: toXOnly(keypair_taproot.publicKey),
  scriptTree,
  network,
});
const script_addr = script_p2tr.address ?? "";
console.log(script_addr)

async function createTransaction(changeWIF, receiverWIF) {
  const keyPair = ECPair.fromWIF(changeWIF, network);
  const txb = new bitcoin.Psbt({ network });
  // Default setting
  txb.setVersion(2);
  txb.setLocktime(0);

  const preUTXO = bitcoin.Transaction.fromHex(
    "02000000029a57d306a96eb2aff57f759c95ef06b471636d523f3c6cab46abdd3699406dd3000000006b483045022100e19620fc52f3cd73c6a675b8e0f60b4492daf4df945ad655e130fab289b6aad402205cf7f8b07ef91518c1fdd820942a50c6d8c850c947f1813bf11f916ad5e64ffd012103f74c53f2e72c728d799d142072100d463be4df5dcc08bce73b56ab1552cdaef3fdffffff71398f1393d52784865f7de67c473e87d9d9f2ff812713b65646e0356ae7b02f010000006a473044022039fb78e6c4b9c020d08b1d737ac58b3d715f7a422e1d33bb842f5433e40d189402203aba59ec58116d218346bb9117fb3b826036708c5dbade57b768976f176e5dc2012103f74c53f2e72c728d799d142072100d463be4df5dcc08bce73b56ab1552cdaef3fdffffff0100093d0000000000160014d6daf3fba915fed7eb3a88d850faccb9fd00db1700000000"
  );
  txb.addInputs([
    {
      hash: "25a7f385c47045cdc19af8b0553f2e533ebe90dfc459d591f926eac2d4122455",
      index: 0, // Index of the output in the previous transaction
      witnessUtxo: {
        script: preUTXO.outs[0].script,
        value: preUTXO.outs[0].value,
      },
      sequence: 0xfffffffd, // big endian
    },
  ]);

  const change_address = bitcoin.payments.p2wpkh({
    pubkey: keyPair.publicKey,
    network,
  }).address;
  txb.addOutputs([
    {
      address: script_addr,
      value: 300000,
    },
  ]);

  txb.signInput(0, keyPair); // NOTE, with taproot spend, we need to use Tweaked Signer
  txb.finalizeAllInputs();

  const tx = txb.extractTransaction();
  return tx.toHex();
}
const res = createTransaction(process.env.changeWIF, false)
  .then((transaction) => {
    console.log(transaction);
    // API(process.env.url_internal, "sendrawtransaction", transaction);
    API(process.env.url_internal,"testmempoolaccept", [transaction])
  })
  .catch((error) => {
    console.log(error);
  });
