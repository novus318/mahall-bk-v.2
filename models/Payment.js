import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const paymentSchema = new Schema({
    contract: {
        type: Schema.Types.ObjectId,
        ref: 'Contract',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        enum: ['RENT', 'DEPOSIT', 'FINE', 'REFUND', 'OTHER'],
        default: 'RENT'
    },
    paymentDate: {
        type: Date,
        default: Date.now
    },
    notes: {
        type: String
    }
}, {
    timestamps: true
});

export default model('Payment', paymentSchema);
