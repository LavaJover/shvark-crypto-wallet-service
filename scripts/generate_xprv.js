const bip39 = require("bip39");
const bip32 = require("bip32");
const bitcoin = require("bitcoinjs-lib");

async function generateXprv() {
  const mnemonic = bip39.generateMnemonic(); // 12-словная seed-фраза
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = bip32.fromSeed(seed, bitcoin.networks.testnet);

  const xprv = root.toBase58(); // мастер-приватный ключ

  console.log("Mnemonic:", mnemonic);
  console.log("Master XPRV:", xprv);
}

generateXprv();