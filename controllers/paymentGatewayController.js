import Razorpay from 'razorpay';
import { validateWebhookSignature } from 'razorpay/dist/utils/razorpay-utils.js';
import Receipt from '../models/Receipt.js';
import ReceiptCategory from '../models/ReceiptCategory.js';
import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import CollectionDue from '../models/CollectionDue.js';
import CollectionReceipt from '../models/CollectionReceipt.js';
import House from '../models/House.js';
import Member from '../models/Member.js';
import SystemSettings from '../models/SystemSettings.js';

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

export const createOrder = async (req, res) => {
    try {
        const { amount, currency = 'INR', receipt_note, dueId, entityId, name, contact } = req.body;

        if (!amount) {
            return res.status(400).json({ message: 'Amount is required' });
        }

        const options = {
            amount: amount * 100,
            currency,
            receipt: `due_${Date.now()}`,
            notes: {
                description: receipt_note || 'Due Payment',
                dueId,
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
    const isValid = await validateWebhookSignature(
        JSON.stringify(req.body),
        signature,
        process.env.RAZORPAY_WEBHOOK_SECRET
    );
    console.log(isValid)
    console.log(req.body)
    if (isValid) {
        const { event, payload } = req.body;

        switch (event) {
            case 'payment.captured': {
                try {
                    const payment = payload.payment.entity;
                    const amount = payment.amount / 100;
                    const notes = payment.notes || {};

                    if (notes.dueId) {
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
                        if (entityType === 'House') {
                            const h = await House.findById(due.entityId);
                            if (h) payerName = `${h.name} (${h.customId})`;
                        } else {
                            const m = await Member.findById(due.entityId);
                            if (m) payerName = `${m.name} (${m.customId})`;
                        }

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

                        account.balance += payAmount;
                        await account.save();

                        await AccountTransaction.create({
                            account: account._id,
                            type: 'INCOME',
                            amount: payAmount,
                            balanceAfter: account.balance,
                            date: new Date(),
                            description: `Collection from ${payerName} - ${due.period} (${due.frequency})`,
                            collectionReceipt: receipt._id
                        });

                        console.log(`Razorpay Collection Receipt: ${receiptNo} for ₹${payAmount}`);
                    } else {
                        const donorName = notes.donor_name || notes.name || 'Anonymous';
                        const donorPhone = payment.contact || notes.contact || '';
                        const description = notes.description || 'Online Donation';

                        const account = await Account.findOne({ isPrimary: true });
                        if (!account) {
                            console.error('No Primary Account found');
                            break;
                        }

                        const categoryName = notes.category || 'Donation';
                        let category = await ReceiptCategory.findOne({ name: { $regex: new RegExp(`^${categoryName}$`, 'i') } });
                        if (!category) {
                            category = await ReceiptCategory.create({
                                name: categoryName,
                                type: 'INCOME',
                                description: 'Auto-created from Online Payment'
                            });
                        }

                        const receiptNo = `ONL-${Date.now()}`;

                        await Receipt.create({
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

                        account.balance += amount;
                        await account.save();

                        await AccountTransaction.create({
                            account: account._id,
                            type: 'INCOME',
                            amount,
                            balanceAfter: account.balance,
                            date: new Date(),
                            description: `Receipt ${receiptNo} from ${donorName}`
                        });

                        console.log(`Razorpay Donation Receipt: ${receiptNo} for ₹${amount}`);
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
