import mongoose from 'mongoose';

const familySchema = mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    customId: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        minLength: 3,
        maxLength: 3
    },
    description: {
        type: String
    },
}, {
    timestamps: true
});

const Family = mongoose.model('Family', familySchema);

export default Family;
