require("dotenv").config();
const mempoolJS = require("@mempool/mempool.js");
const axios = require("axios");

const bitcoin = require("bitcoinjs-lib");
const ECPairFactory = require("ecpair").default;
const ecc = require("tiny-secp256k1");

// utils
const { tweakSigner, toXOnly } = require("../util/taproot-utils");
const { API } = require("../util/utils");

// Initialize the ECC library
bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

const keypair_taproot = ECPair.fromWIF(process.env.changeWIF, network);

// Taproot Key-spend transaction - Only publicKey
const tweakedSigner = tweakSigner(keypair_taproot, { network });

const p2pktr = bitcoin.payments.p2tr({
  pubkey: toXOnly(tweakedSigner.publicKey),
  network,
});

const p2pktr_addr = p2pktr.address ?? "";
// Check p2pktr
console.log(p2pktr_addr);

async function createTransaction(changeWIF, receiverWIF) {
  const keyPair = ECPair.fromWIF(changeWIF, network);
  const txb = new bitcoin.Psbt({ network });
  // Default setting
  txb.setVersion(2);
  txb.setLocktime(0);

  const preUTXO = bitcoin.Transaction.fromHex(
    "02000000000101d5ea2280891d000221844a534a7c7b0528b0371c5b0a46bdeb33fdcc60b623850000000000fdffffff0158440e0000000000225120c792c05c04b67e3f4013162f5ffb7f85916178b32c2a07ab85cb129cecfa580b02483045022100fcc7b68345ac9f85de53a94a49ca92490cc823ca883c5c1f547a6adfc96c32ae02201bf215b0bae82e70b2c689a5fd9a9510ed2989bdca31370e51bb5899318a2006012103f74c53f2e72c728d799d142072100d463be4df5dcc08bce73b56ab1552cdaef300000000"
  );
  txb.addInputs([
    {
      hash: "72157beb6ae09e280f060ba18771a62b564b377bc084741594dcc8e6fdeb1c85",
      index: 0, // Index of the output in the previous transaction
      witnessUtxo: {
        script: preUTXO.outs[0].script, 
        value: preUTXO.outs[0].value,
      },
      tapInternalKey: toXOnly(keyPair.publicKey),
      sequence: 0xfffffffd, // big endian
    },
  ]);

  txb.addOutputs([
    {
      address: "tb1pugkzqqg9jmah9my5ew7xaeta0ulyrf3n2hqkwj5krgw4hm725pgqd348dy",
      value: preUTXO.outs[0].value - 50000, // Amount in satoshis
    },
  ]);
  txb.signInput(0, tweakedSigner); // NOTE, with taproot spend, we need to use Tweaked Signer
  txb.finalizeAllInputs();

  const tx = txb.extractTransaction();
  return tx.toHex();
}
const res = createTransaction(process.env.changeWIF, false)
  .then((transaction) => {
    console.log(transaction);
    // API(process.env.url_internal, "sendrawtransaction", transaction);
    API(process.env.url_internal,"testmempoolaccept", [transaction])
  })
  .catch((error) => {
    console.log(error);
  });
