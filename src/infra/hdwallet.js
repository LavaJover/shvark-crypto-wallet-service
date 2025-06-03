const bip32 = require("bip32");
const bitcoin = require("bitcoinjs-lib");
require("dotenv").config();

const xprv = process.env.BTC_XPRV;
const network = bitcoin.networks.testnet;
const root = bip32.fromBase58(xprv, network);

function generateAddress(index) {
  const child = root.derivePath(`m/44'/0'/0'/0/${index}`);
  const { address } = bitcoin.payments.p2wpkh({ pubkey: child.publicKey, network });
  const wif = child.toWIF();
  return { address, wif };
}

module.exports = {
  generateAddress
};