import mongoose from 'mongoose';

const memberSchema = mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    customId: {
        type: String,
        required: true,
        unique: true,
        minLength: 8,
        maxLength: 8
    },
    gender: {
        type: String,
        enum: ['Male', 'Female', 'Other'],
        required: true
    },
    dateOfBirth: {
        type: Date,
        required: true
    },
    mobile: {
        type: String,
        required: true
    },
    whatsapp: {
        type: String
    },
    bloodGroup: {
        type: String,
        enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
        required: true
    },
    education: {
        type: String
    },
    madrassa: {
        type: String
    },
    maritalStatus: {
        type: String,
        enum: ['Single', 'Married', 'Divorced', 'Widowed']
    },
    occupation: {
        type: String
    },
    place: {
        type: String
    },
    idCards: {
        aadhaar: { type: Boolean, default: false },
        drivingLicense: { type: Boolean, default: false },
        voterId: { type: Boolean, default: false },
        panCard: { type: Boolean, default: false },
        healthCard: { type: Boolean, default: false }
    },
    house: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'House'
    },
    family: { // Denormalized for easier querying
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Family'
    },
    parents: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Member'
    }],
    spouse: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Member'
    },
    children: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Member'
    }],
    siblings: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Member'
    }],
    relationshipToHead: {
        type: String,
        enum: ['Head', 'Spouse', 'Husband', 'Wife', 'Son', 'Daughter', 'Grandson', 'Granddaughter', 'Brother', 'Sister', 'Son-in-law', 'Daughter-in-law', 'Father', 'Mother', 'Resident', 'Other'],
        default: 'Other'
    }
}, {
    timestamps: true
});

const Member = mongoose.model('Member', memberSchema);

export default Member;
