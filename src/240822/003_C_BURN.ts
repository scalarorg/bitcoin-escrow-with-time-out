// A TRANSACTION THAT SENDING AN OUTPUT THAT REQUIRE INVOLMENT OF 3 PARTIES (/src/img/img003.png)

import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import * as ecc from "tiny-secp256k1";

bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

const { tweakSigner, toXOnly } = require("../utils/taproot-utils");
const {
  witnessStackToScriptWitness,
} = require("../utils/witness_stack_to_script_witness");
import { Signer } from "bitcoinjs-lib";
import { Taptree } from "bitcoinjs-lib/src/types";
import { API } from "../api";

// --------------------------------------------------------------------
const NUMS: string =
  "0250929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";
const NUMS_pubkey = Buffer.from(NUMS);
const address_A = "tb1qtjejn77rm075tz85370mvapcn46w7eztmkmvhg";
const privateKeyWIF_A = process.env.private_key_A!; // Staker/User
const privateKeyWIF_B = process.env.private_key_B!; // Service/dApp
const privateKeyWIF_C01 = process.env.private_key_C01!; // Custodials
const privateKeyWIF_C02 = process.env.private_key_C02!; // Custodials
const privateKeyWIF_C03 = process.env.private_key_C03!; // Custodials
const privateKeyWIF_C04 = process.env.private_key_C04!; // Custodials
const privateKeyWIF_C05 = process.env.private_key_C05!; // Custodials
const threshold = 3;

const previousHex =
  "02000000000101085bb7ce145766d7544feb033760796ce2c0718f32247c3ce0c4e24bfea4ea5c0000000000fdffffff02204e000000000000225120e3c4768e37427d451bda9a078043d794bd951262d5cdd5da7ea425bd0fd28bd510980200000000001600145cb329fbc3dbfd4588f48f9fb674389d74ef644b0247304402202fa25bba77ad472e9ebcbb01f9bc409217612aff98b4ee9411550ccb09e05d8e022060bcd3fd1ba84b61ee098540c83067877fd11536b78de73aac4aa350578ad513012103e185fc28a2c48f31f191c77fa40adad3ccb3297f1c87336dd76a5b49b942eb2e00000000";
const vout = 1;

const amount01 = 20000;
const amount02 = 20000;
const amount03 = 20000;
const amount04 = 110000;
const changeAmount = 10000;

