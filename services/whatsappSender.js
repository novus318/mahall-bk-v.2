import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = '1064786796718809';
const API_VERSION = 'v25.0';
const MESSAGES_URL = `https://graph.facebook.com/${API_VERSION}/${PHONE_ID}/messages`;

const headers = {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
};

// Replace {{key}} placeholders using the provided mapping (e.g. name, phone, type)
export const substitutePlaceholders = (text, variables = {}) => {
    if (!text) return '';
    return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, key) => {
        const val = variables[key ? key.trim() : ''];
        return val !== undefined && val !== null && val !== '' ? val : '';
    });
};

export const requireConfig = () => {
    if (!TOKEN) throw new Error('WHATSAPP_TOKEN not configured');
};

// Send a free-form text message via the WhatsApp Cloud API
export const sendTextMessage = async ({ to, body }) => {
    requireConfig();
    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body },
    };
    try {
        const { data } = await axios.post(MESSAGES_URL, payload, { headers });
        console.log(data);
        if (data?.messages?.[0]?.id) return data.messages[0].id;
        return null;
    } catch (error) {
        console.error('sendTextMessage failed:', extractErrorMessage(error));
        throw error;
    }
};

const extractErrorMessage = (error) =>
    error?.response?.data?.error?.message || error?.message || 'Unknown WhatsApp API error';

// Send an approved template message via the WhatsApp Cloud API
export const sendTemplateMessage = async ({ to, name, language = 'en', components }) => {
    requireConfig();
    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
            name,
            language: { code: language },
            ...(components ? { components } : {}),
},
    };
    try {
        const { data } = await axios.post(MESSAGES_URL, payload, { headers });
        if (data?.messages?.[0]?.id) return data.messages[0].id;
        return null;
    } catch (error) {
        console.error('sendTemplateMessage failed:', extractErrorMessage(error));
        throw error;
    }
};

// Send the "due_collection" template used for collections dues reminders.
// Returns the message id on success and throws on failure so callers can track it.
export const sendDueCollectionTemplate = async ({ to, name, frequencyLabel, customId, period, amount, dueId }) => {
    requireConfig();
    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
            name: 'due_collection',
            language: { code: 'ml' },
            components: [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: name },                 // {{1}}
                        { type: 'text', text: frequencyLabel },       // {{2}}
                        { type: 'text', text: customId || '' },       // {{3}}
                        { type: 'text', text: period },               // {{4}}
                        { type: 'text', text: String(amount) }        // {{5}}
                    ]
                },
                {
                    type: 'button',
                    sub_type: 'url',
                    index: '0',
                    parameters: [
                        { type: 'text', text: dueId } // Appends to the base URL configured in the template
                    ]
                }
            ]
        }
    };
    try {
        const { data } = await axios.post(MESSAGES_URL, payload, { headers });
        if (data?.messages?.[0]?.id) return data.messages[0].id;
        return null;
    } catch (error) {
        console.error('sendDueCollectionTemplate failed:', extractErrorMessage(error));
        throw error;
    }
};