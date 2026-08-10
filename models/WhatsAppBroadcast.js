import mongoose from 'mongoose';

const recipientResultSchema = new mongoose.Schema({
    phoneNumber: {
        type: String,
        required: true
    },
    name: String,
    entityType: {
        type: String,
        enum: ['MEMBER', 'TENANT', 'STAFF', 'UNKNOWN']
    },
    linkedEntityId: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'linkedEntityModel'
    },
    linkedEntityModel: String,
    status: {
        type: String,
        enum: ['PENDING', 'SENT', 'delivered', 'read', 'FAILED'],
        default: 'PENDING'
    },
    whatsappMessageId: String,
    error: String,
    sentAt: Date
});

const audienceSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['MEMBER', 'TENANT', 'STAFF', 'ALL', 'CUSTOM'],
        default: 'ALL'
    },
    customContacts: {
        type: [String],
        default: []
    }
}, { _id: false });

const whatsappBroadcastSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    // When sending an approved Cloud API template, store its send config
    messageTemplate: {
        name: String,
        language: { type: String, default: 'en' },
        parameterFormat: { type: String, enum: ['positional', 'named'], default: 'positional' },
        // Parameter values. positional -> array of strings (in placeholder order);
        // named -> object keyed by param name. Values may contain {{var}} placeholders.
        values: { type: mongoose.Schema.Types.Mixed, default: [] },
        // Header override for templates with a media header. format matches the cloud
        // template header (IMAGE | VIDEO | DOCUMENT | TEXT); media is the link/handle
        // sent at send time (required for media headers).
        header: {
            format: String,
            media: String
        }
    },
    // Message captured at run time; variables per-recipient are substituted on send
    // Required only when not using an approved template
    message: {
        type: String,
        default: '',
        required: function () {
            return !this.messageTemplate || !this.messageTemplate.name;
        }
    },
    audience: {
        type: audienceSchema,
        default: () => ({ type: 'ALL', customContacts: [] })
    },
    status: {
        type: String,
        enum: ['DRAFT', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED'],
        default: 'DRAFT'
    },
    recipients: [recipientResultSchema],
    stats: {
        total: { type: Number, default: 0 },
        sent: { type: Number, default: 0 },
        delivered: { type: Number, default: 0 },
        read: { type: Number, default: 0 },
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

const WhatsAppBroadcast = mongoose.model('WhatsAppBroadcast', whatsappBroadcastSchema);
export default WhatsAppBroadcast;