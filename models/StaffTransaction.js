import mongoose from 'mongoose';

const staffTransactionSchema = new mongoose.Schema({
    staff: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Staff',
        required: true
    },
    type: {
        type: String,
        enum: ['ADVANCE_GIVEN', 'ADVANCE_REPAID', 'SALARY_PAYMENT'],
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    date: {
        type: Date,
        default: Date.now
    },
    notes: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

const StaffTransaction = mongoose.model('StaffTransaction', staffTransactionSchema);
export default StaffTransaction;
