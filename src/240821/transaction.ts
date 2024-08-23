const bitcoin = require("bitcoinjs-lib");
const ECPairFactory = require("ecpair").default;
const ecc = require("tiny-secp256k1");

bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

import { API } from "../api";

const dotenv = require("dotenv");
dotenv.config({ path: "../.env" });

// ----------------------------------------------------------------
const privateKeyWIF = process.env.private_key;
const previousTxid =
  "523fa1daa7d67be06ea3802ea1a898053c0157daa04c53c75ca75e47bbfdd0cf";
const previousHex =
  "0200000000010172cee2bc89680dc4ec46f987541e2009251c8d63d3cb572344801de082decec60100000000fdffffff02605b0300000000001600145cb329fbc3dbfd4588f48f9fb674389d74ef644b10270000000000001600145cb329fbc3dbfd4588f48f9fb674389d74ef644b02483045022100f8bde556238c9f67a88ce140f67ffd52040742972bc5ecd8934dccd4e9a480b80220588d7064557bb68ae0829e25b60eec748ffd887354d22681c883048c411f81c8012103e185fc28a2c48f31f191c77fa40adad3ccb3297f1c87336dd76a5b49b942eb2e00000000";
const vout = 0;
const receiverAddress = "tb1qtqf8y24xttfmcl6nc5re953qdk3dwhjmsw0ehm";
const ownerAddress = "tb1qtjejn77rm075tz85370mvapcn46w7eztmkmvhg";
const amount01 = 160000;
const amount02 = 50000;
const changeAmount = 10000;
// ----------------------------------------------------------------

// create a simple transaction
async function createTransaction(
  privateKeyWIF: any,
  previousTxid: any,
  receiverAddress: any,
  previousHex: any
) {
  const preTx = bitcoin.Transaction.fromHex(previousHex);
  //  take the WIF-encoded private key (privateKeyWIF) and network information
  // and create a keyPair that we'll use for signing the transaction
  const keyPair = ECPair.fromWIF(privateKeyWIF, network);

  // create a transaction builder and pass the network. The bitcoin-js
  // Psbt class is used to do this.
  const txb = new bitcoin.Psbt({ network });

  // while these are default version and locktime values, you can set
  // custom values depending on your transaction
  txb.setVersion(2);
  txb.setLocktime(0);

  // add inputs: previous transaction Id, output index of the funding transaction
  // and, since this is a non segwit input, we must also pass the full previous
  // transaction hex as a buffer
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

  // add outputs as the buffer of receiver's address and the value with amount
  // of satoshis you're sending.
  txb.addOutputs([
    {
      address: receiverAddress,
      value: amount01,
    },
    {
      address: ownerAddress,
      value: amount02 - changeAmount,
    },
  ]); // Sending 0.0002 BTC

  //   txb.addOutput({
  //     script: Buffer.from(receiverAddress, "hex"),
  //     // value: 20000,
  //     value: 1000,
  //   }); // Sending 0.0002 BTC

  // sign with the generate keyPair and finalize the transansction
  // SIGN THE INDEX OF INPUT, NOT THE INDEX OF OUTPUT IN THE PREVIOUS TX
  txb.signInput(0, keyPair);
  txb.finalizeAllInputs();

  //  extract the transaction and get the raw hex serialization
  const tx = txb.extractTransaction();
  console.log(tx.virtualSize());
  return tx.toHex();
}

createTransaction(privateKeyWIF, previousTxid, receiverAddress, previousHex)
  .then((transactionHex) => {
    console.log("Transaction Hex:", transactionHex);
    // API(process.env.url!, "testmempoolaccept", [[transactionHex]]);
    API(process.env.url!, "sendrawtransaction", [transactionHex]);
  })
  .catch((error) => {
    console.error("Error:", error.message);
  });
