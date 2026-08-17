import House from '../models/House.js';
import Member from '../models/Member.js';
import CollectionDue from '../models/CollectionDue.js';
import WhatsAppReminder from '../models/WhatsAppReminder.js';
import { sendDueCollectionTemplate } from './whatsappSender.js';

const sleep = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

export const normalizePhone = (phone) => {
    if (!phone) return null;
    let p = String(phone).replace(/[^0-9]/g, '');
    // Bare local/trunk numbers (10 digits) default to India (+91) for backward compat
    if (p.length === 10 && !p.startsWith('0')) p = '91' + p;
    if (!/^[1-9]\d{7,14}$/.test(p)) return null;
    return p;
};

const frequencyLabel = (frequency) => (frequency === 'Yearly' ? 'വാർഷിക' : 'പ്രതിമാസ');

// Resolve unpaid (PENDING / PARTIAL) dues for a period into WhatsApp recipients.
export const buildDueReminders = async ({ entityType = 'All', period, frequency } = {}) => {
    const types = entityType === 'All' ? ['House', 'Member'] : [entityType];
    const recipients = [];

    for (const type of types) {
        const dueQuery = {
            entityType: type,
            period,
            status: { $in: ['PENDING', 'PARTIAL'] },
            // Only remind when there is still an outstanding balance
            $expr: { $gt: [{ $subtract: ['$amount', '$paidAmount'] }, 0] },
        };
        if (frequency) dueQuery.frequency = frequency;

        const dues = await CollectionDue.find(dueQuery)
            .populate(type === 'House' ? { path: 'entityId', populate: { path: 'head' } } : 'entityId')
            .lean();

        for (const due of dues) {
            const entity = due.entityId;
            if (!entity) continue;

            let contactNumber, contactName, customId;
            if (type === 'House') {
                const head = entity.head;
                contactNumber = head?.whatsapp || head?.mobile;
                contactName = head?.name;
                customId = entity.customId;
            } else {
                contactNumber = entity.whatsapp || entity.mobile;
                contactName = entity.name;
                customId = entity.customId;
            }

            const phone = normalizePhone(contactNumber);
            if (!phone) continue;

            recipients.push({
                phoneNumber: phone,
                name: contactName || 'Recipient',
                entityType: type,
                entityId: entity._id,
                linkedEntityModel: type,
                dueId: due._id,
                period: due.period,
                amount: due.amount,
                frequency: due.frequency || 'Monthly',
                customId,
            });
        }
    }

    return recipients;
};

// Create a reminder run (recipients stored as PENDING) and execute it with the same
// batch processing pattern used by executeBroadcast.
export const sendDueBatch = async (recipients, { name, entityType = 'All', period, frequency = 'Monthly', createdBy } = {}) => {
    if (!recipients || recipients.length === 0) {
        throw new Error('No recipients to send');
    }

    const reminder = await WhatsAppReminder.create({
        name: name || `Dues reminder - ${period || ''}`,
        kind: 'DUE',
        entityType,
        period,
        frequency,
        status: 'DRAFT',
        recipients: recipients.map(r => ({
            phoneNumber: r.phoneNumber,
            name: r.name,
            entityType: r.entityType,
            entityId: r.entityId,
            linkedEntityModel: r.linkedEntityModel || r.entityType,
            dueId: r.dueId,
            period: r.period || period,
            amount: r.amount,
            customId: r.customId,
            frequency: r.frequency || frequency,
            status: 'PENDING'
        })),
        stats: { total: recipients.length, sent: 0, failed: 0 },
        startedAt: new Date(),
        createdBy
    });
    await reminder.save();

    return executeReminder(reminder._id);
};

// Execute a reminder run. Each recipient is personalised with the due_collection
// template and tracked (SENT / FAILED + error + sentAt), mirroring executeBroadcast.
export const executeReminder = async (reminderId) => {
    const reminder = await WhatsAppReminder.findById(reminderId);
    if (!reminder) throw new Error('Reminder not found');
    if (reminder.status === 'RUNNING') throw new Error('Reminder already running');

    reminder.status = 'RUNNING';
    reminder.stats.total = reminder.recipients.length;
    reminder.stats.sent = 0;
    reminder.stats.failed = 0;
    reminder.startedAt = new Date();
    await reminder.save();

    let sent = 0, failed = 0;

    for (let i = 0; i < reminder.recipients.length; i++) {
        const recip = reminder.recipients[i];
        if (recip.status === 'SENT' || recip.status === 'FAILED') continue;

        try {
            const waId = await sendDueCollectionTemplate({
                to: recip.phoneNumber,
                name: recip.name,
                frequencyLabel: frequencyLabel(recip.frequency),
                customId: recip.customId,
                period: recip.period,
                amount: recip.amount,
                dueId: (recip.entityType === 'House' ? 'hou/' : 'mem/') + recip.entityId.toString(),
            });
            recip.status = 'SENT';
            recip.whatsappMessageId = waId;
            recip.sentAt = new Date();
            sent++;
        } catch (error) {
            recip.status = 'FAILED';
            recip.error = error.raw?.error?.message || error.response?.data?.error?.message || error.message;
            failed++;
        }

        reminder.stats.sent = sent;
        reminder.stats.failed = failed;
        await reminder.save();
        await sleep(150);
    }

    reminder.status = failed === 0 ? 'COMPLETED' : (sent > 0 ? 'PARTIAL' : 'FAILED');
    reminder.completedAt = new Date();
    reminder.stats.sent = sent;
    reminder.stats.failed = failed;
    await reminder.save();

    return reminder;
};