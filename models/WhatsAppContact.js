import mongoose from 'mongoose';

const whatsappContactSchema = new mongoose.Schema({
    phoneNumber: {
        type: String, // E.164 format (e.g., 919876543210)
        required: true,
        unique: true
    },
    profileName: {
        type: String
    },
    displayName: { // Name used in the system (e.g., "John Doe (Member)")
        type: String
    },
    type: {
        type: String,
        enum: ['MEMBER', 'TENANT', 'STAFF', 'VENDOR', 'UNKNOWN'],
        default: 'UNKNOWN'
    },
    // Dynamic Linking to other collections
    linkedEntityId: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'linkedEntityModel'
    },
    linkedEntityModel: {
        type: String,
        enum: ['Member', 'Contract', 'Staff', 'Vendor']
    },
    lastMessage: {
        type: String
    },
    lastMessageAt: {
        type: Date,
        default: Date.now
    },
    unreadCount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

const WhatsAppContact = mongoose.model('WhatsAppContact', whatsappContactSchema);
export default WhatsAppContact;
