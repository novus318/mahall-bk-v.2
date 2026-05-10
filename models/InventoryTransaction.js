import mongoose from 'mongoose';

const { Schema } = mongoose;

const inventoryTransactionSchema = new Schema({
    items: [{
        itemId: {
            type: Schema.Types.ObjectId,
            ref: 'InventoryItem',
            required: true
        },
        quantity: {
            type: Number,
            required: true
        },
        rentPerUnit: {
            type: Number,
            default: 0
        },
        amount: {
            type: Number,
            default: 0
        },
        returnedQuantity: {
            type: Number,
            default: 0
        }
    }],
    typ: {
        type: String,
        enum: ['RENT_OUT', 'USE_INTERNAL', 'RETURN'], // RENT_OUT is for external customers, USE_INTERNAL for mahal use
        required: true
    },
    customerName: {
        type: String,
        required: function () { return this.typ === 'RENT_OUT'; }
    },
    customerPhone: {
        type: String
    },
    totalRentAmount: {
        type: Number,
        default: 0
    },
    paidAmount: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'PARTIAL_RETURNED', 'RETURNED'],
        default: 'ACTIVE'
    },
    issuedDate: {
        type: Date,
        default: Date.now
    },
    returnedDate: {
        type: Date
    },
    payments: [{
        amount: { type: Number, required: true },
        date: { type: Date, default: Date.now },
        accountId: { type: Schema.Types.ObjectId, ref: 'Account' }
    }],
    receiptId: {
        type: Schema.Types.ObjectId,
        ref: 'InventoryReceipt'
    },
    notes: String
}, {
    timestamps: true
});

const InventoryTransaction = mongoose.model('InventoryTransaction', inventoryTransactionSchema);

export default InventoryTransaction;
