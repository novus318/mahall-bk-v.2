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
    },
    collectionSettings: {
        receiptPrefix: { type: String, default: 'MC-' }, // Mahall Collection
        receiptCurrentNumber: { type: Number, default: 1 },
        receiptSequenceLimit: { type: Number, default: 999 },
        // Automation Configuration
        automationEnabled: { type: Boolean, default: false },
        houseCronDay: { type: Number, default: 1 }, // Day of month (1-28)
        houseCronTime: { type: String, default: '10:00' }, // HH:mm (24-hour)
        memberCronDay: { type: Number, default: 1 },
        memberCronTime: { type: String, default: '10:00' }
    }
}, {
    timestamps: true
});

const SystemSettings = mongoose.model('SystemSettings', systemSettingsSchema);

export default SystemSettings;
