const { EntitySchema } = require("typeorm");

module.exports = new EntitySchema({
  name: "Wallet",
  tableName: "wallets",
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
    address: {
      type: "varchar"
    },
    balance: {
      type: "float",
      default: 0
    },
    frozen: {
      type: "float",
      default: 0
    },
    created_at: {
      type: "timestamp",
      createDate: true
    },
    updated_at: {
      type: "timestamp",
      updateDate: true 
    }
  }
});
