import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const paymentSchema = new Schema({
    contract: {
        type: Schema.Types.ObjectId,
        ref: 'Contract'
        // required: true -> Removed to allow general expenses
    },
    // Common
    amount: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        enum: ['RENT', 'DEPOSIT', 'FINE', 'REFUND', 'OTHER', 'EXPENSE'],
        default: 'RENT'
    },
    status: {
        type: String,
        enum: ['PENDING', 'COMPLETED', 'DELETED'],
        default: 'PENDING'
    },
    deletedAt: {
        type: Date,
        default: null
    },
    date: { // Unified date field (Expenses use this)
        type: Date,
        default: Date.now
    },
    paymentDate: { // Legacy/Contract date field (Keep for backward compatibility)
        type: Date,
        default: Date.now
    },
    paidAt: { // When the payment was actually made
        type: Date,
        default: null
    },
    description: { type: String }, // Notes/Description
    notes: { type: String }, // Legacy notes

    // Expense Specific
    receiptNo: {
        type: String,
        sparse: true, // Allow multiple nulls
        unique: true
    },
    account: { type: Schema.Types.ObjectId, ref: 'Account' },
    category: { type: Schema.Types.ObjectId, ref: 'PaymentCategory' },
    payee: { type: String },
    payeeContact: { type: String }, // Optional Contact Number
    items: [{
        description: { type: String },
        amount: { type: Number }
    }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, {
    timestamps: true
});

// Index for dashboard stats queries
paymentSchema.index({ status: 1 });

export default model('Payment', paymentSchema);
