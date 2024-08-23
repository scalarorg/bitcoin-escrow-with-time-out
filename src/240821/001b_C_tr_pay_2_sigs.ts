// A TRANSACTION THAT CREATE OUTPUT THAT REQUIRED TWO SIGNATURE (/src/img/img001.png)

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
  "020000000001011706dbeb1733f465fd08042467234a16257459db1de1ec60a8e76a317ad931350100000000fdffffff02204e00000000000022512003925d8fc6a839c379d817ddc4b98d07bc115341d7aa29321744b2089042744214dd0200000000001600145cb329fbc3dbfd4588f48f9fb674389d74ef644b02483045022100a9d3f5f63adb920984caf162be237de8b2036b8bc3e9d26885b976970e5bf5740220492bc1fcb053eb02b4ed561dca1c883997b62a82aecd43db14a3f162123af1c1012103e185fc28a2c48f31f191c77fa40adad3ccb3297f1c87336dd76a5b49b942eb2e00000000";
const vout = 1;
// const receiverAddress_B = "tb1qtjejn77rm075tz85370mvapcn46w7eztmkmvhg";
const address_A = "tb1qtjejn77rm075tz85370mvapcn46w7eztmkmvhg";
const address_C = "tb1q2307hnkkc50kn7m8uranjsuuxpj6uyhfz4rkpu";
const amount01 = 20000;
const amount02 = 20000;
const amount03 = 167668;
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
    // {
    //   hash: preTx.getId(),
    //   // hash: previousTxid,
    //   index: vout,
    //   // nonWitnessUtxo: Buffer.from(previousHex, "hex"),
    //   witnessUtxo: {
    //     script: preTx.outs[vout].script,
    //     value: preTx.outs[vout].value,
    //   },
    //   tapLeafScript: [
    //     {
    //       leafVersion: p2pk_redeem.redeemVersion,
    //       script: p2pk_redeem.output,
    //       controlBlock:
    //         script_p2tr_send.witness[script_p2tr_send.witness.length - 1],
    //     },
    //   ],
    //   sequence: 0xfffffffd,
    // },
  ]);

  //   Outputs
  txb.addOutputs([
    // {
    //   address: script_p2tr_send.address,
    //   value: amount01,
    // },
    // {
    //   address: script_p2tr_p2pk.address,
    //   value: amount02,
    // },
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
  // Create tweaked key to spend key path
  const tweakedKeyPair_B = tweakSigner(keypair_B, {
    tweakHash: script_p2tr_send.hash,
  });
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
