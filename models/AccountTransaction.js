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
    type: {
        type: String,
        enum: ['OPENING_BALANCE', 'TRANSFER_IN', 'TRANSFER_OUT', 'INCOME', 'EXPENSE'],
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

export default mongoose.model('AccountTransaction', accountTransactionSchema);
