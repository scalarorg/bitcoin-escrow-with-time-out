// A TRANSACTION THAT CREATE OUTPUT THAT REQUIRED SPEND BY PUBKEY (/src/img/img001.png)

const bitcoin = require("bitcoinjs-lib");
const ECPairFactory = require("ecpair").default;
const ecc = require("tiny-secp256k1");

bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

const { toXOnly } = require("./utils/taproot-utils");
import { Signer } from "bitcoinjs-lib";
import { Taptree } from "bitcoinjs-lib/src/types";
import { API } from "../api";

const dotenv = require("dotenv");
dotenv.config({ path: "../.env" });

// ----------------------------------------------------------------
const privateKeyWIF_A = process.env.private_key_A;
const privateKeyWIF_B = process.env.private_key_B;
const privateKeyWIF_C = process.env.private_key_C;
const previousTxid =
  "5e677cfa14dd6e7c13b8c9ceaba83f9d35fec5abf3c5af3a18683ee091258df6";
const previousHex =
  "020000000001016823d6d84fe9f8f044850d9f122fba8fd65da8e7471dbacf0bc64cc37661d7510100000000fdffffff0250c30000000000001600145cb329fbc3dbfd4588f48f9fb674389d74ef644bdc2f01000000000016001408b7b00b0f720cf5cc3e7e38aaae1a572b962b2402483045022100e5c6f8bdd0b814d3d63c316b76d3e3555082ee3b8852be93c4f235ecebff3f9302203a6427e76b5154d7b9f79b7a93a032916055f56f7109b0a2b1f77c9ceced12900121032b122fd36a9db2698c39fb47df3e3fa615e70e368acb874ec5494e4236722b2d00000000";
const vout = 0;
// const receiverAddress_B = "tb1qtjejn77rm075tz85370mvapcn46w7eztmkmvhg";
const ownerAddress_A = "tb1qtjejn77rm075tz85370mvapcn46w7eztmkmvhg";
const amount01 = 20000;
const amount02 = 30000;
const changeAmount = 10000;

// ----------------------------------------------------------------
// const keypair_taproot = ECPair.fromWIF(process.env.changeWIF, network);

// // GEN address taproot for 3 spend: 1 key path - 2 script path
// const secret_bytes = Buffer.from("SECRET");
// const hash = bitcoin.crypto.hash160(secret_bytes);

// // Construct script to pay to hash_lock_keypair if the correct preimage/secret is provided
// const hash_script_asm = `OP_HASH160 ${hash.toString(
//   "hex"
// )} OP_EQUALVERIFY ${toXOnly(keypair_taproot.publicKey).toString(
//   "hex"
// )} OP_CHECKSIG`;
// const hash_lock_script = bitcoin.script.fromASM(hash_script_asm);

// Construct redeem
// const hash_lock_redeem = {
//   output: hash_lock_script,
//   redeemVersion: LEAF_VERSION_TAPSCRIPT,
// };
// const p2pk_redeem = {
//   output: p2pk_script,
//   redeemVersion: LEAF_VERSION_TAPSCRIPT,
// };

// // Construct taptree - must be in MAST from
// const scriptTree = [
//   {
//     output: hash_lock_script,
//   },
//   {
//     output: p2pk_script,
//   },
// ];

// ----------------------------------------------------------------
async function createTransaction() {
  // Init
  const keyPair_A = ECPair.fromWIF(privateKeyWIF_A, network);
  const keypair_B = ECPair.fromWIF(privateKeyWIF_B, network);
  const keypair_C = ECPair.fromWIF(privateKeyWIF_C, network);
  const txb = new bitcoin.Psbt({ network });

  // ------------------- Build tree
  // Script for p2pk
  const p2pk_script_asm = `${toXOnly(keypair_C.publicKey).toString(
    "hex"
  )} OP_CHECKSIG`;
  const p2pk_script = bitcoin.script.fromASM(p2pk_script_asm);

  // Construct taptree
  const LEAF_VERSION_TAPSCRIPT = 0xc0;

  // const p2pk_redeem = {
  //   output: p2pk_script,
  //   redeemVersion: LEAF_VERSION_TAPSCRIPT,
  // };

  const scriptTree: Taptree = [
    {
      output: p2pk_script,
    },
    {
      output: p2pk_script,
    },
  ];

  const script_p2tr_B = bitcoin.payments.p2tr({
    internalPubkey: toXOnly(keypair_B.publicKey),
    scriptTree,
    network,
  }); // Taproot adrs

  const script_p2tr_C = bitcoin.payments.p2tr({
    internalPubkey: toXOnly(keypair_B.publicKey),
    scriptTree,
    network,
  }); // Taproot adrs

  // ------------------- Default setting
  txb.setVersion(2);
  txb.setLocktime(0);

  // ------------------- Inputs
  const preTx = bitcoin.Transaction.fromHex(previousHex);
  txb.addInput({
    hash: previousTxid,
    index: vout,
    // nonWitnessUtxo: Buffer.from(previousHex, "hex"),
    witnessUtxo: {
      script: preTx.outs[vout].script,
      value: preTx.outs[vout].value,
    },
    sequence: 0xfffffffd,
  });

  // ------------------- Outputs
  txb.addOutputs([
    {
      address: script_p2tr_B.address,
      value: amount01,
    },
    {
      address: script_p2tr_C.address,
      value: amount02 - changeAmount,
    },
  ]);

  //   Signing
  txb.signInput(0, keyPair_A);
  txb.finalizeAllInputs();

  //   Extract
  const tx = txb.extractTransaction();
  return tx.toHex();
}

// ----------------------------------------------------------------
createTransaction()
  .then((transactionHex) => {
    // console.log("Transaction Hex:", transactionHex);
    // API(process.env.url!, "testmempoolaccept", [[transactionHex]]);
    API(process.env.url!, "sendrawtransaction", [transactionHex]);
  })
  .catch((error) => {
    console.error("Error:", error.message);
  });
