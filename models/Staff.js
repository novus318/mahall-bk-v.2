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
