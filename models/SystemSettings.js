import mongoose from 'mongoose';

const systemSettingsSchema = mongoose.Schema({
    alertContacts: [{
        name: { type: String, required: true },
        number: { type: String, required: true }
    }],
    paymentSettings: {
        receiptPrefix: { type: String, default: 'PA-' },
        receiptCurrentNumber: { type: Number, default: 1 },
        receiptSequenceLimit: { type: Number, default: 999 }
    },
    incomeSettings: {
        receiptPrefix: { type: String, default: 'RC-' },
        receiptCurrentNumber: { type: Number, default: 1 },
        receiptSequenceLimit: { type: Number, default: 999 }
    }
}, {
    timestamps: true
});

const SystemSettings = mongoose.model('SystemSettings', systemSettingsSchema);

export default SystemSettings;
