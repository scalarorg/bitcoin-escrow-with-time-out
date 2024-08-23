// A TRANSACTION THAT SEND AN OUTPUT THAT NEED 2/3 SIGN, ALSO NOT ALLOW SPEND BY PUBKEY (/src/img/img002.png)

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
const NUMS: string =
  "0250929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";
const NUMS_pubkey = Buffer.from(NUMS);
const privateKeyWIF_A = process.env.private_key_A;
const privateKeyWIF_B = process.env.private_key_B;
const privateKeyWIF_C = process.env.private_key_C;
// const previousTxid = "3abe41032f9095267b95be0fb92d175aec16a1d1e79f3e9ca76cbe7f1db7e7ff";
const previousHex =
  "0200000000010169a1687ded03ef192c08a00c6d58c1c99a220bb97a8fc79aaaad9798d0f305720100000000fdffffff02204e000000000000225120c19e872918b15ef03604bf3fc5a183184f539f2d24dfff4d97a54689ea2696e0e4670200000000001600145cb329fbc3dbfd4588f48f9fb674389d74ef644b024830450221008ffce52a51765d42d46e9c43bb1530f6f2adb0172f6091c1d0b9f91cd1614ca1022021528576f56f97b9425ab80638fe8c7fae385fa161b370af37b7214aabf6b228012103e185fc28a2c48f31f191c77fa40adad3ccb3297f1c87336dd76a5b49b942eb2e00000000";
const vout = 1;
// const receiverAddress_B = "tb1qtjejn77rm075tz85370mvapcn46w7eztmkmvhg";
const address_A = "tb1qtjejn77rm075tz85370mvapcn46w7eztmkmvhg";
const address_C = "tb1q2307hnkkc50kn7m8uranjsuuxpj6uyhfz4rkpu";
const amount01 = 20000;
const amount02 = 20000;
const amount03 = 137668;
const changeAmount = 10000;

// ----------------------------------------------------------------
async function createTransaction() {
  const keyPair_A = ECPair.fromWIF(privateKeyWIF_A, network);
  const keypair_B = ECPair.fromWIF(privateKeyWIF_B, network);
  const keypair_C = ECPair.fromWIF(privateKeyWIF_C, network);
  const txb = new bitcoin.Psbt({ network });

  // ------------------- Build tree
  // Script for 2to3 sig
  const custom_script_asm = [
    `${toXOnly(keyPair_A.publicKey).toString("hex")}`,
    "OP_CHECKSIG",
    `${toXOnly(keypair_B.publicKey).toString("hex")}`,
    "OP_CHECKSIGADD",
    `${toXOnly(keypair_C.publicKey).toString("hex")}`,
    "OP_CHECKSIGADD",
    "OP_2",
    "OP_GREATERTHANOREQUAL",
  ].join(" ");
  const custom_script = bitcoin.script.fromASM(custom_script_asm);

  // Construct taptree
  const LEAF_VERSION_TAPSCRIPT = 0xc0;
  const custom_script_redeem = {
    output: custom_script,
    redeemVersion: LEAF_VERSION_TAPSCRIPT,
  };

  const scriptTree: Taptree = [
    {
      output: custom_script,
    },
    {
      output: custom_script,
    },
  ];

  const script_p2tr_custom = bitcoin.payments.p2tr({
    internalPubkey: toXOnly(NUMS_pubkey),
    scriptTree,
    redeem: custom_script_redeem,
    network,
  }); // Taproot adrs

  // Default setting
  txb.setVersion(2);
  txb.setLocktime(0);

  // Inputs
  const preTx = bitcoin.Transaction.fromHex(previousHex);
  txb.addInputs([
    {
      hash: preTx.getId(),
      index: vout,
      // nonWitnessUtxo: Buffer.from(previousHex, "hex"),
      witnessUtxo: {
        script: preTx.outs[vout].script,
        value: preTx.outs[vout].value,
      },
      sequence: 0xfffffffd,
    },
  ]);

  //   Outputs
  txb.addOutputs([
    {
      address: script_p2tr_custom.address,
      value: amount01,
    },
    {
      address: address_A,
      value: amount03 - changeAmount,
    },
  ]);

  // Signing
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
