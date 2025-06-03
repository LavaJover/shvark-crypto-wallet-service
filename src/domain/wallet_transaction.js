const { EntitySchema } = require("typeorm");

module.exports = new EntitySchema({
  name: "WalletTransaction",
  tableName: "wallet_transactions",
  columns: {
    id: {
      primary: true,
      type: "uuid",
      generated: "uuid"
    },
    traderId: {
      type: "varchar"
    },
    currency: {
      type: "varchar"
    },
    type: {
      type: "varchar"
    },
    amount: {
      type: "float"
    },
    orderId: {
      type: "varchar",
      nullable: true
    },
    txHash: {
      type: "varchar",
      nullable: true
    },
    status: {
      type: "varchar",
      default: "confirmed"
    },
    metadata: {
      type: "jsonb",
      nullable: true
    }
  }
});
