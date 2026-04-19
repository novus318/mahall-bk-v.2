import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const collectionDueSchema = new Schema({
    entityType: {
        type: String,
        enum: ['House', 'Member'],
        required: true
    },
    entityId: {
        type: Schema.Types.ObjectId,
        required: true,
        refPath: 'entityType'
    },
    period: {
        type: String,
        required: true
    }, // Format: "MM-YYYY" (Monthly) or "YYYY" (Yearly)
    frequency: { type: String, enum: ['Monthly', 'Yearly'] },
    amount: { type: Number, required: true },
    paidAmount: { type: Number, default: 0 },
    status: {
        type: String,
        enum: ['PENDING', 'PARTIAL', 'PAID', 'REJECTED'],
        default: 'PENDING'
    },
    transactions: [{
        date: { type: Date, default: Date.now },
        amount: { type: Number },
        receiptId: { type: Schema.Types.ObjectId, ref: 'CollectionReceipt' },
        notes: String
    }],
    rejectionOtp: { type: String },
    rejectionOtpExpires: { type: Date }
}, { timestamps: true });

// Index for uniqueness: One due per entity per period
collectionDueSchema.index({ entityId: 1, period: 1 }, { unique: true });
// Index for dashboard stats queries
collectionDueSchema.index({ entityType: 1, status: 1 });

export default model('CollectionDue', collectionDueSchema);
