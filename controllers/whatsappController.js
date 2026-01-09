import WhatsAppContact from '../models/WhatsAppContact.js';
import WhatsAppMessage from '../models/WhatsAppMessage.js';
import Member from '../models/Member.js';
import Contract from '../models/Contract.js'; // For Tenants
import Staff from '../models/Staff.js';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

// Environment Variables
const TOKEN = process.env.WHATSAPP_TOKEN;
const API_URL = process.env.WHATSAPP_API_URL; // e.g., https://graph.facebook.com/v17.0/PHONE_ID/messages
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'my_test_token';

// Extract Graph API Base from API_URL or default
// If API_URL is https://graph.facebook.com/v17.0/123456/messages
// Base is https://graph.facebook.com/v17.0
const getGraphApiBase = () => {
    if (!API_URL) return 'https://graph.facebook.com/v17.0';
    const matches = API_URL.match(/(https:\/\/graph\.facebook\.com\/v\d+\.\d+)/);
    return matches ? matches[0] : 'https://graph.facebook.com/v17.0';
};

// Helper: Normalize Phone Number (Remove + or 91 prefix if needed for DB search)
// WhatsApp sends full number with country code (e.g. 919876543210). 
// Database might store 9876543210 or +919876543210.
// We will try exact match first, then partial match.
const findEntityByPhone = async (phoneNumber) => {
    // 1. Check MEMBER (using 'mobile')
    // Try exact match first
    let member = await Member.findOne({ mobile: phoneNumber });
    // If not found, try without 91 prefix (if 12 digits starting with 91)
    if (!member && phoneNumber.length === 12 && phoneNumber.startsWith('91')) {
        const shortPhone = phoneNumber.substring(2);
        member = await Member.findOne({ mobile: shortPhone });
    }

    if (member) return { type: 'MEMBER', model: 'Member', id: member._id, name: member.name };

    // 2. Check TENANT (Contract 'tenant.phone') where status is ACTIVE
    let contract = await Contract.findOne({ 'tenant.phone': phoneNumber, status: 'ACTIVE' });
    if (!contract && phoneNumber.length === 12 && phoneNumber.startsWith('91')) {
        const shortPhone = phoneNumber.substring(2);
        contract = await Contract.findOne({ 'tenant.phone': shortPhone, status: 'ACTIVE' });
    }

    if (contract) return { type: 'TENANT', model: 'Contract', id: contract._id, name: contract.tenant.name };

    // 3. Check STAFF (using 'phone')
    let staff = await Staff.findOne({ phone: phoneNumber, status: 'ACTIVE' });
    if (!staff && phoneNumber.length === 12 && phoneNumber.startsWith('91')) {
        const shortPhone = phoneNumber.substring(2);
        staff = await Staff.findOne({ phone: shortPhone, status: 'ACTIVE' });
    }

    if (staff) return { type: 'STAFF', model: 'Staff', id: staff._id, name: staff.name };

    return null;
};

// --- CONTROLLERS ---

// 1. Verify Webhook (GET)
export const verifyWebhook = (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400); // Bad Request if params missing
    }
};

