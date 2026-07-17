import mongoose from 'mongoose';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import dotenv from 'dotenv';
import axios from 'axios';
import Receipt from '../models/Receipt.js';
import ReceiptCategory from '../models/ReceiptCategory.js';
import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import CollectionDue from '../models/CollectionDue.js';
import CollectionReceipt from '../models/CollectionReceipt.js';
import Contract from '../models/Contract.js';
import RentDue from '../models/RentDue.js';
import House from '../models/House.js';
import Member from '../models/Member.js';
import SystemSettings from '../models/SystemSettings.js';


dotenv.config();

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

export const createOrder = async (req, res) => {
    try {
        const { amount, currency = 'INR', receipt_note, type, dueId, rentDueId, entityId, name, contact } = req.body;

        if (!amount) {
            return res.status(400).json({ message: 'Amount is required' });
        }

        const options = {
            amount: amount * 100,
            currency,
            receipt: `pay_${Date.now()}`,
            notes: {
                description: receipt_note || 'Payment',
                type: type || 'collection',
                dueId,
                rentDueId,
                entityId,
                name,
                contact
            }
        };

        const order = await razorpay.orders.create(options);
        res.status(200).json({ success: true, order, key: process.env.RAZORPAY_KEY_ID });
    } catch (error) {
        console.error('Razorpay Create Order Error:', error);
        res.status(500).json({ message: 'Failed to create order', error: error.message });
    }
};

