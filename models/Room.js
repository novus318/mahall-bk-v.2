import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema({
    roomNumber: {
        type: String,
        required: true
    },
    building: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Building',
        required: true
    },
    status: {
        type: String,
        enum: ['VACANT', 'OCCUPIED', 'MAINTENANCE'],
        default: 'VACANT'
    },
    currentContract: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Contract'
    }
}, {
    timestamps: true
});

export default mongoose.model('Room', roomSchema);
