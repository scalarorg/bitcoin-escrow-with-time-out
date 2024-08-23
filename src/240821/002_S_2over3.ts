// A TRANSACTION THAT SPENDING AN OUTPUT THAT NEED 2/3 SIGN (/src/img/img002.png)

const bitcoin = require("bitcoinjs-lib");
const ECPairFactory = require("ecpair").default;
const ecc = require("tiny-secp256k1");

bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

const { tweakSigner, toXOnly } = require("./utils/taproot-utils");
const {
  witnessStackToScriptWitness,
} = require("./utils/witness_stack_to_script_witness");
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
  "020000000001013f632b24ff4eb10fb70f5b60dc80302e5d2024f328da766f570fb7098dfc8f000100000000fdffffff02204e0000000000002251208e41f1abdd67ef56dbddf581289a161144ac468ecd28231e28f253c08024e9c8b4f20100000000001600145cb329fbc3dbfd4588f48f9fb674389d74ef644b024830450221008fb2dd701df599f2f154cc6dcf4b43d8e926ce60fd66e6d2266a2ced990f091802201801cafa88b76ffb41413e1587981f79f83980fce37e5b7b5b47d504d483c43d012103e185fc28a2c48f31f191c77fa40adad3ccb3297f1c87336dd76a5b49b942eb2e00000000";
const vout = 0;
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
      // hash: previousTxid,
      index: vout,
      // nonWitnessUtxo: Buffer.from(previousHex, "hex"),
      witnessUtxo: {
        script: preTx.outs[vout].script,
        value: preTx.outs[vout].value,
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
  txb.signInput(0, keypair_C);
  txb.signInput(0, keypair_B);
  txb.signInput(0, keyPair_A);
  //   txb.finalizeAllInputs();
  const customFinalizer = (_inputIndex: any, input: any) => {
    const empty_vector = Buffer.from([]);
    const scriptSolution = [
      // input.tapScriptSig[0].signature,
      empty_vector,
      // input.tapScriptSig[1].signature,
      empty_vector,
      input.tapScriptSig[2].signature,
    ];
    const witness = scriptSolution
      .concat(custom_script_redeem.output)
      .concat(
        script_p2tr_custom.witness[script_p2tr_custom.witness.length - 1]
      );

    return {
      finalScriptWitness: witnessStackToScriptWitness(witness),
    };
  };
  // verify the input 0
  txb.finalizeInput(0, customFinalizer);

  //   Extract
  const tx = txb.extractTransaction();
  return tx.toHex();
}

// ----------------------------------------------------------------
createTransaction()
  .then((transactionHex) => {
    // console.log("Transaction Hex:", transactionHex);
    API(process.env.url!, "testmempoolaccept", [[transactionHex]]);
    // API(process.env.url!, "sendrawtransaction", [transactionHex]);
  })
  .catch((error) => {
    console.error("Error:", error.message);
  });
