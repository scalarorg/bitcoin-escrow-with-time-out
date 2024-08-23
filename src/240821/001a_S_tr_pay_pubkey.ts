// A TRANSACTION THAT SPENDING AN OUTPUT THAT REQUIRED PUBKEY (/src/img/img001.png)

const bitcoin = require("bitcoinjs-lib");
const ECPairFactory = require("ecpair").default;
const ecc = require("tiny-secp256k1");

bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

const { tweakSigner, toXOnly } = require("./utils/taproot-utils");
import { Signer } from "bitcoinjs-lib";
import { Taptree } from "bitcoinjs-lib/src/types";
import { API } from "../api";

const dotenv = require("dotenv");
dotenv.config({ path: "../.env" });

// ----------------------------------------------------------------
const privateKeyWIF_A = process.env.private_key_A;
const privateKeyWIF_B = process.env.private_key_B;
const privateKeyWIF_C = process.env.private_key_C;
// const previousTxid = "3abe41032f9095267b95be0fb92d175aec16a1d1e79f3e9ca76cbe7f1db7e7ff";
const previousHex =
  "02000000000101f68d2591e03e68183aafc5f3abc5fe359d3fa8abcec9b8137c6edd14fa7c675e0000000000fdffffff02204e000000000000225120cc459adeaba7f244899c9b18013175f76886763f08acd8344fd8244bc185592e204e000000000000225120cc459adeaba7f244899c9b18013175f76886763f08acd8344fd8244bc185592e02483045022100b3882c33177913e6167f48f36004c2fe6a026e3b388679ae27166879ad08367902205ffa17abf27bac069587721eedb594775fe17c2513d545c96ea6204cc8c97710012103e185fc28a2c48f31f191c77fa40adad3ccb3297f1c87336dd76a5b49b942eb2e00000000";
const vout = 1;
// const receiverAddress_B = "tb1qtjejn77rm075tz85370mvapcn46w7eztmkmvhg";
const address_A = "tb1qtjejn77rm075tz85370mvapcn46w7eztmkmvhg";
const address_C = "tb1q2307hnkkc50kn7m8uranjsuuxpj6uyhfz4rkpu";
const amount01 = 10000;
const amount02 = 15000;
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

// const p2pk_script_asm = `${toXOnly(keypair_taproot.publicKey).toString(
//   "hex"
// )} OP_CHECKSIG`;
// const p2pk_script = bitcoin.script.fromASM(p2pk_script_asm);

// // Construct taptree
// // Tapleaf version: https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki
// const LEAF_VERSION_TAPSCRIPT = 0xc0;

// // Construct redeem
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

// // Gen taproot address
// const script_p2tr = bitcoin.payments.p2tr({
//   internalPubkey: toXOnly(keypair_taproot.publicKey),
//   scriptTree,
//   network,
// });

// ----------------------------------------------------------------
async function createTransaction() {
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

  // Script for 2sig
  const custom_script_asm = [
    `${toXOnly(keypair_B.publicKey).toString("hex")}`,
    "OP_CHECKSIG",
    `${toXOnly(keypair_C.publicKey).toString("hex")}`,
    "OP_CHECKSIG",
  ];
  const custom_script = bitcoin.script.fromASM(custom_script_asm);

  // Construct taptree
  const LEAF_VERSION_TAPSCRIPT = 0xc0;

  const p2pk_redeem = {
    output: p2pk_script,
    redeemVersion: LEAF_VERSION_TAPSCRIPT,
  };

  const custom_script_redeem = {
    output: custom_script,
    redeemVersion: LEAF_VERSION_TAPSCRIPT,
  };

  const scriptTree: Taptree = [
    {
      output: p2pk_script,
    },
    {
      output: custom_script,
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
    redeem: p2pk_redeem,
    network,
  }); // Taproot adrs

  // Default setting
  txb.setVersion(2);
  txb.setLocktime(0);

  // Inputs
  const preTx = bitcoin.Transaction.fromHex(previousHex);
  txb.addInputs([
    // {
    //   // To spend input when only need the pubkey
    //   hash: preTx.getId(),
    //   // hash: previousTxid,
    //   index: vout,
    //   // nonWitnessUtxo: Buffer.from(previousHex, "hex"),
    //   witnessUtxo: {
    //     script: preTx.outs[vout].script,
    //     value: preTx.outs[vout].value,
    //   },
    //   tapInternalKey: toXOnly(keypair_B.publicKey),
    //   tapMerkleRoot: script_p2tr_B.hash,
    //   sequence: 0xfffffffd,
    // },
    {
      hash: preTx.getId(),
      // hash: previousTxid,
      index: vout,
      // nonWitnessUtxo: Buffer.from(previousHex, "hex"),
      witnessUtxo: {
        script: preTx.outs[vout].script,
        value: preTx.outs[vout].value,
      },
      tapLeafScript: [
        {
          leafVersion: p2pk_redeem.redeemVersion,
          script: p2pk_redeem.output,
          // why last witness:
          // + Script Execution
          // + Leaf Script Validation
          controlBlock: script_p2tr_C.witness[script_p2tr_C.witness.length - 1],
        },
      ],
      sequence: 0xfffffffd,
    },
  ]);

  //   Outputs
  txb.addOutputs([
    {
      address: address_A,
      value: amount01,
    },
    // {
    //   address: address_C,
    //   value: amount02 - changeAmount,
    // },
  ]);

  //   Signing
  // Create tweaked key to spend key path
  const tweakedKeyPair_B = tweakSigner(keypair_B, {
    tweakHash: script_p2tr_B.hash,
  });
  txb.signInput(0, keypair_C);
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
