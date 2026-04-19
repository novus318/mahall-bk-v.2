import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// Repayment history sub-document
const repaymentSchema = new Schema({
    amount: {
        type: Number,
        required: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    account: {
        type: Schema.Types.ObjectId,
        ref: 'Account',
        required: true
    },
    notes: {
        type: String
    },
    transaction: {
        type: Schema.Types.ObjectId,
        ref: 'AccountTransaction'
    }
}, { timestamps: true });

const payableSchema = new Schema({
    // Lender Information
    lenderName: {
        type: String,
        required: true
    },
    lenderContact: {
        type: String
    },
    lenderType: {
        type: String,
        enum: ['INDIVIDUAL', 'BANK', 'ORGANIZATION', 'OTHER'],
        default: 'INDIVIDUAL'
    },

    // Loan Details
    loanType: {
        type: String,
        enum: ['LOAN', 'CREDIT', 'ADVANCE', 'BORROWED'],
        default: 'LOAN'
    },
    amount: {
        type: Number,
        required: true
    },
    interestRate: {
        type: Number,
        default: 0
    },
    
    // Status Tracking
    totalRepaid: {
        type: Number,
        default: 0
    },
    balanceDue: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'PARTIALLY_REPAID', 'REPAID', 'OVERDUE', 'CANCELLED'],
        default: 'ACTIVE'
    },

    // Dates
    loanDate: {
        type: Date,
        default: Date.now
    },
    dueDate: {
        type: Date
    },

    // Account where loan was deposited
    account: {
        type: Schema.Types.ObjectId,
        ref: 'Account',
        required: true
    },

    // Repayment History
    repayments: [repaymentSchema],

    // Purpose/Notes
    purpose: {
        type: String
    },
    notes: {
        type: String
    },

    // Reference to the initial transaction
    initialTransaction: {
        type: Schema.Types.ObjectId,
        ref: 'AccountTransaction'
    },

    createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Index for dashboard stats queries
payableSchema.index({ status: 1 });

// Update status before saving
payableSchema.pre('save', async function() {
    if (this.balanceDue <= 0) {
        this.status = 'REPAID';
        this.balanceDue = 0;
    } else if (this.totalRepaid > 0) {
        this.status = 'PARTIALLY_REPAID';
    }

    // Check if overdue
    if (this.dueDate && this.dueDate < new Date() && this.balanceDue > 0) {
        this.status = 'OVERDUE';
    }
});

const Payable = model('Payable', payableSchema);

export default Payable;
