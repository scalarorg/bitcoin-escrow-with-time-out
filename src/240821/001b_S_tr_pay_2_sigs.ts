// A TRANSACTION THAT SPENDING BY SIGNING 2 SIGNATURES (/src/img/img001.png)

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
const previousHex_01 =
  "020000000001011a434a01942028b5eebe46a4a605ff123e3d5feafa453db9c172ca1baa6409fe0100000000fdffffff03204e00000000000022512003925d8fc6a839c379d817ddc4b98d07bc115341d7aa29321744b20890427442204e00000000000022512003925d8fc6a839c379d817ddc4b98d07bc115341d7aa29321744b2089042744274c70300000000001600145cb329fbc3dbfd4588f48f9fb674389d74ef644b02483045022100ddf414f5bfa3f8ed22e9183ac45d6f4cd67bf018a12b8bdf34e75a01a0cf8090022017979e0bb2854372e33bfb2da4df344282472462f40bf21eaf66ac7e4b5aaa53012103e185fc28a2c48f31f191c77fa40adad3ccb3297f1c87336dd76a5b49b942eb2e00000000";
const previousHex_02 =
  "020000000001011a434a01942028b5eebe46a4a605ff123e3d5feafa453db9c172ca1baa6409fe0100000000fdffffff03204e00000000000022512003925d8fc6a839c379d817ddc4b98d07bc115341d7aa29321744b20890427442204e00000000000022512003925d8fc6a839c379d817ddc4b98d07bc115341d7aa29321744b2089042744274c70300000000001600145cb329fbc3dbfd4588f48f9fb674389d74ef644b02483045022100ddf414f5bfa3f8ed22e9183ac45d6f4cd67bf018a12b8bdf34e75a01a0cf8090022017979e0bb2854372e33bfb2da4df344282472462f40bf21eaf66ac7e4b5aaa53012103e185fc28a2c48f31f191c77fa40adad3ccb3297f1c87336dd76a5b49b942eb2e00000000";
const previousHex_03 =
  "0200000000010169a1687ded03ef192c08a00c6d58c1c99a220bb97a8fc79aaaad9798d0f305720100000000fdffffff02204e000000000000225120c19e872918b15ef03604bf3fc5a183184f539f2d24dfff4d97a54689ea2696e0e4670200000000001600145cb329fbc3dbfd4588f48f9fb674389d74ef644b024830450221008ffce52a51765d42d46e9c43bb1530f6f2adb0172f6091c1d0b9f91cd1614ca1022021528576f56f97b9425ab80638fe8c7fae385fa161b370af37b7214aabf6b228012103e185fc28a2c48f31f191c77fa40adad3ccb3297f1c87336dd76a5b49b942eb2e00000000";
const vout_01 = 0;
const vout_02 = 1;
// const receiverAddress_B = "tb1qtjejn77rm075tz85370mvapcn46w7eztmkmvhg";
const address_A = "tb1qtjejn77rm075tz85370mvapcn46w7eztmkmvhg";
const address_C = "tb1q2307hnkkc50kn7m8uranjsuuxpj6uyhfz4rkpu";
const amount01 = 20000;
// const amount02 = 2000;
// const amount03 = 2000;
const changeAmount = 10000;

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
    "OP_CHECKSIGVERIFY",
    `${toXOnly(keypair_C.publicKey).toString("hex")}`,
    "OP_CHECKSIG",
  ].join(" ");
  const custom_script = bitcoin.script.fromASM(custom_script_asm);
  console.log(custom_script.toString("hex"));

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

  const script_p2tr_send = bitcoin.payments.p2tr({
    internalPubkey: toXOnly(keypair_B.publicKey),
    scriptTree,
    network,
  }); // Taproot adrs

  const script_p2tr_p2pk = bitcoin.payments.p2tr({
    internalPubkey: toXOnly(keypair_B.publicKey),
    scriptTree,
    redeem: p2pk_redeem,
    network,
  }); // Taproot adrs

  const script_p2tr_custom = bitcoin.payments.p2tr({
    internalPubkey: toXOnly(keypair_B.publicKey),
    scriptTree,
    redeem: custom_script_redeem,
    network,
  }); // Taproot adrs

  // Default setting
  txb.setVersion(2);
  txb.setLocktime(0);

  // Inputs
  const preTx_01 = bitcoin.Transaction.fromHex(previousHex_01);
  const preTx_02 = bitcoin.Transaction.fromHex(previousHex_02);
  const preTx_03 = bitcoin.Transaction.fromHex(previousHex_03);
  txb.addInputs([
    // {
    //   // To spend input when only need the pubkey
    //   hash: preTx_01.getId(),
    //   // hash: previousTxid,
    //   index: vout_01,
    //   // nonWitnessUtxo: Buffer.from(previousHex, "hex"),
    //   witnessUtxo: {
    //     script: preTx_01.outs[vout_01].script,
    //     value: preTx_01.outs[vout_01].value,
    //   },
    //   tapInternalKey: toXOnly(keypair_B.publicKey),
    //   tapMerkleRoot: script_p2tr_send.hash,
    //   sequence: 0xfffffffd,
    // },
    // {
    //   hash: preTx_02.getId(),
    //   // hash: previousTxid,
    //   index: vout_02,
    //   // nonWitnessUtxo: Buffer.from(previousHex, "hex"),
    //   witnessUtxo: {
    //     script: preTx_02.outs[vout_02].script,
    //     value: preTx_02.outs[vout_02].value,
    //   },
    //   tapLeafScript: [
    //     {
    //       leafVersion: p2pk_redeem.redeemVersion,
    //       script: p2pk_redeem.output,
    //       controlBlock:
    //         script_p2tr_p2pk.witness[script_p2tr_p2pk.witness.length - 1],
    //     },
    //   ],
    //   sequence: 0xfffffffd,
    // },
    {
      hash: preTx_03.getId(),
      // hash: previousTxid,
      index: vout_01,
      // nonWitnessUtxo: Buffer.from(previousHex, "hex"),
      witnessUtxo: {
        script: preTx_03.outs[vout_01].script,
        value: preTx_03.outs[vout_01].value,
      },
      tapLeafScript: [
        {
          leafVersion: custom_script_redeem.redeemVersion,
          script: custom_script_redeem.output,
          controlBlock:
            script_p2tr_custom.witness[script_p2tr_custom.witness.length - 1],
        },
      ],
      sequence: 0xfffffffd,
    },
  ]);

  //   Outputs
  txb.addOutputs([
    {
      address: address_A,
      value: amount01 - changeAmount,
    },
  ]);

  // Signing
  // Create tweaked key to spend key path
  const tweakedKeyPair_B = tweakSigner(keypair_B, {
    tweakHash: script_p2tr_send.hash,
  });
  //   txb.signInput(0, tweakedKeyPair_B);

  //   txb.signInput(1, keypair_C);

  txb.signInput(0, keypair_C);
  txb.signInput(0, keypair_B);

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
