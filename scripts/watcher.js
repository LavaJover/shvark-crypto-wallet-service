const axios = require("axios");
const dotenv = require("dotenv");
dotenv.config();
const { DataSource } = require("typeorm");
const walletEntity = require("../src/domain/wallet");

const WALLET_SERVICE_URL = process.env.WALLET_SERVICE_URL || "http://localhost:3000";
const MEMPOOL_API = "https://mempool.space/testnet/api";

// Инициализация подключения к БД
const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "5432"),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  synchronize: false,
  entities: [walletEntity],
});

const processedTxs = new Set();

async function checkDeposits() {
  const walletRepo = AppDataSource.getRepository("Wallet");
  const wallets = await walletRepo.findBy({ currency: "BTC" });

  for (const { traderId, address } of wallets) {
    try {
      const res = await axios.get(`${MEMPOOL_API}/address/${address}`);
      const txs = res.data.chain_stats.tx_count > 0
        ? await axios.get(`${MEMPOOL_API}/address/${address}/txs`)
        : { data: [] };

      for (const tx of txs.data) {
        if (tx.status.confirmed) {
          const txid = tx.txid;
          if (processedTxs.has(txid)) continue;

          const vout = tx.vout.find(v => v.scriptpubkey_address === address);
          if (!vout) continue;

          const amountBTC = vout.value / 1e8;

          console.log(`💸 Confirmed tx for ${traderId} at ${address}: ${amountBTC} BTC`);

          await axios.post(`${WALLET_SERVICE_URL}/wallets/deposit`, {
            traderId,
            amount: amountBTC,
            txHash: txid
          });

          processedTxs.add(txid);
        }
      }
    } catch (err) {
      console.error(`⚠️ Error checking address ${address}:`, err.message);
    }
  }
}

AppDataSource.initialize().then(() => {
  console.log("BTC watcher (mempool.space) started");
  setInterval(checkDeposits, 60 * 1000);
}).catch(err => {
  console.error("Failed to connect to DB:", err);
  process.exit(1);
});