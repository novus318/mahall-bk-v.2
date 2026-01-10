import House from '../models/House.js';
import Member from '../models/Member.js';
import CollectionDue from '../models/CollectionDue.js';
import CollectionReceipt from '../models/CollectionReceipt.js';
import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import SystemSettings from '../models/SystemSettings.js';
import mongoose from 'mongoose';
import axios from 'axios';

// @desc    Update Subscription Settings
// @route   PUT /api/collections/:type/:id/subscription
// @access  Private (Admin)
const updateSubscription = async (req, res) => {
    try {
        const { type, id } = req.params; // type: 'house' or 'member'
        const { frequency, amount } = req.body;

        const Model = type === 'house' ? House : Member;
        const entity = await Model.findById(id);

        if (!entity) {
            return res.status(404).json({ status: false, message: `${type} not found` });
        }

        // Switching Logic: Block frequency change if pending dues exist for the CURRENT frequency
        const currentFrequency = entity.subscription?.frequency;
        if (frequency && currentFrequency && frequency !== currentFrequency && currentFrequency !== 'None') {
            const pendingDues = await CollectionDue.countDocuments({
                entityId: id,
                status: { $ne: 'PAID' },
                frequency: currentFrequency
            });

            if (pendingDues > 0) {
                return res.status(400).json({
                    status: false,
                    message: `Cannot switch to ${frequency}. Clear ${pendingDues} pending ${currentFrequency} due(s) first.`
                });
            }
        }


        entity.subscription = {
            frequency: frequency || entity.subscription?.frequency,
            amount: amount !== undefined ? amount : entity.subscription?.amount,
            startDate: new Date()
        };

        await entity.save();
        res.json({ status: true, message: 'Subscription updated', data: entity });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get Dues
// @route   GET /api/collections/dues
// @access  Public/Private
const getDues = async (req, res) => {
    try {
        const { entityId, status, period, frequency } = req.query;
        const query = {};

        if (entityId) query.entityId = entityId;
        if (status) query.status = status;
        if (period) query.period = period;
        if (frequency) query.frequency = frequency;

        const dues = await CollectionDue.find(query).sort({ createdAt: -1 });
        res.json({ status: true, data: dues });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Generate Single Due
// @route   POST /api/collections/generate/single
// @access  Private
const generateSingleDue = async (req, res) => {
    try {
        const { entityType, entityId, period } = req.body; // entityType: 'House' or 'Member'

        const Model = entityType === 'House' ? House : Member;
        const entity = await Model.findById(entityId);

        if (!entity) return res.status(404).json({ status: false, message: 'Entity not found' });

        const sub = entity.subscription;
        if (!sub || sub.frequency === 'None') {
            return res.status(400).json({ status: false, message: 'No active subscription' });
        }

        // Check if exists
        const exists = await CollectionDue.findOne({ entityId, period });
        if (exists) {
            if (exists.status === 'REJECTED') {
                // Reset existing rejected due
                exists.status = 'PENDING';
                exists.amount = sub.amount; // Update amount in case subscription changed
                exists.paidAmount = 0;
                exists.transactions = []; // Clear previous transactions/history
                exists.rejectionOtp = undefined;
                exists.rejectionOtpExpires = undefined;
                await exists.save();
                return res.json({ status: true, message: 'Due regenerated (previous was rejected)', data: exists });
            }
            return res.status(400).json({ status: false, message: 'Due already exists for this period' });
        }

        const due = await CollectionDue.create({
            entityType,
            entityId,
            period,
            frequency: sub.frequency,
            amount: sub.amount,
            status: 'PENDING'
        });

        res.json({ status: true, message: 'Due generated', data: due });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Pay Due (Partial or Full)
// @route   POST /api/collections/pay
// @access  Private
const payDue = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { dueId, amount, date, accountId, paymentMethod } = req.body;

        const due = await CollectionDue.findById(dueId).session(session);
        if (!due) throw new Error('Due record not found');

        const remaining = due.amount - due.paidAmount;
        if (amount > remaining) {
            throw new Error(`Amount exceeds remaining due (${remaining})`);
        }

        // 1. Create Receipt
        // Get Receipt No settings
        let settings = await SystemSettings.findOne().session(session);
        if (!settings) {
            settings = await SystemSettings.create([{}], { session });
            settings = settings[0];
        }

        const prefix = settings.collectionSettings?.receiptPrefix || 'MC-';
        const nextNum = settings.collectionSettings?.receiptCurrentNumber || 1;
        const receiptNo = `${prefix}${new Date().getFullYear()}-${nextNum}`;

        // Get Entity Name for 'Payer'
        let payerInfo = { name: "Unknown" };
        if (due.entityType === 'House') {
            const h = await House.findById(due.entityId).session(session);
            payerInfo = {
                name: h ? `${h.name} (${h.customId})` : "House",
                entityType: 'House',
                entityId: due.entityId
            };
        } else {
            const m = await Member.findById(due.entityId).session(session);
            payerInfo = {
                name: m ? `${m.name} (${m.customId})` : "Member",
                entityType: 'Member',
                entityId: due.entityId
            };
        }

        const receipt = await CollectionReceipt.create([{
            receiptNo,
            amount,
            date: date || new Date(),
            account: accountId,
            dueId: dueId,
            payer: payerInfo,
            description: `Payment for ${due.period} (${due.frequency})`,
            mode: paymentMethod || 'CASH'
        }], { session });

        // 2. Update System Settings No
        await SystemSettings.updateOne(
            { _id: settings._id },
            { $inc: { 'collectionSettings.receiptCurrentNumber': 1 } }
        ).session(session);

        // 3. Update Due
        due.paidAmount += Number(amount);
        due.transactions.push({
            date: date || new Date(),
            amount,
            receiptId: receipt[0]._id,
            notes: paymentMethod
        });

        if (due.paidAmount >= due.amount) {
            due.status = 'PAID';
        } else {
            due.status = 'PARTIAL';
        }
        await due.save({ session });

        // 4. Update Account Balance & Create Transaction
        const account = await Account.findById(accountId).session(session);
        if (account) {
            account.balance += Number(amount);
            await account.save({ session });

            await AccountTransaction.create([{
                account: account._id,
                type: 'INCOME',
                amount: Number(amount),
                balanceAfter: account.balance,
                date: date || new Date(),
                description: `Collection from ${payerInfo.name} - ${due.period} (${due.frequency})`,
                payment: null, // or link if needed
                collectionReceipt: receipt[0]._id
            }], { session });
        }

        await session.commitTransaction();
        res.json({ status: true, message: 'Payment recorded', data: { receipt: receipt[0], due } });

    } catch (error) {
        await session.abortTransaction();
        res.status(500).json({ status: false, message: error.message });
    } finally {
        session.endSession();
    }
};


// @desc    Initiate Rejection (Send OTP)
// @route   POST /api/collections/reject/initiate
// @access  Private
const initiateRejection = async (req, res) => {
    try {
        const { dueId } = req.body;
        const due = await CollectionDue.findById(dueId);
        if (!due) return res.status(404).json({ status: false, message: 'Due not found' });

        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Save OTP
        due.rejectionOtp = otp;
        due.rejectionOtpExpires = otpExpires;
        await due.save();

        // Get Notification Contacts
        const settings = await SystemSettings.findOne();
        const contacts = settings?.alertContacts || [];

        if (contacts.length === 0) {
            return res.status(400).json({ status: false, message: 'No notification contacts configured in settings' });
        }

        // Send WhatsApp OTP to each contact
        const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
        // Use generic API URL or construct from env
        const API_URL = process.env.WHATSAPP_API_URL;

        if (!WHATSAPP_TOKEN || !API_URL) {
            return res.status(500).json({ status: false, message: 'WhatsApp configuration missing' });
        }

        let sentCount = 0;
        for (const contact of contacts) {
            if (!contact.number) continue;

            const payload = {
                messaging_product: 'whatsapp',
                to: contact.number,
                type: 'template',
                template: {
                    name: 'user_auth', // TEMPLATE NAME from user request
                    language: { code: 'en_US' },
                    components: [
                        {
                            type: 'body',
                            parameters: [{ type: 'text', text: otp }],
                        },
                        {
                            type: 'button',
                            sub_type: 'url',
                            index: '0',
                            parameters: [{ type: 'text', text: otp }],
                        },
                    ]
                }
            };

            try {
                await axios.post(API_URL, payload, {
                    headers: {
                        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                });
                sentCount++;
            } catch (err) {
                console.error(`Failed to send OTP to ${contact.number}:`, err.response?.data || err.message);
            }
        }

        if (sentCount === 0) {
            return res.status(500).json({ status: false, message: 'Failed to send OTP messages' });
        }

        res.json({ status: true, message: `OTP sent to ${sentCount} contact(s)` });

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Confirm Rejection (Verify OTP)
// @route   POST /api/collections/reject/confirm
// @access  Private
const confirmRejection = async (req, res) => {
    try {
        const { dueId, otp } = req.body;
        const due = await CollectionDue.findById(dueId);
        if (!due) return res.status(404).json({ status: false, message: 'Due not found' });

        if (!due.rejectionOtp || !due.rejectionOtpExpires) {
            return res.status(400).json({ status: false, message: 'No OTP generated' });
        }

        if (new Date() > due.rejectionOtpExpires) {
            return res.status(400).json({ status: false, message: 'OTP expired' });
        }

        if (due.rejectionOtp !== otp) {
            return res.status(400).json({ status: false, message: 'Invalid OTP' });
        }

        // OTP Verified - Perform Rejection
        due.status = 'REJECTED';
        due.rejectionOtp = undefined;
        due.rejectionOtpExpires = undefined;
        await due.save();

        res.json({ status: true, message: 'Due rejected successfully', data: due });

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export { updateSubscription, getDues, generateSingleDue, payDue, initiateRejection, confirmRejection };
