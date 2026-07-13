import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const rentDueSchema = new Schema({
    contract: {
        type: Schema.Types.ObjectId,
        ref: 'Contract',
        required: true
    },
    monthYear: {
        type: String, // Format: "MM-YYYY" e.g., "12-2025"
        required: true
    },
    dueDate: {
        type: Date,
        default: Date.now
    },
    amount: {
        type: Number,
        required: true
    },
    collectedAmount: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['PENDING', 'PARTIAL', 'PAID'],
        default: 'PENDING'
    },
    paymentDate: { // Keep for backward compatibility/last payment
        type: Date
    },
    transactions: [{
        amount: { type: Number, required: true },
        date: { type: Date, default: Date.now },
        notes: String,
        receipt: { type: Schema.Types.ObjectId, ref: 'Receipt' }
    }],
    notes: {
        type: String
    }
}, {
    timestamps: true
});

// Prevent duplicate rent generation for same month/contract
rentDueSchema.index({ contract: 1, monthYear: 1 }, { unique: true });
// Index for dashboard stats queries
rentDueSchema.index({ status: 1 });

export default model('RentDue', rentDueSchema);
