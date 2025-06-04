const express = require("express");
const { DataSource } = require("typeorm");
const dotenv = require("dotenv");
dotenv.config();

const walletEntity = require("./src/domain/wallet");
const transactionEntity = require("./src/domain/wallet_transaction");
const indexEntity = require("./src/domain/trader_wallet_index");
const { generateAddress } = require("./src/infra/hdwallet");
const axios = require("axios");

const bitcoin = require('bitcoinjs-lib');
const ECPairFactory = require('ecpair').default;
const ecc = require('tiny-secp256k1');
const ECPair = ECPairFactory(ecc);

const network = bitcoin.networks.testnet;

const app = express();
app.use(express.json());

// Init PostgreSQL
const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "5432"),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  synchronize: true,
  entities: [walletEntity, transactionEntity, indexEntity],
});

AppDataSource.initialize().then(() => {
  console.log("DB connected");

  const walletRepo = AppDataSource.getRepository("Wallet");
  const indexRepo = AppDataSource.getRepository("TraderWalletIndex");
  const txRepo = AppDataSource.getRepository("WalletTransaction");

  // Генерация BTC-кошелька для трейдера
  app.post("/wallets/create", async (req, res) => {
    const { traderId } = req.body;

    let index = await indexRepo.findOneBy({ traderId });
    if (!index) {
      index = indexRepo.create({ traderId });
      await indexRepo.save(index);
    }

    const { address, wif } = generateAddress(index.hdIndex);

    const wallet = walletRepo.create({
      traderId,
      currency: "BTC",
      address,
      balance: 0,
      frozen: 0,
    });
    await walletRepo.save(wallet);

    return res.json({ address }); // ⚠️ Никогда не отдаём wif в реальном API
  });

  // Подтверждение депозита (on-chain)
  app.post("/wallets/deposit", async (req, res) => {
    const { traderId, amount, txHash } = req.body;

    const wallet = await walletRepo.findOneBy({ traderId, currency: "BTC" });
    if (!wallet) return res.status(404).json({ error: "Wallet not found" });

    wallet.balance += amount;
    await walletRepo.save(wallet);

    const tx = txRepo.create({
      traderId,
      currency: "BTC",
      type: "deposit",
      amount,
      txHash,
      status: "confirmed",
    });
    await txRepo.save(tx);

    return res.json({ success: true });
  });

  // Заморозка средств под заказ
  app.post("/wallets/freeze", async (req, res) => {
    const { traderId, amount, orderId } = req.body;

    const wallet = await walletRepo.findOneBy({ traderId, currency: "BTC" });
    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    wallet.balance -= amount;
    wallet.frozen += amount;
    await walletRepo.save(wallet);

    const tx = txRepo.create({
      traderId,
      currency: "BTC",
      type: "freeze",
      amount,
      orderId,
      status: "pending",
    });
    await txRepo.save(tx);

    return res.json({ frozen: amount });
  });

  // Разморозка и перевод средств (off-chain)
  app.post("/wallets/release", async (req, res) => {
    const { traderId, orderId, rewardPercent = 0.01 } = req.body;

    const wallet = await walletRepo.findOneBy({ traderId, currency: "BTC" });
    if (!wallet) return res.status(404).json({ error: "Wallet not found" });

    const freezeTx = await txRepo.findOneBy({ orderId, type: "freeze" });
    if (!freezeTx) return res.status(404).json({ error: "No frozen transaction found" });

    const amount = freezeTx.amount;
    const reward = parseFloat((amount * rewardPercent).toFixed(8));

    wallet.frozen -= amount;
    wallet.balance += reward;
    await walletRepo.save(wallet);

    await txRepo.save(
      txRepo.create({
        traderId,
        currency: "BTC",
        type: "release",
        amount,
        orderId,
        status: "confirmed",
      })
    );

    await txRepo.save(
      txRepo.create({
        traderId,
        currency: "BTC",
        type: "reward",
        amount: reward,
        status: "confirmed",
      })
    );

    return res.json({ released: amount, reward });
  });

  app.post("/wallets/withdraw", async (req, res) => {
    const { traderId, toAddress, amount } = req.body;
  
    if (!traderId || !toAddress || !amount) {
      return res.status(400).json({ error: "Missing parameters" });
    }
  
    const wallet = await walletRepo.findOneBy({ traderId, currency: "BTC" });
    const indexRow = await indexRepo.findOneBy({ traderId });
    if (!wallet || !indexRow) {
      return res.status(404).json({ error: "Wallet not found" });
    }
  
    const { wif } = generateAddress(indexRow.hdIndex);
    const keyPair = ECPair.fromWIF(wif, network);
  
    try {
      const utxoRes = await axios.get(`https://mempool.space/testnet/api/address/${wallet.address}/utxo`);
      const utxos = utxoRes.data;
  
      if (!utxos.length) {
        return res.status(400).json({ error: "No available UTXO" });
      }
  
      const psbt = new bitcoin.Psbt({ network });
      let inputSum = 0;
      let inputCount = 0;
  
      for (const utxo of utxos) {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: bitcoin.address.toOutputScript(wallet.address, network),
            value: utxo.value,
          },
        });
  
        inputSum += utxo.value;
        inputCount++;
  
        if (inputSum >= amount * 1e8 + 1000) break;
      }
  
      if (inputSum < amount * 1e8 + 1000) {
        return res.status(400).json({ error: "Not enough balance in UTXO" });
      }
  
      const fee = 1000;
      const change = inputSum - Math.floor(amount * 1e8) - fee;
  
      psbt.addOutput({ address: toAddress, value: Math.floor(amount * 1e8) });
      if (change > 500) {
        psbt.addOutput({ address: wallet.address, value: change });
      }
  
      for (let i = 0; i < inputCount; i++) {
        psbt.signInput(i, keyPair);
      }
  
      psbt.finalizeAllInputs();
      const txHex = psbt.extractTransaction().toHex();
  
      const send = await axios.post("https://mempool.space/testnet/api/tx", txHex, {
        headers: { "Content-Type": "text/plain" },
      });
  
      const txid = send.data;
  
      wallet.balance -= amount;
      await walletRepo.save(wallet);
  
      await txRepo.save(
        txRepo.create({
          traderId,
          currency: "BTC",
          type: "withdraw",
          amount,
          txHash: txid,
          status: "pending",
        })
      );
  
      return res.json({ txid });
    } catch (err) {
      console.error("Withdraw error:", err.message);
      return res.status(500).json({ error: "Withdraw failed", details: err.message });
    }
  });

  app.get("/wallets/:traderId/history", async (req, res) => {
    const { traderId } = req.params;
  
    const transactions = await txRepo.find({
      where: { traderId },
      order: { id: "DESC" }, // последние сверху
    });
  
    res.json({ history: transactions });
  });

  app.get("/wallets/:traderId/balance", async (req, res) => {
    const { traderId } = req.params;
  
    const wallet = await walletRepo.findOneBy({ traderId, currency: "BTC" });
  
    if (!wallet) return res.status(404).json({ error: "Wallet not found" });
  
    res.json({
      traderId: wallet.traderId,
      currency: wallet.currency,
      balance: wallet.balance,
      frozen: wallet.frozen,
      address: wallet.address,
    });
  });


  app.get("/wallets/:traderId/address", async (req, res) => {
  const { traderId } = req.params;

  const wallet = await walletRepo.findOneBy({ traderId, currency: "BTC" });

  if (!wallet) {
    return res.status(404).json({ error: "Wallet not found" });
  }

  res.json({ address: wallet.address });
});


  app.listen(3000, () => console.log("Wallet service running on port 3000"));

});