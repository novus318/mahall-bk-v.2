import mongoose from 'mongoose';

const accountSchema = mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['BANK', 'CASH'],
        required: true
    },
    accountNumber: {
        type: String,
        required: function () { return this.type === 'BANK'; }
    },
    holderName: {
        type: String,
        required: true
    },
    bankName: {
        type: String,
        required: function () { return this.type === 'BANK'; }
    },
    balance: {
        type: Number,
        required: true,
        default: 0
    },
    openingBalance: {
        type: Number,
        required: true,
        default: 0
    },
    isPrimary: {
        type: Boolean,
        default: false
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'INACTIVE'],
        default: 'ACTIVE'
    }
}, {
    timestamps: true
});

const Account = mongoose.model('Account', accountSchema);

export default Account;
