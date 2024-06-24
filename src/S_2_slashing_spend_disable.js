/*
REFERENCES:
  + https://medium.com/@nagasha/how-to-build-and-broadcast-a-bitcoin-transaction-using-bitcoinjs-bitcoinjs-lib-on-testnet-2d9c8ac725d6
  + https://www.youtube.com/watch?v=fE-PSB9ndI4
  + https://mempool.space/testnet/docs/api/rest#get-address-transactions
  # main: https://medium.com/@bitcoindeezy/bitcoin-basics-programming-with-bitcoinjs-lib-4a69218c0431
  # taproot: + https://dev.to/eunovo/a-guide-to-creating-taproot-scripts-with-bitcoinjs-lib-4oph
             + https://ordinallabs.medium.com/understanding-taproot-addresses-a-simple-guide-5475da0fb3d3
  # specific for taproot spend: 
             + https://github.com/bitcoinjs/bitcoinjs-lib/blob/master/test/integration/taproot.spec.ts
*/
require("dotenv").config();
const mempoolJS = require("@mempool/mempool.js");
const axios = require("axios");

const bitcoin = require("bitcoinjs-lib");
const ECPairFactory = require("ecpair").default;
const ecc = require("tiny-secp256k1");

// utils
const { tweakSigner, toXOnly } = require("./util/taproot-utils");
const { API } = require("./util/utils");
const {
  witnessStackToScriptWitness,
} = require("./util/witness_stack_to_script_witness");

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
      + Slashing: 2-of-3 spend
*/
const keypair_internal = ECPair.fromWIF(process.env.internalWIF, network);

const keypair_user = ECPair.fromWIF(process.env.userWIF, network);
const keypair_scalar = ECPair.fromWIF(process.env.scalarWIF, network);
const keypair_provider = ECPair.fromWIF(process.env.providerWIF, network);

const delay_time = 0x00400001; // 512 seconds
const staking_script_asm = [
  bitcoin.script.number.encode(delay_time),
  bitcoin.opcodes.OP_CHECKSEQUENCEVERIFY,
  bitcoin.opcodes.OP_DROP,
  toXOnly(keypair_user.publicKey),
  bitcoin.opcodes.OP_CHECKSIG,
];

const staking_script = bitcoin.script.compile(staking_script_asm);

// Slashing script: 2-of-3 spend mulsig
// Stack: [User - Scalar - Provider
/*
WARNING: tapscript disabled OP_CHECKMULTISIG and OP_CHECKMULTISIGVERIFY opcodes 
Let use OP_CHECKSIGADD
Material: https://github.com/babylonchain/btc-staking-ts/blob/main/src/utils/stakingScript.ts
*/
let threshold = 2;

const UC_slashing_script_asm = [
  toXOnly(keypair_user.publicKey),
  bitcoin.opcodes.OP_CHECKSIG,
  toXOnly(keypair_scalar.publicKey),
  bitcoin.opcodes.OP_CHECKSIGADD,
  bitcoin.script.number.encode(threshold),
  bitcoin.opcodes.OP_NUMEQUAL,
];
const UC_slashing_scrip = bitcoin.script.compile(UC_slashing_script_asm);

const UP_slashing_script_asm = [
  toXOnly(keypair_user.publicKey),
  bitcoin.opcodes.OP_CHECKSIG,
  toXOnly(keypair_provider.publicKey),
  bitcoin.opcodes.OP_CHECKSIGADD,
  bitcoin.script.number.encode(threshold),
  bitcoin.opcodes.OP_NUMEQUAL,
];
const UP_slashing_scrip = bitcoin.script.compile(UP_slashing_script_asm);

const CP_slashing_script_asm = [
  toXOnly(keypair_scalar.publicKey),
  bitcoin.opcodes.OP_CHECKSIG,
  toXOnly(keypair_provider.publicKey),
  bitcoin.opcodes.OP_CHECKSIGADD,
  bitcoin.script.number.encode(threshold),
  bitcoin.opcodes.OP_NUMEQUAL,
];
const CP_slashing_scrip = bitcoin.script.compile(CP_slashing_script_asm);

// Construct taptree - must be in MAST from
const scriptTree = [
  {
    output: staking_script,
  },
  [
    {
      output: UC_slashing_scrip,
    },
    [
      {
        output: UP_slashing_scrip,
      },
      {
        output: CP_slashing_scrip,
      },
    ],
  ],
];

// Construct redeem
// Tapleaf version: https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki
const LEAF_VERSION_TAPSCRIPT = 0xc0;
// Construct redeem
// Tapleaf version: https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki

