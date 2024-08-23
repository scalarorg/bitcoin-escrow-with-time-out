// A TRANSACTION THAT CONTAIN OP_RETURN (/src/img/img004.png)

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
const address_A = "tb1qtjejn77rm075tz85370mvapcn46w7eztmkmvhg";
const privateKeyWIF_A = process.env.private_key_A!; // Staker/User

const previousHex =
  "020000000001016e0084610c23bd5ac5d7d64ae3afbb94577e22bc83a76fc5f75bcb8581183b800000000000fdffffff0246e90000000000001600145cb329fbc3dbfd4588f48f9fb674389d74ef644b00000000000000004a6a48bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbccccccccccccccccccccccccccccccccccccccccffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff02473044022024796ca0b7d5b05f3460da4b899a4f6a413a8d17051ceeba52bd34ead797fb9402203e5248eca6e35a5d0db69bf6b74f8d33c4c71e863254529346c767716104c590012103e185fc28a2c48f31f191c77fa40adad3ccb3297f1c87336dd76a5b49b942eb2e00000000";
const vout01 = 0;

const amount01 = 59718;
const changeAmount = 10000;

// --------------------------------------------------------------------
async function createTransaction() {
  // ------------------- Init
  const keypair_A = ECPair.fromWIF(privateKeyWIF_A, network);
  //   Init Psbt transaction
  const txb = new bitcoin.Psbt({ network });
  txb.setVersion(2);
  txb.setLocktime(0);

  // ------------------- Build data using OP_RETURN
  // chainID random for 8 bytes
  let message01 = Buffer.from("ffffffffffffffff", "hex");
  // address random for 20 bytes
  let message02 = Buffer.from(
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "hex"
  );
  // address random for 20 bytes
  let message03 = Buffer.from(
    "cccccccccccccccccccccccccccccccccccccccc",
    "hex"
  );
  // amount random for 32 bytes
  let message04 = Buffer.from(
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "hex"
  );
  let message_data = Buffer.concat([
    message01,
    message02,
    message03,
    message04,
  ]);
  const embeded_data = [
    bitcoin.opcodes.OP_RETURN, // OP_RETURN should be a single byte
    message_data,
  ];
  const message_script = bitcoin.script.compile(embeded_data);
  const script_embeded = bitcoin.payments.embed({
    data: [message_script],
    network: network,
  });

  // ------------------- Inputs
  const preTx = bitcoin.Transaction.fromHex(previousHex);
  txb.addInputs([
    {
      hash: preTx.getId(),
      index: vout01,
      witnessUtxo: {
        script: preTx.outs[vout01].script,
        value: preTx.outs[vout01].value,
      },
      sequence: 0xfffffffd,
    },
  ]);

  // ------------------- Outputs
  txb.addOutputs([
    {
      address: address_A,
      value: amount01 - changeAmount,
    },
    {
      script: script_embeded.data![0],
      value: 0, // Amount in satoshis
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
