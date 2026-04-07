import mongoose from 'mongoose';

const marriageCertificateSchema = mongoose.Schema({
    certificateNo: {
        type: String,
        required: true,
        unique: true
    },
    refNo: {
        type: String,
        required: true
    },
    groomName: {
        type: String,
        required: true
    },
    groomFatherName: {
        type: String,
        required: true
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
    brideMahallId: {
        type: String
    },
    nikahDate: {
        type: Date,
        required: true
    },
    nikahPlace: {
        type: String,
        required: true
    },
    mahr: {
        type: String,
        required: true
    },
    witness1: {
        type: String,
        required: true
    },
    witness2: {
        type: String,
        required: true
    },
    qaziName: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['Approved', 'Rejected'],
        default: 'Approved'
    }
}, {
    timestamps: true
});

const MarriageCertificate = mongoose.model('MarriageCertificate', marriageCertificateSchema);

export default MarriageCertificate;
