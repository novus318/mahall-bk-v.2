import Member from '../models/Member.js';
import Contract from '../models/Contract.js';
import Staff from '../models/Staff.js';
import WhatsAppBroadcast from '../models/WhatsAppBroadcast.js';
import { substitutePlaceholders, sendTextMessage, sendTemplateMessage } from './whatsappSender.js';
import dotenv from 'dotenv';
dotenv.config();

const sleep = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

const normalizePhone = (phone) => {
    if (!phone) return null;
    let p = String(phone).replace(/[^0-9]/g, '');
    // Bare local/trunk numbers (10 digits) default to India (+91) for backward compat
    if (p.length === 10 && !p.startsWith('0')) p = '91' + p;
    // Otherwise treat as already in E.164: a leading country code + national number
    if (!/^[1-9]\d{7,14}$/.test(p)) return null;
    return p;
};

// Resolve audience members from core entities directly (works even if a contact
// hasn't received a message yet / isn't in WhatsAppContact).
const resolveEntitiesToAudience = async (audienceType) => {
    const out = [];

    if (audienceType === 'MEMBER' || audienceType === 'ALL') {
        const members = await Member.find();
        for (const m of members) {
            const phone = normalizePhone(m.whatsapp || m.mobile);
            if (!phone) continue;
            out.push({ phoneNumber: phone, name: m.name, entityType: 'MEMBER', linkedEntityId: m._id, linkedEntityModel: 'Member' });
        }
    }

    if (audienceType === 'TENANT' || audienceType === 'ALL') {
        const contracts = await Contract.find({ status: 'ACTIVE' });
        for (const c of contracts) {
            const phone = normalizePhone(c.tenant.phone);
            if (!phone) continue;
            out.push({ phoneNumber: phone, name: c.tenant.name || 'Tenant', entityType: 'TENANT', linkedEntityId: c._id, linkedEntityModel: 'Contract' });
        }
    }

    if (audienceType === 'STAFF' || audienceType === 'ALL') {
        const staffs = await Staff.find({ status: 'ACTIVE' });
        for (const s of staffs) {
            const phone = normalizePhone(s.phone);
            if (!phone) continue;
            out.push({ phoneNumber: phone, name: s.name, entityType: 'STAFF', linkedEntityId: s._id, linkedEntityModel: 'Staff' });
        }
    }

    const seen = new Set();
    return out.filter(r => {
        if (seen.has(r.phoneNumber)) return false;
        seen.add(r.phoneNumber);
        return true;
    });
};

const resolveAudience = async (audience, customContacts = []) => {
    if (audience === 'CUSTOM') {
        return (customContacts || [])
            .filter(p => p)
            .map(p => ({ phoneNumber: normalizePhone(p), name: 'Contact', entityType: 'UNKNOWN' }))
            .filter(r => r.phoneNumber);
    }
    return resolveEntitiesToAudience(audience);
};

// Estimate recipient count + preview (without executing).
export const previewBroadcast = async (audienceType, customContacts = []) => {
    const targets = await resolveAudience(audienceType, customContacts);
    let excluded = 0;
    if (audienceType === 'MEMBER' || audienceType === 'ALL') {
        const members = await Member.find();
        excluded = members.length - new Set(targets.map(r => String(r.linkedEntityId))).size;
    }
    return { total: targets.length, recipients: targets.slice(0, 20), excluded };
};

// Resolve the full recipient list (used for export).
export const resolveAllRecipients = async (audienceType, customContacts = []) => {
    return resolveAudience(audienceType, customContacts);
};

// Member phone audit: every excluded member (invalid/missing phone) so numbers can be corrected.
export const auditMemberPhones = async () => {
    const members = await Member.find().populate('house', 'name').lean();
    return members
        .map(m => {
            const mobile = m.mobile ? String(m.mobile).trim() : '';
            const whatsapp = m.whatsapp ? String(m.whatsapp).trim() : '';
            const raw = whatsapp || mobile;
            const normalized = normalizePhone(raw);

            let reason = '';
            if (!raw) reason = 'No phone number';
            else if (normalized) return null;
            else if (mobile && whatsapp && mobile !== whatsapp) reason = 'Invalid (mobile & WhatsApp both unusable)';
            else reason = `Invalid: "${raw}"`;

            return {
                name: m.name || '',
                customId: m.customId || '',
                mobile,
                whatsapp,
                house: m.house?.name || '',
                status: m.status || '',
                gender: m.gender || '',
                phoneNumber: normalized || '',
                reason,
            };
        })
        .filter(Boolean);
};

