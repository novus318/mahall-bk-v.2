import mongoose from 'mongoose';

const accountTransactionSchema = new mongoose.Schema({
    account: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
        required: true
    },
    relatedAccount: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account' // For transfers
    },
    payment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Payment'
    },
    receipt: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Receipt'
    },
    collectionReceipt: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CollectionReceipt'
    },
    inventoryReceipt: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'InventoryReceipt'
    },
    staff: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Staff'
    },
    contract: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Contract'
    },
    payable: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Payable'
    },
    type: {
        type: String,
        enum: ['OPENING_BALANCE', 'TRANSFER_IN', 'TRANSFER_OUT', 'INCOME', 'EXPENSE', 'LOAN_RECEIVED', 'LOAN_REPAYMENT'],
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    balanceAfter: {
        type: Number,
        required: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    description: {
        type: String
    }
}, { timestamps: true });

// Indexes for optimized queries
accountTransactionSchema.index({ date: -1, type: 1 }); // For transaction stats with date range and type filtering
accountTransactionSchema.index({ date: -1 }); // For recent activity sorting

export default mongoose.model('AccountTransaction', accountTransactionSchema);