export const handleWebhook = async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(req.rawBody)
        .digest('hex');

    if (expectedSignature === signature) {
        const { event, payload } = req.body;

        switch (event) {
            case 'payment.captured': {
                try {
                    const payment = payload.payment.entity;
                    const amount = payment.amount / 100;
                    const notes = payment.notes || {};

                    if (notes.type === 'rent' && notes.rentDueId) {
                        const rentDue = await RentDue.findById(notes.rentDueId).populate('contract');
                        if (!rentDue) {
                            console.error('RentDue not found:', notes.rentDueId);
                            break;
                        }

                        const remaining = rentDue.amount - rentDue.collectedAmount;
                        const payAmount = Math.min(amount, remaining);

                        const settings = await SystemSettings.findOneAndUpdate(
                            {},
                            { $inc: { 'rentSettings.receiptCurrentNumber': 1 } },
                            { upsert: true, new: true, setDefaultsOnInsert: true }
                        );
                        const prefix = settings.rentSettings?.receiptPrefix || 'RNT-';
                        const nextNum = settings.rentSettings?.receiptCurrentNumber || 1;
                        const receiptNo = `${prefix}${new Date().getFullYear()}-${nextNum}`;

                        const account = await Account.findOne({ isPrimary: true });
                        if (!account) {
                            console.error('No Primary Account found');
                            break;
                        }

                        const tenant = rentDue.contract?.tenant;
                        const receipt = await Receipt.create({
                            receiptNo,
                            date: new Date(),
                            amount: payAmount,
                            type: 'INCOME',
                            account: account._id,
                            payer: tenant?.name || notes.name || 'Online Payment',
                            payerContact: tenant?.phone || notes.contact || '',
                            description: `Rent Payment - ${rentDue.monthYear} (${tenant?.name || 'Tenant'}) - Razorpay Ref: ${payment.id}`,
                            items: [{ description: `Rent for ${rentDue.monthYear}`, amount: payAmount }]
                        });

                        rentDue.transactions.push({
                            amount: payAmount,
                            date: new Date(),
                            notes: `Razorpay: ${payment.id}`,
                            receipt: receipt._id
                        });

                        const newCollected = rentDue.collectedAmount + payAmount;
                        rentDue.collectedAmount = newCollected;
                        rentDue.paymentDate = new Date();
                        rentDue.status = newCollected >= rentDue.amount ? 'PAID' : 'PARTIAL';
                        await rentDue.save();

                        const rentSession = await mongoose.startSession();
                        try {
                            rentSession.startTransaction();

                            account.balance += payAmount;
                            await account.save({ session: rentSession });

                            await AccountTransaction.create([{
                                account: account._id,
                                contract: rentDue.contract._id,
                                receipt: receipt._id,
                                type: 'INCOME',
                                amount: payAmount,
                                balanceAfter: account.balance,
                                date: new Date(),
                                description: `Rent Payment - ${rentDue.monthYear} (${tenant?.name || 'Tenant'})`
                            }], { session: rentSession });

                            await rentSession.commitTransaction();
                        } catch (txnError) {
                            await rentSession.abortTransaction();
                            throw txnError;
                        } finally {
                            rentSession.endSession();
                        }

                        console.log(`Razorpay Rent Receipt: ${receiptNo} for ₹${payAmount}`);

                        const payerPhone = tenant?.phone || notes.contact || '';
                        if (payerPhone) {
                            const WHATSAPP_URL = process.env.WHATSAPP_API_URL;
                            const TOKEN = process.env.WHATSAPP_TOKEN;
                            if (WHATSAPP_URL && TOKEN) {
                                let phone = payerPhone.replace(/\D/g, '');
                                if (phone.length === 10) phone = '91' + phone;

                                const amountStr = `₹${payAmount.toLocaleString('en-IN')}`;

                                const wpPayload = {
                                    messaging_product: 'whatsapp',
                                    to: phone,
                                    type: 'template',
                                    template: {
                                        name: 'rent_due_confirm',
                                        language: { code: 'ml' },
                                        components: [{
                                            type: 'body',
                                            parameters: [
                                                { type: 'text', text: tenant?.name || 'Tenant' },
                                                { type: 'text', text: amountStr },
                                                { type: 'text', text: rentDue.monthYear },
                                            ]
                                        },
                                        {
                                            type: 'button',
                                            sub_type: 'url',
                                            index: '0',
                                            parameters: [
                                                { type: 'text', text: 'api/receipts/' + receipt._id.toString() + '/pdf' }
                                            ]
                                        }]
                                    }
                                };

                                axios.post(WHATSAPP_URL, wpPayload, {
                                    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
                                    timeout: 10000
                                }).catch(error => {
                                    console.error('Failed to send rent WhatsApp:', error.response?.data || error.message);
                                });
                            }
                        }
                    } else if (notes.dueId) {
                        const due = await CollectionDue.findById(notes.dueId);
                        if (!due) {
                            console.error('CollectionDue not found:', notes.dueId);
                            break;
                        }

                        const remaining = due.amount - due.paidAmount;
                        const payAmount = Math.min(amount, remaining);

                        let settings = await SystemSettings.findOne();
                        if (!settings) {
                            settings = await SystemSettings.create({});
                        }
                        const prefix = settings.collectionSettings?.receiptPrefix || 'MC-';
                        const nextNum = settings.collectionSettings?.receiptCurrentNumber || 1;
                        const receiptNo = `${prefix}${new Date().getFullYear()}-${nextNum}`;

                        const entityType = due.entityType;
                        let payerName = notes.name || 'Online Payment';
                        let customId = '';
                        if (entityType === 'House') {
                            const h = await House.findById(due.entityId);
                            if (h) {
                                payerName = `${h.name} (${h.customId})`;
                                customId = h.customId;
                            }
                        } else {
                            const m = await Member.findById(due.entityId);
                            if (m) {
                                payerName = `${m.name} (${m.customId})`;
                                customId = m.customId;
                            }
                        }

                        const payerPhone = payment.contact || notes.contact || '';

                        const account = await Account.findOne({ isPrimary: true });
                        if (!account) {
                            console.error('No Primary Account found');
                            break;
                        }

                        const receipt = await CollectionReceipt.create({
                            receiptNo,
                            amount: payAmount,
                            date: new Date(),
                            account: account._id,
                            dueId: due._id,
                            payer: {
                                name: payerName,
                                entityType,
                                entityId: due.entityId
                            },
                            description: `Online payment for ${due.period} (${due.frequency}) - Razorpay Ref: ${payment.id}`,
                            mode: 'ONLINE'
                        });

                        await SystemSettings.updateOne(
                            { _id: settings._id },
                            { $inc: { 'collectionSettings.receiptCurrentNumber': 1 } }
                        );

                        due.paidAmount += payAmount;
                        due.transactions.push({
                            date: new Date(),
                            amount: payAmount,
                            receiptId: receipt._id,
                            notes: `Razorpay: ${payment.id}`
                        });
                        due.status = due.paidAmount >= due.amount ? 'PAID' : 'PARTIAL';
                        await due.save();

                        const collSession = await mongoose.startSession();
                        try {
                            collSession.startTransaction();

                            account.balance += payAmount;
                            await account.save({ session: collSession });

                            await AccountTransaction.create([{
                                account: account._id,
                                type: 'INCOME',
                                amount: payAmount,
                                balanceAfter: account.balance,
                                date: new Date(),
                                description: `Collection from ${payerName} - ${due.period} (${due.frequency})`,
                                collectionReceipt: receipt._id
                            }], { session: collSession });

                            await collSession.commitTransaction();
                        } catch (txnError) {
                            await collSession.abortTransaction();
                            throw txnError;
                        } finally {
                            collSession.endSession();
                        }

                        console.log(`Razorpay Collection Receipt: ${receiptNo} for ₹${payAmount}`);

                        if (payerPhone) {
                            console.log(payerPhone)
                            const API_URL = process.env.WHATSAPP_API_URL;
                            const TOKEN = process.env.WHATSAPP_TOKEN;
                            if (API_URL && TOKEN) {
                                let phone = payerPhone.replace(/\D/g, '');
                                if (phone.length === 10) phone = '91' + phone;

                                const amountStr = `₹${payAmount.toLocaleString('en-IN')}`;

                                const payload = {
                                    messaging_product: 'whatsapp',
                                    to: phone,
                                    type: 'template',
                                    template: {
                                        name: 'due_confirm',
                                        language: { code: 'ml' },
                                        components: [{
                                            type: 'body',
                                            parameters: [
                                                { type: 'text', text: payerName },
                                                { type: 'text', text: customId },
                                                { type: 'text', text: due.period },
                                                { type: 'text', text: amountStr }
                                            ]
                                        },
                                        {
                                            type: 'button',
                                            sub_type: 'url',
                                            index: '0',
                                            parameters: [
                                                { type: 'text', text: 'api/collections/receipts/' + receipt._id.toString() + '/pdf' }
                                            ]
                                        }]
                                    }
                                };

                                axios.post(API_URL, payload, {
                                    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
                                    timeout: 10000
                                }).catch(error => {
                                    console.log(error)
                                    console.error('Failed to send due_confirm WhatsApp:', error.response?.data || error.message);
                                });
                            }
                        }
                    } else {
                        const donorName = notes.donor_name || notes.name || 'Anonymous';
                        const donorPhone = payment.contact || notes.contact || '';
                        const description = notes.description || 'Online Donation';

                        const account = await Account.findOne({ isPrimary: true });
                        if (!account) {
                            console.error('No Primary Account found');
                            break;
                        }

                        const categoryName = notes.category || 'DONATIONS';
                        let category = await ReceiptCategory.findOne({ name: { $regex: new RegExp(`^${categoryName}$`, 'i') } });
                        if (!category) {
                            category = await ReceiptCategory.create({
                                name: categoryName,
                                type: 'INCOME',
                                description: 'Auto-created from Online Payment'
                            });
                        }

                        const receiptNo = `ONL-${Date.now()}`;

                        const receipt = await Receipt.create({
                            receiptNo,
                            date: new Date(),
                            amount,
                            type: 'INCOME',
                            category: category._id,
                            account: account._id,
                            payer: donorName,
                            payerContact: donorPhone,
                            description: `${description} (Razorpay Ref: ${payment.id})`,
                            items: [{ description, amount }]
                        });

                        const donSession = await mongoose.startSession();
                        try {
                            donSession.startTransaction();

                            account.balance += amount;
                            await account.save({ session: donSession });

                            await AccountTransaction.create([{
                                account: account._id,
                                type: 'INCOME',
                                amount,
                                balanceAfter: account.balance,
                                date: new Date(),
                                description: `Receipt ${receiptNo} from ${donorName}`
                            }], { session: donSession });

                            await donSession.commitTransaction();
                        } catch (txnError) {
                            await donSession.abortTransaction();
                            throw txnError;
                        } finally {
                            donSession.endSession();
                        }

                        console.log(`Razorpay Donation Receipt: ${receiptNo} for ₹${amount}`);

                        if (donorPhone) {
                            const API_URL = process.env.WHATSAPP_API_URL;
                            const TOKEN = process.env.WHATSAPP_TOKEN;
                            if (API_URL && TOKEN) {
                                let phone = donorPhone.replace(/\D/g, '');
                                if (phone.length === 10) phone = '91' + phone;

                                const amountStr = `₹${amount.toLocaleString('en-IN')}`;

                                const payload = {
                                    messaging_product: 'whatsapp',
                                    to: phone,
                                    type: 'template',
                                    template: {
                                        name: 'reciept_confirm',
                                        language: { code: 'ml' },
                                        components: [{
                                            type: 'body',
                                            parameters: [
                                                { type: 'text', text: donorName },
                                                { type: 'text', text: amountStr }
                                            ]
                                        },
                                        {
                                            type: 'button',
                                            sub_type: 'url',
                                            index: '0',
                                            parameters: [
                                                { type: 'text', text: 'api/receipts/' + receipt._id.toString() + '/pdf' }
                                            ]
                                        }]
                                    }
                                };

                                axios.post(API_URL, payload, {
                                    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
                                    timeout: 10000
                                }).catch(error => {
                                    console.error('Failed to send receipt_confirm WhatsApp:', error.response?.data || error.message);
                                });
                            }
                        }
                    }
                } catch (error) {
                    console.error('Razorpay payment.captured error:', error);
                }
                break;
            }
            default:
                break;
        }
    }

    res.status(200).send();
};