// 2. Receive Webhook (POST)
export const receiveWebhook = async (req, res) => {
    try {
        const body = req.body;
        console.log('Incoming Webhook Body:', JSON.stringify(body, null, 2));

        // Check if this is an event from WhatsApp Cloud API
        if (body.object) {
            if (
                body.entry &&
                body.entry[0].changes &&
                body.entry[0].changes[0] &&
                body.entry[0].changes[0].value.messages &&
                body.entry[0].changes[0].value.messages[0]
            ) {
                const change = body.entry[0].changes[0].value;
                const message = change.messages[0];
                const contactInfo = change.contacts ? change.contacts[0] : null; // Profile name source

                const from = message.from; // Phone number (e.g., 919876543210)
                const msgId = message.id;
                const msgType = message.type;
                let msgBody = '';
                let mediaId = null;
                let mimeType = null;

                // Handle Message Types
                if (msgType === 'text') {
                    msgBody = message.text.body;
                } else if (msgType === 'image') {
                    msgBody = message.image.caption || 'Image';
                    mediaId = message.image.id;
                    mimeType = message.image.mime_type;
                } else if (msgType === 'document') {
                    msgBody = message.document.caption || message.document.filename || 'Document';
                    mediaId = message.document.id;
                    mimeType = message.document.mime_type;
                } else if (msgType === 'audio') {
                    mediaId = message.audio.id;
                    mimeType = message.audio.mime_type;
                    msgBody = 'Audio Message';
                } else if (msgType === 'video') {
                    mediaId = message.video.id;
                    mimeType = message.video.mime_type;
                    msgBody = message.video.caption || 'Video Message';
                } else if (msgType === 'sticker') {
                    mediaId = message.sticker.id;
                    mimeType = message.sticker.mime_type;
                    msgBody = 'Sticker';
                } else if (msgType === 'location') {
                    const loc = message.location;
                    msgBody = `Location: ${loc.name || ''} ${loc.address || ''}\nhttps://maps.google.com/?q=${loc.latitude},${loc.longitude}`;
                } else if (msgType === 'contacts') {
                    const contacts = message.contacts;
                    msgBody = 'Contact: ' + contacts.map(c => `${c.name.formatted_name} (${c.phones[0].phone})`).join(', ');
                } else if (msgType === 'reaction') {
                    msgBody = `Reacted ${message.reaction.emoji} to message ${message.reaction.message_id}`;
                } else {
                    msgBody = `[${msgType.toUpperCase()}]`;
                }

                // 2.1 Find or Create Contact
                let contact = await WhatsAppContact.findOne({ phoneNumber: from });

                if (!contact) {
                    const entity = await findEntityByPhone(from);

                    contact = new WhatsAppContact({
                        phoneNumber: from,
                        profileName: contactInfo ? contactInfo.profile.name : 'Unknown',
                        displayName: entity ? entity.name : (contactInfo ? contactInfo.profile.name : from),
                        type: entity ? entity.type : 'UNKNOWN',
                        linkedEntityId: entity ? entity.id : undefined,
                        linkedEntityModel: entity ? entity.model : undefined,
                    });
                } else {
                    if (contactInfo && contactInfo.profile.name) {
                        contact.profileName = contactInfo.profile.name;
                    }
                    if (contact.type === 'UNKNOWN') {
                        const entity = await findEntityByPhone(from);
                        if (entity) {
                            contact.type = entity.type;
                            contact.linkedEntityId = entity.id;
                            contact.linkedEntityModel = entity.model;
                            contact.displayName = entity.name;
                        }
                    }
                }

                // Update Last Message
                contact.lastMessage = msgBody.substring(0, 100);
                contact.lastMessageAt = new Date();
                contact.unreadCount += 1;
                await contact.save();

                // 2.2 Save Message
                const existingMsg = await WhatsAppMessage.findOne({ whatsappMessageId: msgId });
                if (!existingMsg) {
                    await WhatsAppMessage.create({
                        contact: contact._id,
                        whatsappMessageId: msgId,
                        direction: 'INBOUND',
                        type: msgType,
                        body: msgBody,
                        mediaId: mediaId,
                        mimeType: mimeType,
                        status: 'received',
                        timestamp: new Date(message.timestamp * 1000)
                    });
                }
            } else if (
                body.entry && body.entry[0].changes && body.entry[0].changes[0].value.statuses
            ) {
                const statuses = body.entry[0].changes[0].value.statuses;
                for (const status of statuses) {
                    await WhatsAppMessage.findOneAndUpdate(
                        { whatsappMessageId: status.id },
                        { status: status.status }
                    );
                }
            }
            res.sendStatus(200);
        } else {
            res.sendStatus(404);
        }
    } catch (error) {
        console.error('Webhook Error:', error);
        res.sendStatus(500);
    }
};