const UC_slashing_redeem = {
  output: UC_slashing_scrip,
  redeemVersion: LEAF_VERSION_TAPSCRIPT,
};
const UP_slashing_redeem = {
  output: UP_slashing_scrip,
  redeemVersion: LEAF_VERSION_TAPSCRIPT,
};
const CP_slashing_redeem = {
  output: CP_slashing_scrip,
  redeemVersion: LEAF_VERSION_TAPSCRIPT,
};

// Construct taproot information
function custom_tapLeaf_stakingPart(redeem) {
  return bitcoin.payments.p2tr({
    internalPubkey: toXOnly(keypair_internal.publicKey),
    scriptTree,
    redeem: redeem,
    network: network,
  });
}

// tapLeaf information
function tapLeafScript(redeem) {
  return {
    leafVersion: redeem.redeemVersion,
    script: redeem.output,
    // why last witness:
    // + Script Execution
    // + Leaf Script Validation
    controlBlock:
      custom_tapLeaf_stakingPart(redeem).witness[
        custom_tapLeaf_stakingPart(redeem).witness.length - 1
      ],
  };
}
async function createTransaction(redeem) {
  const txb = new bitcoin.Psbt({ network });
  // Default setting
  txb.setVersion(2);
  txb.setLocktime(0);

  const preUTXO = bitcoin.Transaction.fromHex(
    "020000000001011acaf5f4fb897201699bd445c1604e541a1ca694d2aceb2a524ab0fbfecf735e0000000000ffffffef05a086010000000000225120a9e5f82dee6aede3b401c0e79955979ed1c92c8faa90f599a17704a89bbe07c4a086010000000000225120a9e5f82dee6aede3b401c0e79955979ed1c92c8faa90f599a17704a89bbe07c4a086010000000000225120a9e5f82dee6aede3b401c0e79955979ed1c92c8faa90f599a17704a89bbe07c4a086010000000000225120a9e5f82dee6aede3b401c0e79955979ed1c92c8faa90f599a17704a89bbe07c4a086010000000000160014d6daf3fba915fed7eb3a88d850faccb9fd00db170247304402206741048d96dd4ce8248be312b5986dfa8c287509b2ce7a4a139437a88d9e8e56022058939513ba533c5604e2bf3fee82da76b278cc5f6ca275552325c76af6a4c7720121022ae24aecee27d2f6b4c80836dfe1e86a6f9a14a4dd3b1d269bdeda4e6834e82f00000000"
  );
  let case_index;
  if (redeem == UC_slashing_redeem) {
    case_index = 1;
  } else if (redeem == UP_slashing_redeem) {
    case_index = 2;
  } else if (redeem == CP_slashing_redeem) {
    case_index = 3;
  } else return "lmao";
  txb.addInputs([
    {
      hash: "d9fc64d6db1c6a2df075767e8d9ea8191f7340e7c0006310afbc959fe64b1b17",
      index: case_index, // Index of the output in the previous transaction
      witnessUtxo: {
        script: preUTXO.outs[case_index].script,
        value: preUTXO.outs[case_index].value,
      },
      tapLeafScript: [tapLeafScript(redeem)],
      sequence: 0xfffffffd, // big endian
    },
  ]);
  txb.addOutputs([
    {
      address: "tb1q6md087afzhld06e63rv9p7kvh87spkchyguwg0",
      value: preUTXO.outs[0].value - 50000, // Amount in satoshis
    },
  ]);
  const keypair_random = ECPair.makeRandom({ network });
  if (redeem == UC_slashing_redeem) {
    txb.signInput(0, keypair_user);

    txb.signInput(0, keypair_scalar);
  } else if (redeem == UP_slashing_redeem) {
    txb.signInput(0, keypair_user);

    txb.signInput(0, keypair_provider);
  } else if (redeem == CP_slashing_redeem) {
    txb.signInput(0, keypair_scalar);

    txb.signInput(0, keypair_provider);
  }

  // const customFinalizer = (_inputIndex, input) => {
  //   const scriptSolution = [input.tapScriptSig[2].signature,input.tapScriptSig[1].signature,input.tapScriptSig[0].signature];
  //   const witness = scriptSolution
  //     .concat(tapLeafScript.script)
  //     .concat(tapLeafScript.controlBlock);

  //   return {
  //     finalScriptWitness: witnessStackToScriptWitness(witness),
  //   };
  // };

  txb.finalizeAllInputs();

  const tx = txb.extractTransaction();
  return tx.toHex();
}
const res = createTransaction(CP_slashing_redeem)
  .then((transaction) => {
    console.log(transaction);
    API(process.env.url_internal, "sendrawtransaction", transaction);
    // Require to test
    // API(process.env.url_internal, "testmempoolaccept", [transaction]);
  })
  .catch((error) => {
    console.log(error);
  });
