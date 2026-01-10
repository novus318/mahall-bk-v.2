import mongoose from 'mongoose';

const houseSchema = mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    customId: {
        type: String,
        required: true,
        unique: true,
        minLength: 6,
        maxLength: 6
    },
    address: {
        type: String
    },
    family: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Family'
    },
    head: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Member'
    },
    subscription: {
        frequency: {
            type: String,
            enum: ['Monthly', 'Yearly', 'None'],
            default: 'None'
        },
        amount: {
            type: Number,
            default: 0
        },
        startDate: { type: Date }
    }
}, {
    timestamps: true
});

const House = mongoose.model('House', houseSchema);

export default House;
