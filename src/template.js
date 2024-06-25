const mempoolJS = require("@mempool/mempool.js");
const axios = require("axios");

const bitcoin = require("bitcoinjs-lib");
const ECPairFactory = require("ecpair").default;
const ecc = require("tiny-secp256k1");

// utils
const { tweakSigner, toXOnly } = require("./util/taproot-utils");
const { API } = require("./util/utils");

// Initialize the ECC library
bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

// GEN address taproot for 3 spend: 1 key path - 2 script path
/*
3 Covenant staker:
  User - Scalar - Provider
  3 path:
    - internal key: Forcing withdraw - (Schnorr signature for User + Scalar + Provider)
    - Script path:
      + Staking: User withdraw after time lock
      + Slashing: 2-of-3 spend: User - Scalar - Provider 
      
*/
const keypair_internal = ECPair.fromWIF(process.env.internalWIF, network);

const keypair_user = ECPair.fromWIF(process.env.userWIF, network);
const keypair_thresholder = ECPair.fromWIF(process.env.thresholder, network);

/*  <delay time> OP_CHECKSEQUENCEVERIFY 
    OP_DROP 
    <publicKey>
    OP_CHECKSIG
*/
const delay_time = 0x00400001 // 512 seconds
const staking_script_asm = [
  bitcoin.script.number.encode(delay_time),
  bitcoin.opcodes.OP_CHECKSEQUENCEVERIFY,
  bitcoin.opcodes.OP_DROP,
  toXOnly(keypair_user.publicKey),
  bitcoin.opcodes.OP_CHECKSIG,
];
const staking_script = bitcoin.script.compile(staking_script_asm);

// Slashing script: 2-of-3 spend mulsig
// Case: User + Scalar
// Case: User + Provider
/*
WARNING: tapscript disabled OP_CHECKMULTISIG and OP_CHECKMULTISIGVERIFY opcodes 
Information: https://github.com/bitcoin/bips/blob/master/bip-0342.mediawiki

Let use OP_CHECKSIGADD
Material: + https://github.com/babylonchain/btc-staking-ts/blob/main/src/utils/stakingScript.ts
NOTE:
It seems that OP_CHECKSIGADD not work as we want:
let split script in to 3 path:
 + User - Scalar
 + User - Provider
 + Scalar - Provider
*/
let threshold = 2;

const sample_slashing_script_asm = [
  toXOnly(keypair_user.publicKey),
  bitcoin.opcodes.OP_CHECKSIG,
  toXOnly(keypair_thresholder.publicKey),
  bitcoin.opcodes.OP_CHECKSIGADD,
  bitcoin.script.number.encode(threshold),
  bitcoin.opcodes.OP_NUMEQUAL,
];
/* 
    <pubkey> OP_CHECKSIG <pubkey> OP_CHECKSIGADD <num of thresholder> OP_NUMEQUAL
*/

const sample_slashing_scrip = bitcoin.script.compile(sample_slashing_script_asm);


// Construct taptree - must be in MAST from
const scriptTree = [
    /* 
                                    Merkle Root 
                    H(A,B)                                 H(C,D)
            Script(A)       Script(B)            H(E,F)                  H(G)
                                        Script(E)     Script(F)       Script(G)  
    MAST Form
    */
];

// only for redeem version
const LEAF_VERSION_TAPSCRIPT = 0xc0;

// Gen taproot address
const script_p2tr = bitcoin.payments.p2tr({
  internalPubkey: toXOnly(keypair_internal.publicKey),
  scriptTree,
  network,
});

async function createTransaction() {
  // psbt information, bip174: https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki#user-content-Introduction
  const txb = new bitcoin.Psbt({ network });
  // Default setting
  txb.setVersion(2);
  txb.setLocktime(0);

  // example
  const preUTXO = bitcoin.Transaction.fromHex(
    "02000000000101c8c3b8103a6bcbe69e3802d5a2de343cb0ac7dc7b164bd0cb3f778a5007ada6c0100000000fdffffff02f877080000000000160014d6daf3fba915fed7eb3a88d850faccb9fd00db174f49130000000000160014dea5cec1d786dbfabab914bdf01a98d19a2f61650247304402204bd537029354c4911fd22843ba9df3ac9bb5f01ec2484c84578b10417c9aa4bd02202c456fdcc78eeb59d71eff83f649ec2e699abe33554298d9f30fa787a7812f15012102c22a22aa02faf47edc07a35e7ab41110d66e77308c7563e667541b1672fd3f5000000000"
  );
  // can use addInput to add 1 input 
  txb.addInputs([
    {
      hash: "f98e2bbb047cda2730b9c73ed559e0f2af43af392e7d671cde955875a4eeb2ef",
      index: 0, // Index of the output in the previous transaction
      witnessUtxo: {
        script: preUTXO.outs[0].script,
        value: preUTXO.outs[0].value,
      },
      /*
        <=0xFFFFFFFE — Locktime.
        <=0xFFFFFFFD — Replace-By-Fee (RBF).
        <=0xEFFFFFFF — Relative Locktime:
            + 0x00000000 to 0x0000FFFF — Blocks.
            + 0x00400000 to 0x0040FFFF — Time.
      */
      sequence: 0xffffffff, // big endian
    },
  ]);
  let value
  txb.addOutputs([
    {
      address: process.env.changeAddress,
      value: value, // Amount in satoshis
    },
  ]);

  const keyPair_signInput = ECPair.fromWIF(process.env.changeWIF, network);
  // Sign with sighash default signInput(index, keypair, sighashType)
  // BIP341 for more information: https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki#cite_note-21
  txb.signInput(0,keyPair_signInput);
  txb.finalizeAllInputs();
  
  const tx = txb.extractTransaction();
  return tx.toHex();
}
const res = createTransaction()
  .then((transaction) => {
    console.log(transaction);
    // API(process.env.url_internal, "sendrawtransaction", transaction);
    // API(process.env.url_internal, "testmempoolaccept", [transaction]);
  })
  .catch((error) => {
    console.log(error);
  });
