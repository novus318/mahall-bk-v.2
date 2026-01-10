import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const receiptSchema = new Schema({
    // Common
    amount: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        enum: ['INCOME', 'COLLECTION'],
        default: 'INCOME'
    },
    date: {
        type: Date,
        default: Date.now
    },
    description: { type: String }, // Notes/Description
    receiptNo: {
        type: String,
        required: true,
        unique: true
    },
    account: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    category: { type: Schema.Types.ObjectId, ref: 'ReceiptCategory' },
    payer: { type: String, required: true }, // "Received From"
    payerContact: { type: String }, // Optional Contact Number
    items: [{
        description: { type: String },
        amount: { type: Number }
    }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, {
    timestamps: true
});

export default model('Receipt', receiptSchema);
