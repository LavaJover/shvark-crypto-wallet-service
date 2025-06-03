const { EntitySchema } = require("typeorm");

module.exports = new EntitySchema({
  name: "TraderWalletIndex",
  tableName: "trader_wallet_index",
  columns: {
    hdIndex: {
      primary: true,
      type: "int",
      generated: "increment"
    },
    traderId: {
      type: "varchar",
      unique: true
    }
  }
});
