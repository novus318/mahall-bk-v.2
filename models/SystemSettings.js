import mongoose from 'mongoose';

const systemSettingsSchema = mongoose.Schema({
    alertContacts: [{
        name: { type: String, required: true },
        number: { type: String, required: true }
    }]
}, {
    timestamps: true
});

const SystemSettings = mongoose.model('SystemSettings', systemSettingsSchema);

export default SystemSettings;
