import mongoose from 'mongoose';

const staffSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    dob: {
        type: Date,
        required: true
    },
    employeeId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        uppercase: true
    },
    department: {
        type: String,
        required: true,
        trim: true
    },
    position: {
        type: String,
        required: true,
        trim: true
    },
    baseSalary: {
        type: Number,
        required: true,
        min: 0
    },
    phone: {
        type: String,
        required: true
    },
    email: {
        type: String,
        trim: true
    },
    address: {
        street: { type: String, trim: true },
        city: { type: String, trim: true },
        state: { type: String, trim: true },
        pincode: { type: String, trim: true },
        fullAddress: { type: String, trim: true }
    },
    emergencyContact: {
        name: { type: String, trim: true },
        relationship: { type: String, trim: true },
        phone: { type: String, trim: true },
        alternatePhone: { type: String, trim: true }
    },
    qualifications: {
        type: String,
        trim: true
    },
    religiousQualifications: {
        type: String,
        trim: true
    },
    aadhaarNumber: {
        type: String,
        trim: true
    },
    bankAccount: {
        accountNumber: { type: String, trim: true },
        ifscCode: { type: String, trim: true, uppercase: true },
        bankName: { type: String, trim: true },
        branchName: { type: String, trim: true },
        accountHolderName: { type: String, trim: true }
    },
    otherAllowance: {
        type: Number,
        default: 0,
        min: 0
    },
    jobDescription: {
        type: String,
        trim: true
    },
    additionalInfo: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'INACTIVE'],
        default: 'ACTIVE'
    },
    joinDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    currentAdvance: {
        type: Number,
        default: 0,
        min: 0
    }
}, {
    timestamps: true
});

const Staff = mongoose.model('Staff', staffSchema);
export default Staff;