// --------------------------------------------------------------------
async function createTransaction() {
  // ------------------- Init
  const keypair_A = ECPair.fromWIF(privateKeyWIF_A, network);
  const keypair_B = ECPair.fromWIF(privateKeyWIF_B, network);
  const keypair_C01 = ECPair.fromWIF(privateKeyWIF_C01, network);
  const keypair_C02 = ECPair.fromWIF(privateKeyWIF_C02, network);
  const keypair_C03 = ECPair.fromWIF(privateKeyWIF_C03, network);
  const keypair_C04 = ECPair.fromWIF(privateKeyWIF_C04, network);
  const keypair_C05 = ECPair.fromWIF(privateKeyWIF_C05, network);
  //   Init Psbt transaction
  const txb = new bitcoin.Psbt({ network });
  txb.setVersion(2);
  txb.setLocktime(0);

  // ------------------- Build tree
  //   Script
  //   Burn script: ABC
  const burn_script_asm = [
    toXOnly(keypair_A.publicKey),
    bitcoin.opcodes.OP_CHECKSIGVERIFY,
    toXOnly(keypair_B.publicKey),
    bitcoin.opcodes.OP_CHECKSIGVERIFY,
    toXOnly(keypair_C01.publicKey),
    bitcoin.opcodes.OP_CHECKSIG,
    toXOnly(keypair_C02.publicKey),
    bitcoin.opcodes.OP_CHECKSIGADD,
    toXOnly(keypair_C03.publicKey),
    bitcoin.opcodes.OP_CHECKSIGADD,
    toXOnly(keypair_C04.publicKey),
    bitcoin.opcodes.OP_CHECKSIGADD,
    toXOnly(keypair_C05.publicKey),
    bitcoin.opcodes.OP_CHECKSIGADD,
    bitcoin.script.number.encode(threshold),
    bitcoin.opcodes.OP_GREATERTHANOREQUAL,
  ];
  const burn_script = bitcoin.script.compile(burn_script_asm);

  //   Slash: AB
  const slash_script_asm = [
    toXOnly(keypair_A.publicKey),
    bitcoin.opcodes.OP_CHECKSIGVERIFY,
    toXOnly(keypair_B.publicKey),
    bitcoin.opcodes.OP_CHECKSIG,
  ];
  const slash_script = bitcoin.script.compile(slash_script_asm);

  //   AC
  const burn_without_dApp_script_asm = [
    toXOnly(keypair_A.publicKey),
    bitcoin.opcodes.OP_CHECKSIGVERIFY,
    toXOnly(keypair_C01.publicKey),
    bitcoin.opcodes.OP_CHECKSIG,
    toXOnly(keypair_C02.publicKey),
    bitcoin.opcodes.OP_CHECKSIGADD,
    toXOnly(keypair_C03.publicKey),
    bitcoin.opcodes.OP_CHECKSIGADD,
    toXOnly(keypair_C04.publicKey),
    bitcoin.opcodes.OP_CHECKSIGADD,
    toXOnly(keypair_C05.publicKey),
    bitcoin.opcodes.OP_CHECKSIGADD,
    bitcoin.script.number.encode(threshold),
    bitcoin.opcodes.OP_GREATERTHANOREQUAL,
  ];
  const burn_without_dApp_script = bitcoin.script.compile(
    burn_without_dApp_script_asm
  );

  // Construct taptree
  const scriptTree: Taptree = [
    {
      output: burn_script,
    },
    [
      {
        output: slash_script,
      },
      {
        output: burn_without_dApp_script,
      },
    ],
  ];
  // Construct redeem script
  const LEAF_VERSION_TAPSCRIPT = 0xc0;

  const burn_script_redeem = {
    output: burn_script,
    redeemVersion: LEAF_VERSION_TAPSCRIPT,
  };
  const script_p2tr_burn = bitcoin.payments.p2tr({
    internalPubkey: toXOnly(NUMS_pubkey),
    scriptTree,
    redeem: burn_script_redeem,
    network,
  });

  const slash_script_redeem = {
    output: slash_script,
    redeemVersion: LEAF_VERSION_TAPSCRIPT,
  };
  const script_p2tr_slash = bitcoin.payments.p2tr({
    internalPubkey: toXOnly(NUMS_pubkey),
    scriptTree,
    redeem: slash_script_redeem,
    network,
  });

  const burn_without_dApp_script_redeem = {
    output: burn_without_dApp_script,
    redeemVersion: LEAF_VERSION_TAPSCRIPT,
  };
  const script_p2tr_burn_without_dApp = bitcoin.payments.p2tr({
    internalPubkey: toXOnly(NUMS_pubkey),
    scriptTree,
    redeem: burn_without_dApp_script_redeem,
    network,
  });

  // ------------------- Inputs
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

  // ------------------- Outputs
  txb.addOutputs([
    {
      address: script_p2tr_burn.address!,
      value: amount01,
    },
    {
      address: script_p2tr_slash.address!,
      value: amount02,
    },
    {
      address: script_p2tr_burn_without_dApp.address!,
      value: amount03,
    },
    {
      address: address_A,
      value: amount04 - changeAmount,
    },
  ]);

  // ------------------- Signing
  txb.signInput(0, keypair_A);
  txb.finalizeAllInputs();

  // ------------------- Extract
  const tx = txb.extractTransaction();
  return tx.toHex();
}

// --------------------------------------------------------------------
createTransaction()
  .then((transactionHex) => {
    // API(process.env.url!, "testmempoolaccept", [[transactionHex]]);
    API(process.env.url!, "sendrawtransaction", [transactionHex]);
  })
  .catch((error) => {
    console.error("Error:", error.message);
  });
