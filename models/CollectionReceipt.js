import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const collectionReceiptSchema = new Schema({
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
    dueId: {
        type: Schema.Types.ObjectId,
        ref: 'CollectionDue',
        required: true
    },
    account: {
        type: Schema.Types.ObjectId,
        ref: 'Account',
        required: true
    },
    payer: {
        name: String,
        entityType: { type: String, enum: ['House', 'Member'] },
        entityId: { type: Schema.Types.ObjectId, refPath: 'payer.entityType' }
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

export default model('CollectionReceipt', collectionReceiptSchema);
