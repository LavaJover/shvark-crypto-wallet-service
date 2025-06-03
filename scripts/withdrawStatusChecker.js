const axios = require("axios");
const { DataSource } = require("typeorm");
const dotenv = require("dotenv");
dotenv.config();

const transactionEntity = require("../src/domain/wallet_transaction");

const MEMPOOL_API = "https://mempool.space/testnet/api";

const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "5432"),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  synchronize: false,
  entities: [transactionEntity],
});

async function checkWithdrawStatuses() {
  const txRepo = AppDataSource.getRepository("WalletTransaction");
  const pendingTxs = await txRepo.find({
    where: { type: "withdraw", status: "pending" }
  });

  for (const tx of pendingTxs) {
    try {
      const res = await axios.get(`${MEMPOOL_API}/tx/${tx.txHash}`);
      const confirmed = res.data.status?.confirmed;

      if (confirmed) {
        tx.status = "confirmed";
        await txRepo.save(tx);
        console.log(`✅ Withdraw ${tx.txHash} confirmed`);
      } else {
        console.log(`⏳ Withdraw ${tx.txHash} still pending`);
      }
    } catch (err) {
      console.error(`❌ Error checking ${tx.txHash}:`, err.message);
    }
  }
}

AppDataSource.initialize().then(() => {
  console.log("🚀 Withdraw status checker started");
  setInterval(checkWithdrawStatuses, 60 * 1000);
});