// 3. Send Message (POST)
export const sendMessage = async (req, res) => {
    try {
        const { contactId, messageType, content, caption } = req.body;
        // contactId is DB _id of WhatsAppContact

        const contact = await WhatsAppContact.findById(contactId);
        if (!contact) return res.status(404).json({ message: 'Contact not found' });

        if (!TOKEN) return res.status(500).json({ message: 'WhatsApp Token not configured' });

        // Construct Payload
        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: contact.phoneNumber,
            type: messageType || 'text',
        };

        if (messageType === 'text') {
            payload.text = { body: content }; // content is text string
        } else if (messageType === 'image') {
            payload.image = { link: content, caption: caption }; // content is URL
        }

        // Send to WhatsApp API
        const response = await axios.post(API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        const waMsgId = response.data.messages[0].id;

        // Save to DB
        const newMessage = await WhatsAppMessage.create({
            contact: contact._id,
            whatsappMessageId: waMsgId,
            direction: 'OUTBOUND',
            type: messageType || 'text',
            body: messageType === 'text' ? content : (caption || 'Media'),
            mediaUrl: messageType !== 'text' ? content : undefined,
            status: 'sent',
            timestamp: new Date()
        });

        // Update Contact Last Message (No unread count for outbound)
        contact.lastMessage = `You: ${messageType === 'text' ? content.substring(0, 50) : 'Sent Media'}`;
        contact.lastMessageAt = new Date();
        await contact.save();

        res.status(200).json({ success: true, data: newMessage });

    } catch (error) {
        console.error('Send Message Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ message: 'Failed to send message', error: error.message });
    }
};

// 4. Get Contacts (List)
export const getContacts = async (req, res) => {
    try {
        const { search } = req.query;
        let query = {};
        if (search) {
            query = {
                $or: [
                    { displayName: { $regex: search, $options: 'i' } },
                    { phoneNumber: { $regex: search, $options: 'i' } }
                ]
            };
        }

        const contacts = await WhatsAppContact.find(query)
            .sort({ lastMessageAt: -1 }) // Most recent first
            .limit(50); // Pagination later if needed

        res.status(200).json({ success: true, data: contacts });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 5. Get Messages (History)
export const getMessages = async (req, res) => {
    try {
        const { contactId } = req.params;
        const messages = await WhatsAppMessage.find({ contact: contactId })
            .sort({ timestamp: 1 }); // Oldest first (chat order)

        // Reset unread count when messages are fetched (Opened)
        await WhatsAppContact.findByIdAndUpdate(contactId, { unreadCount: 0 });

        res.status(200).json({ success: true, data: messages });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 6. Force Refresh Entity Link (Manual)
export const refreshLink = async (req, res) => {
    try {
        const { contactId } = req.params;
        const contact = await WhatsAppContact.findById(contactId);
        if (!contact) return res.status(404).json({ message: 'Contact not found' });

        const entity = await findEntityByPhone(contact.phoneNumber);
        if (entity) {
            contact.type = entity.type;
            contact.linkedEntityId = entity.id;
            contact.linkedEntityModel = entity.model;
            contact.displayName = entity.name;
            await contact.save();
            return res.status(200).json({ success: true, message: 'Linked successfully', data: contact });
        } else {
            return res.status(200).json({ success: false, message: 'No matching entity found' });
        }

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

// 7. Get Media Proxy (GET)
// Fetches media from WhatsApp API and streams it to client
export const getMedia = async (req, res) => {
    try {
        const { mediaId } = req.params;
        if (!mediaId) return res.status(400).send('Media ID required');

        const baseUrl = getGraphApiBase();

        // Step 1: Get Media URL
        const urlRes = await axios.get(`${baseUrl}/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });

        const mediaUrl = urlRes.data.url;
        const mimeType = urlRes.data.mime_type;

        // Step 2: Download Media Stream
        const response = await axios({
            url: mediaUrl,
            method: 'GET',
            responseType: 'stream',
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });

        // Set Headers
        res.setHeader('Content-Type', mimeType);
        // Optional: Cache Control
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year (media IDs change but content is static usually)

        // Stream to client
        response.data.pipe(res);

    } catch (error) {
        console.error('Media Proxy Error:', error.message);
        res.status(500).send('Failed to fetch media');
    }
};
