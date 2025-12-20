import mongoose from 'mongoose';

const inventoryItemSchema = mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    totalQuantity: {
        type: Number,
        required: true,
        default: 0
    },
    availableQuantity: {
        type: Number,
        required: true,
        default: 0
    },
    averageValue: {
        type: Number, // Cost Price per unit (WAC)
        required: true,
        default: 0
    },
    rentalRate: {
        type: Number, // Rent price per unit
        required: true,
        default: 0
    },
    history: [{
        typ: { type: String, enum: ['RESTOCK', 'ADJUSTMENT', 'DAMAGE'] },
        quantity: Number,
        cost: Number, // Unit cost at that time
        date: { type: Date, default: Date.now }
    }]
}, {
    timestamps: true
});

export default mongoose.model('InventoryItem', inventoryItemSchema);
