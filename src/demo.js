/*
REFERENCES:
  + https://medium.com/@nagasha/how-to-build-and-broadcast-a-bitcoin-transaction-using-bitcoinjs-bitcoinjs-lib-on-testnet-2d9c8ac725d6
  + https://www.youtube.com/watch?v=fE-PSB9ndI4
  + https://mempool.space/testnet/docs/api/rest#get-address-transactions
  # main: https://medium.com/@bitcoindeezy/bitcoin-basics-programming-with-bitcoinjs-lib-4a69218c0431
  # taproot: + https://dev.to/eunovo/a-guide-to-creating-taproot-scripts-with-bitcoinjs-lib-4oph
             + https://ordinallabs.medium.com/understanding-taproot-addresses-a-simple-guide-5475da0fb3d3
  */
require("dotenv").config();
const mempoolJS = require("@mempool/mempool.js");
const axios = require("axios");
const url = process.env.url_external;

// utils
const { B2S, API } = require("../util/utils.js");

const bitcoin = require("bitcoinjs-lib");
const ECPairFactory = require("ecpair").default;
const ecc = require("tiny-secp256k1");

// Set the network and ECPair:
const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

// Function to create a simple Partial Signed Bitcoin Transaction (PSBT) - 
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
      nonWitnessUtxo: preUTXO.toBuffer(),
      sequence: 0xfffffffd, // big endian
    },
  ]);
  const keyPairReciver = ECPair.fromWIF(receiverWIF, network);
  const p2wpkh_addr = bitcoin.payments.p2wpkh({
    pubkey: keyPairReciver.publicKey,
    network,
  });

  txb.addOutputs([
    {
      address: p2wpkh_addr.address,
      value: preUTXO.outs[0].value, // Amount in satoshis
    },
  ]);

  txb.signInput(0, keyPair);
  txb.finalizeAllInputs();

  const tx = txb.extractTransaction();
  return tx.toHex();
}

const res = createTransaction(
  process.env.changeWIF,
  process.env.receiverWIF
)
  .then((transaction) => {
    console.log(transaction);
    API(url, "sendrawtransaction", transaction); // Enable if want to push
  })
  .catch((error) => {
    console.log("lmao");
  });
