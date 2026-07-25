import mongoose from 'mongoose';

const deathRegisterSchema = mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    gender: {
        type: String,
        enum: ['Male', 'Female']
    },
    mahallId: {
        type: String
    },
    age: {
        type: Number
    },
    address: {
        type: String
    },
    dateOfDeath: {
        type: Date,
        required: true
    },
    placeOfDeath: {
        type: String
    },
    causeOfDeath: {
        type: String
    },
    dateOfBurial: {
        type: Date
    },
    zone: {
        type: String
    },
    informerName: {
        type: String,
        required: true
    },
    informerPhone: {
        type: String
    }
}, {
    timestamps: true
});

const DeathRegister = mongoose.model('DeathRegister', deathRegisterSchema);

export default DeathRegister;
