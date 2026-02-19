import Razorpay from 'razorpay';
import Receipt from '../models/Receipt.js';
import Account from '../models/Account.js';
import { validateWebhookSignature } from 'razorpay/dist/utils/razorpay-utils.js';
// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// 1. Create Order
export const createOrder = async (req, res) => {
    try {
        const { amount, currency = 'INR', receipt_note } = req.body;

        if (!amount) {
            return res.status(400).json({ message: 'Amount is required' });
        }

        const options = {
            amount: amount * 100, // Amount in paise
            currency,
            receipt: `rcpt_${Date.now()}`,
            notes: {
                description: receipt_note || 'Donation'
            }
        };

        const order = await razorpay.orders.create(options);
        res.status(200).json({ success: true, order });
    } catch (error) {
        console.error('Razorpay Create Order Error:', error);
        res.status(500).json({ message: 'Failed to create order', error: error.message });
    }
};

// 2. Handle Webhook
export const handleWebhook = async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];


    const isValid = validateWebhookSignature(JSON.stringify(req.body), signature, secret);

    if (!isValid) {
        console.error('Razorpay Webhook Signature Mismatch');
        return res.status(400).json({ status: 'invalid_signature' });
    }


    // Process Event
    const event = req.body;

    if (event.event === 'payment.captured') {
        try {
            const payment = event.payload.payment.entity;
            const amount = payment.amount / 100; // Convert back to main currency
            const notes = payment.notes;
            const donorName = notes.donor_name || 'Anonymous'; // We will pass this in notes from frontend
            const donorPhone = payment.contact || notes.donor_phone;
            const description = notes.description || 'Online Donation';

            // 1. Find Primary Account
            const account = await Account.findOne({ isPrimary: true });
            if (!account) {
                console.error('No Primary Account found for Razorpay Receipt');
                // Fallback or Log Error - critical
                return res.status(500).json({ message: 'Internal config error: No Primary Account' });
            }

            // 2. Generate Receipt No (Simple logic or use existing helper if available)
            // Assuming simplified unique generation for now: "ONL-{timestamp}"
            const receiptNo = `ONL-${Date.now()}`;

            // 3. Create Receipt
            const newReceipt = new Receipt({
                receiptNo,
                date: new Date(),
                amount,
                type: 'INCOME',
                account: account._id,
                payer: donorName,
                payerContact: donorPhone,
                description: `${description} (Razorpay Ref: ${payment.id})`,
                items: [{
                    description: description,
                    amount: amount
                }]
            });

            await newReceipt.save();

            // 4. Update Account Balance
            account.balance += amount;
            await account.save();

            console.log(`Razorpay Receipt Created: ${receiptNo} for ₹${amount}`);

            res.status(200).json({ status: 'ok' });

        } catch (error) {
            console.error('Razorpay Webhook Processing Error:', error);
            res.status(500).json({ message: 'Webhook processing failed' });
        }
    } else {
        // Ignore other events
        res.status(200).json({ status: 'ignored' });
    }
};
