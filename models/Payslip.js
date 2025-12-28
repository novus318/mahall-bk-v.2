import mongoose from 'mongoose';

const payslipSchema = new mongoose.Schema({
    staff: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Staff',
        required: true
    },
    monthYear: {
        type: String, // Format: "MM-YYYY"
        required: true
    },
    baseSalary: {
        type: Number,
        required: true
    },
    leaveDays: {
        type: Number,
        default: 0,
        min: 0
    },
    leaveDeduction: {
        type: Number,
        default: 0,
        min: 0
    },
    advanceDeduction: {
        type: Number,
        default: 0,
        min: 0
    },
    finalAmount: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['PENDING', 'PAID'],
        default: 'PENDING'
    },
    paymentDate: {
        type: Date
    },
    generatedDate: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Ensure one payslip per month per staff
payslipSchema.index({ staff: 1, monthYear: 1 }, { unique: true });

const Payslip = mongoose.model('Payslip', payslipSchema);
export default Payslip;
