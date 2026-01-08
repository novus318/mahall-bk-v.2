import mongoose from 'mongoose';

const whatsappMessageSchema = new mongoose.Schema({
    contact: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'WhatsAppContact',
        required: true
    },
    whatsappMessageId: {
        type: String,
        unique: true,
        sparse: true // sparse because outbound messages might not have ID immediately if we save before response
    },
    direction: {
        type: String,
        enum: ['INBOUND', 'OUTBOUND'],
        required: true
    },
    type: {
        type: String,
        enum: ['text', 'image', 'document', 'audio', 'video', 'sticker', 'unknown'],
        default: 'text'
    },
    body: {
        type: String
    },
    mediaUrl: {
        type: String
    },
    mediaId: {
        type: String
    },
    mimeType: {
        type: String
    },
    caption: {
        type: String
    },
    status: {
        type: String,
        enum: ['sent', 'delivered', 'read', 'failed', 'received'],
        default: 'sent'
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

const WhatsAppMessage = mongoose.model('WhatsAppMessage', whatsappMessageSchema);
export default WhatsAppMessage;
