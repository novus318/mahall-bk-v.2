import WhatsAppReminder from '../models/WhatsAppReminder.js';
import { buildDueReminders, sendDueBatch } from '../services/whatsappReminderService.js';

// POST /api/reminders/preview - estimate recipients for a due reminder run
export const previewReminder = async (req, res) => {
    try {
        const { entityType = 'All', period, frequency } = req.body;
        if (!period) return res.status(400).json({ success: false, message: 'Period is required' });

        const recipients = await buildDueReminders({ entityType, period, frequency });
        res.status(200).json({
            success: true,
            data: { total: recipients.length, recipients: recipients.slice(0, 20) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/reminders/dues - build recipients and run a due reminder batch
export const createAndRunDueReminder = async (req, res) => {
    try {
        const { entityType = 'All', period, frequency = 'Monthly', name } = req.body;
        if (!period) return res.status(400).json({ success: false, message: 'Period is required' });

        const recipients = await buildDueReminders({ entityType, period, frequency });
        if (recipients.length === 0) {
            return res.status(400).json({ success: false, message: 'No unpaid dues found for this period' });
        }

        const run = await sendDueBatch(recipients, {
            name: name || `Dues reminder - ${period}`,
            entityType,
            period,
            frequency,
            createdBy: req.user?._id
        });

        res.status(201).json({
            success: true,
            message: `Reminder started. Sending to ${recipients.length} recipient(s) in the background.`,
            data: run,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET /api/reminders - reminder run history
export const getReminders = async (req, res) => {
    try {
        const reminders = await WhatsAppReminder.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: reminders });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET /api/reminders/:id
export const getReminder = async (req, res) => {
    try {
        const reminder = await WhatsAppReminder.findById(req.params.id);
        if (!reminder) return res.status(404).json({ success: false, message: 'Reminder not found' });
        res.status(200).json({ success: true, data: reminder });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE /api/reminders/:id
export const deleteReminder = async (req, res) => {
    try {
        const reminder = await WhatsAppReminder.findByIdAndDelete(req.params.id);
        if (!reminder) return res.status(404).json({ success: false, message: 'Reminder not found' });
        res.status(200).json({ success: true, data: reminder });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};