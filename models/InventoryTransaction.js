import mongoose from 'mongoose';

const { Schema } = mongoose;

const inventoryTransactionSchema = new Schema({
    itemId: {
        type: Schema.Types.ObjectId,
        ref: 'InventoryItem',
        required: true
    },
    typ: {
        type: String,
        enum: ['RENT_OUT', 'USE_INTERNAL', 'RETURN'], // RENT_OUT is for external customers, USE_INTERNAL for mahal use
        required: true
    },
    quantity: {
        type: Number,
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
        enum: ['ACTIVE', 'RETURNED'],
        default: 'ACTIVE'
    },
    issuedDate: {
        type: Date,
        default: Date.now
    },
    returnedDate: {
        type: Date
    },
    notes: String
}, {
    timestamps: true
});

const InventoryTransaction = mongoose.model('InventoryTransaction', inventoryTransactionSchema);

export default InventoryTransaction;
