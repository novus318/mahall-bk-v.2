import mongoose from 'mongoose';

const reminderRecipientSchema = new mongoose.Schema({
    phoneNumber: {
        type: String,
        required: true
    },
    name: String,
    entityType: {
        type: String,
        enum: ['House', 'Member']
    },
    entityId: mongoose.Schema.Types.ObjectId,
    linkedEntityModel: String,
    dueId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CollectionDue'
    },
    period: String,
    amount: Number,
    customId: String,
    frequency: {
        type: String,
        enum: ['Monthly', 'Yearly'],
        default: 'Monthly'
    },
    status: {
        type: String,
        enum: ['PENDING', 'SENT', 'FAILED'],
        default: 'PENDING'
    },
    whatsappMessageId: String,
    error: String,
    sentAt: Date
}, { _id: false });

const whatsappReminderSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    kind: {
        type: String,
        enum: ['DUE', 'ARREARS'],
        default: 'DUE'
    },
    entityType: {
        type: String,
        enum: ['House', 'Member', 'All'],
        default: 'All'
    },
    period: String,
    frequency: {
        type: String,
        enum: ['Monthly', 'Yearly'],
        default: 'Monthly'
    },
    status: {
        type: String,
        enum: ['DRAFT', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED'],
        default: 'DRAFT'
    },
    recipients: [reminderRecipientSchema],
    stats: {
        total: { type: Number, default: 0 },
        sent: { type: Number, default: 0 },
        failed: { type: Number, default: 0 }
    },
    startedAt: Date,
    completedAt: Date,
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

const WhatsAppReminder = mongoose.model('WhatsAppReminder', whatsappReminderSchema);
export default WhatsAppReminder;