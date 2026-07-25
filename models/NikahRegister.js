import mongoose from 'mongoose';

const nikahRegisterSchema = mongoose.Schema({
    registerNo: {
        type: String,
        unique: true
    },
    dateOfRegistration: {
        type: Date,
        default: Date.now
    },
    groomName: {
        type: String,
        required: true
    },
    groomFatherName: {
        type: String,
        required: true
    },
    groomAddress: {
        type: String
    },
    groomMahallId: {
        type: String
    },
    brideName: {
        type: String,
        required: true
    },
    brideFatherName: {
        type: String,
        required: true
    },
    brideAddress: {
        type: String
    },
    brideMahallId: {
        type: String
    },
    nikahDate: {
        type: Date,
        required: true
    },
    nikahTime: {
        type: String
    },
    nikahPlace: {
        type: String,
        required: true
    },
    mahrAmount: {
        type: String,
        required: true
    },
    brideGuardian: {
        type: String,
        required: true
    },
    witness1Name: {
        type: String,
        required: true
    },
    witness2Name: {
        type: String,
        required: true
    },
    qaziName: {
        type: String,
        required: true
    },
    remarks: {
        type: String
    }
}, {
    timestamps: true
});

const NikahRegister = mongoose.model('NikahRegister', nikahRegisterSchema);

export default NikahRegister;
