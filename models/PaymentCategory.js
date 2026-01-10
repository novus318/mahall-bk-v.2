import mongoose from 'mongoose';

const paymentCategorySchema = mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    description: {
        type: String
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'INACTIVE'],
        default: 'ACTIVE'
    }
}, {
    timestamps: true
});

const PaymentCategory = mongoose.model('PaymentCategory', paymentCategorySchema);

export default PaymentCategory;