// Resolve a message body (used for plain-text broadcasts or preview). Replaces {{var}}
// using defaults from the first recipient.
export const resolveBody = (message, sample) => {
    if (!message) return '';
    return substitutePlaceholders(message, {
        name: sample?.name || '', phone: sample?.phoneNumber || '', type: sample?.entityType || '',
    });
};

// Execute a broadcast. Each recipient is personalized ({{name}}, {{phone}}, {{type}}),
// then sent either as a free-form text message or an approved Cloud API template.
export const executeBroadcast = async (broadcastId) => {
    const broadcast = await WhatsAppBroadcast.findById(broadcastId);
    if (!broadcast) throw new Error('Broadcast not found');
    if (broadcast.status === 'RUNNING') throw new Error('Broadcast already running');

    const audienceType = broadcast.audience?.type || 'ALL';
    const targets = await resolveAudience(audienceType, broadcast.audience?.customContacts);

    broadcast.recipients = targets.map(t => ({
        phoneNumber: t.phoneNumber,
        name: t.name,
        entityType: t.entityType,
        linkedEntityId: t.linkedEntityId,
        linkedEntityModel: t.linkedEntityModel,
        status: 'PENDING'
    }));
    broadcast.status = 'RUNNING';
    broadcast.stats.total = targets.length;
    broadcast.stats.sent = 0;
    broadcast.stats.failed = 0;
    broadcast.startedAt = new Date();
    await broadcast.save();

    const useTemplate = Boolean(broadcast.messageTemplate?.name);
    let sent = 0, failed = 0;

    for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        const recip = broadcast.recipients[i];
        try {
            let waId;
            if (useTemplate) {
                // Resolve each template body parameter, then send as template
                const components = buildTemplateComponents(broadcast.messageTemplate, t);
                waId = await sendTemplateMessage({
                    to: t.phoneNumber,
                    name: broadcast.messageTemplate.name,
                    language: broadcast.messageTemplate.language,
                    components,
                });
            } else {
                const body = substitutePlaceholders(broadcast.message, {
                    name: t.name, phone: t.phoneNumber, type: t.entityType,
                });
                waId = await sendTextMessage({ to: t.phoneNumber, body });
            }
            recip.status = 'SENT';
            recip.whatsappMessageId = waId;
            recip.sentAt = new Date();
            sent++;
        } catch (error) {
            recip.status = 'FAILED';
            recip.error = error.raw?.error?.message || error.message;
            failed++;
        }
        broadcast.stats.sent = sent;
        broadcast.stats.failed = failed;
        await broadcast.save();
        await sleep(150);
    }

    broadcast.status = failed === 0 ? 'COMPLETED' : (sent > 0 ? 'PARTIAL' : 'FAILED');
    broadcast.completedAt = new Date();
    broadcast.stats.sent = sent;
    broadcast.stats.failed = failed;
    await broadcast.save();

    return broadcast;
};

// Build template components from stored values, personalising any {{var}} placeholders.
const buildTemplateComponents = (messageTemplate, recipient) => {
    const ctx = { name: recipient.name, phone: recipient.phoneNumber, type: recipient.entityType };
    const values = messageTemplate.values || [];
    const format = messageTemplate.parameterFormat || 'positional';

    let parameters;
    if (format === 'named') {
        // values keyed by param name -> send in any order with parameter_name
        parameters = Object.entries(values).map(([name, v]) => ({
            type: 'text',
            parameter_name: name,
            text: substitutePlaceholders(v, ctx),
        }));
    } else {
        // positional order -> matching {{1}}, {{2}}, ...
        // Values may arrive as an array (["a","b"]) or as an object keyed by index ({"1":"a","2":"b"})
        const ordered = Array.isArray(values)
            ? values
            : Object.keys(values || {}).sort((a, b) => Number(a) - Number(b)).map(k => values[k]);
        parameters = ordered.map(v => ({
            type: 'text',
            text: substitutePlaceholders(v, ctx),
        }));
    }

    return parameters.length ? [{ type: 'body', parameters }] : undefined;
};