import mongoose from 'mongoose';

const buildingSchema = new mongoose.Schema({
    buildingId: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    name: {
        type: String,
        required: true
    },
    place: {
        type: String,
        required: true
    }
}, {
    timestamps: true
});

// Virtual populate for rooms
buildingSchema.virtual('rooms', {
    ref: 'Room',
    localField: '_id',
    foreignField: 'building'
});

buildingSchema.set('toObject', { virtuals: true });
buildingSchema.set('toJSON', { virtuals: true });

export default mongoose.model('Building', buildingSchema);
