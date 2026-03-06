import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const contractSchema = new Schema({
    rooms: [{
        type: Schema.Types.ObjectId,
        ref: 'Room',
        required: true
    }],
    tenant: {
        name: { type: String, required: true },
        adhaar: { type: String, required: true },
        place: { type: String, required: true },
        phone: { type: String, required: true },
        shopName: String
    },
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    },
    rentAmount: {
        type: Number,
        required: true
    },
    depositAmount: {
        type: Number,
        required: true
    },
    depositCollected: {
        type: Number,
        default: 0
    },
    depositReturned: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'EXPIRED', 'TERMINATED'],
        default: 'ACTIVE'
    }
}, {
    timestamps: true
});

export default model('Contract', contractSchema);
