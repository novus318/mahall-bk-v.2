import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const inventoryReceiptSchema = new Schema({
    receiptNo: {
        type: String,
        required: true,
        unique: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    amount: {
        type: Number,
        required: true
    },
    transactionId: {
        type: Schema.Types.ObjectId,
        ref: 'InventoryTransaction',
        required: true
    },
    account: {
        type: Schema.Types.ObjectId,
        ref: 'Account',
        required: true
    },
    payerName: {
        type: String,
        required: true
    },
    payerPhone: {
        type: String
    },
    mode: {
        type: String,
        default: 'CASH'
    },
    description: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, {
    timestamps: true
});

export default model('InventoryReceipt', inventoryReceiptSchema);
