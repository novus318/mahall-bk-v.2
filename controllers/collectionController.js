import axios from 'axios';
import House from '../models/House.js';
import Member from '../models/Member.js';
import CollectionDue from '../models/CollectionDue.js';
import CollectionReceipt from '../models/CollectionReceipt.js';
import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import SystemSettings from '../models/SystemSettings.js';
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import { generateBulkDuesInternal } from '../services/collectionService.js';

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
                status: { $in: ['PENDING', 'PARTIAL'] },
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
        const { entityId, entityType, status, period, frequency } = req.query;
        const query = {};

        if (entityId) query.entityId = entityId;
        if (entityType) query.entityType = entityType;
        if (status) query.status = status;
        if (period) query.period = period;
        if (frequency) query.frequency = frequency;

        const dues = await CollectionDue.find(query)
            .populate({
                path: 'entityId',
                select: 'name customId house',
                populate: { path: 'house', select: 'name customId', strictPopulate: false }
            })
            .populate({
                path: 'transactions.receiptId',
                select: 'account receiptNo',
                populate: { path: 'account', select: 'name _id type' }
            })
            .sort({ createdAt: -1 });

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
    try {
        const { dueId, amount, date, accountId, paymentMethod } = req.body;

        const due = await CollectionDue.findById(dueId);
        if (!due) throw new Error('Due record not found');

        const remaining = due.amount - due.paidAmount;
        if (amount > remaining) {
            throw new Error(`Amount exceeds remaining due (${remaining})`);
        }

        // 1. Create Receipt
        // Get Receipt No settings
        let settings = await SystemSettings.findOne();
        if (!settings) {
            settings = await SystemSettings.create({});
        }

        const prefix = settings.collectionSettings?.receiptPrefix || 'MC-';
        const nextNum = settings.collectionSettings?.receiptCurrentNumber || 1;
        const receiptNo = `${prefix}${new Date().getFullYear()}-${nextNum}`;

        // Get Entity Name for 'Payer'
        let payerInfo = { name: "Unknown" };
        let payerCustomId = '';
        let payerPhone = '';
        if (due.entityType === 'House') {
            const h = await House.findById(due.entityId).populate('head');
            payerCustomId = h ? h.customId : '';
            payerInfo = {
                name: h ? `${h.name} (${h.customId})` : "House",
                entityType: 'House',
                entityId: due.entityId
            };
            if (h && h.head) {
                payerPhone = h.head.whatsapp || h.head.mobile || '';
            }
        } else {
            const m = await Member.findById(due.entityId);
            payerCustomId = m ? m.customId : '';
            payerInfo = {
                name: m ? `${m.name} (${m.customId})` : "Member",
                entityType: 'Member',
                entityId: due.entityId
            };
            if (m) {
                payerPhone = m.whatsapp || m.mobile || '';
            }
        }

        const receipt = await CollectionReceipt.create({
            receiptNo,
            amount,
            date: date || new Date(),
            account: accountId,
            dueId: dueId,
            payer: payerInfo,
            description: `Payment for ${due.period} (${due.frequency})`,
            mode: paymentMethod || 'CASH'
        });

        // 2. Update System Settings No
        await SystemSettings.updateOne(
            { _id: settings._id },
            { $inc: { 'collectionSettings.receiptCurrentNumber': 1 } }
        );

        // 3. Update Due
        due.paidAmount += Number(amount);
        due.transactions.push({
            date: date || new Date(),
            amount,
            receiptId: receipt._id,
            notes: paymentMethod
        });

        if (due.paidAmount >= due.amount) {
            due.status = 'PAID';
        } else {
            due.status = 'PARTIAL';
        }
        await due.save();

        // 4. Update Account Balance & Create Transaction
        const account = await Account.findById(accountId);
        if (account) {
            const session = await mongoose.startSession();
            try {
                session.startTransaction();

                account.balance += Number(amount);
                await account.save({ session });

                await AccountTransaction.create([{
                    account: account._id,
                    type: 'INCOME',
                    amount: Number(amount),
                    balanceAfter: account.balance,
                    date: date || new Date(),
                    description: `Collection from ${payerInfo.name} - ${due.period} (${due.frequency})`,
                    collectionReceipt: receipt._id
                }], { session });

                await session.commitTransaction();
            } catch (txnError) {
                await session.abortTransaction();
                throw txnError;
            } finally {
                session.endSession();
            }
        }

        // 5. Send WhatsApp Notification
        if (payerPhone) {
            const API_URL = process.env.WHATSAPP_API_URL;
            const TOKEN = process.env.WHATSAPP_TOKEN;
            if (API_URL && TOKEN) {
                let phone = payerPhone.replace(/\D/g, '');
                if (phone.length === 10) phone = '91' + phone;

                const amountStr = `₹${Number(amount).toLocaleString('en-IN')}`;

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
                                { type: 'text', text: payerInfo.name },
                                { type: 'text', text: payerCustomId },
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
                    console.error('Failed to send due_confirm WhatsApp:', error.response?.data || error.message);
                });
            }
        }

        res.json({ status: true, message: 'Payment recorded', data: { receipt, due } });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: error.message });
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
                    name: 'otp', // TEMPLATE NAME from user request
                    language: { code: 'en' },
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

// @desc    Get Collection Receipt
// @route   GET /api/collections/receipts/:id
// @access  Private
const getCollectionReceipt = async (req, res) => {
    try {
        const receipt = await CollectionReceipt.findById(req.params.id)
            .populate({
                path: 'payer.entityId',
                select: 'name customId address phone' // Fetch address/phone if available
            })
            .populate('dueId'); // To get period/frequency details if needed

        if (!receipt) {
            return res.status(404).json({ status: false, message: 'Receipt not found' });
        }

        res.json({ status: true, data: receipt });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Download Collection Receipt PDF
// @route   GET /api/collections/receipts/:id/pdf
// @access  Private
const downloadCollectionReceiptPdf = async (req, res) => {
    try {
        const receipt = await CollectionReceipt.findById(req.params.id)
            .populate({
                path: 'payer.entityId',
                select: 'name customId address phone'
            })
            .populate('dueId');

        if (!receipt) {
            return res.status(404).json({ status: false, message: 'Receipt not found' });
        }

        const PW = 144;
        const MG = 6;
        const CW = PW - MG * 2;
        const LH = 10;

        const isPartial = receipt.dueId?.status === 'PARTIAL';
        const title = isPartial ? 'PARTIAL PAYMENT RECEIPT' : 'COLLECTION RECEIPT';
        const desc = receipt.description;
        const period = receipt.dueId?.period ? `Period: ${receipt.dueId.period}` : '';
        const hasPartial = receipt.dueId && (receipt.dueId.frequency === 'Yearly' || receipt.dueId.status === 'PARTIAL');
        const totalDue = receipt.dueId?.amount || 0;
        const balance = totalDue - (receipt.dueId?.paidAmount || 0);
        const payerName = receipt.payer.entityId?.name || receipt.payer.name || 'Unknown';
        const houseId = receipt.payer.entityType === 'House'
            ? receipt.payer.entityId?.customId
            : (receipt.payer.entityId?.customId || '-');

        const mDoc = new PDFDocument({ size: [PW, 1000], margin: MG });
        mDoc.font('Helvetica').fontSize(7);
        const descH = mDoc.heightOfString(desc, { width: CW - 4, lineBreak: true });
        mDoc.end();

        let ph = MG;
        ph += 9;                        // org full name
        ph += 7;                        // (TMJ)
        ph += 8;                        // address line 1
        ph += 8;                        // address line 2
        ph += 5;                        // hr
        ph += 10;                       // title
        ph += 5;                        // hr
        ph += LH * 4;                   // info rows
        ph += 5;                        // hr
        ph += 8;                        // Description label
        ph += descH + 3;                // description text
        if (period) ph += 8;            // period line
        ph += 5;                        // hr
        ph += 11;                       // amount line
        if (hasPartial) {
            ph += 5;                    // hr
            ph += LH;                   // total due
            if (balance > 0) ph += LH;  // balance
        }
        ph += 5;                        // hr
        ph += 14;                       // total line
        ph += 5;                        // hr
        ph += 11;                       // signature label + gap
        ph += 7;                        // signature line
        ph += 7;                        // print timestamp
        ph += MG;                       // bottom padding

        const doc = new PDFDocument({ size: [PW, ph], margin: MG });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Receipt-${receipt.receiptNo}.pdf`);

        doc.pipe(res);

        let y = MG;

        const hr = () => {
            doc.lineWidth(0.5).moveTo(MG, y).lineTo(PW - MG, y).strokeColor('#000').stroke();
            y += 5;
        };

        const row = (lbl, val) => {
            const lw = 36;
            doc.font('Helvetica-Bold').fontSize(7).fillColor('#000')
                .text(lbl, MG, y, { width: lw });
            doc.font('Helvetica').fontSize(7).fillColor('#000')
                .text((val || '-') + '', MG + lw, y, { width: CW - lw, align: 'right' });
            y += LH;
        };

        doc.font('Helvetica-Bold').fontSize(7).fillColor('#000')
            .text('THAYINERI MUSLIM JAMA-AT', MG, y, { width: CW, align: 'center' });
        y += 9;

        doc.font('Helvetica').fontSize(6).fillColor('#000')
            .text('(TMJ)', MG, y, { width: CW, align: 'center' });
        y += 7;

        doc.font('Helvetica').fontSize(5.5).fillColor('#000')
            .text('Thayineri Kara Road, Thayineri,', MG, y, { width: CW, align: 'center' });
        y += 8;

        doc.fontSize(5.5)
            .text('Kerala 670307 | Ph: +91 8129059992', MG, y, { width: CW, align: 'center' });
        y += 8;

        hr();

        doc.font('Helvetica-Bold').fontSize(8).fillColor('#000')
            .text(title, MG, y, { width: CW, align: 'center' });
        y += 10;

        hr();

        row('Receipt#:', receipt.receiptNo);
        row('Date:', new Date(receipt.date).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric'
        }));
        row('From:', payerName);
        row('House:', houseId);

        hr();

        doc.font('Helvetica-Bold').fontSize(7).fillColor('#000')
            .text('Description', MG, y);
        y += 8;

        doc.font('Helvetica').fontSize(7).fillColor('#000')
            .text(desc, MG + 3, y, { width: CW - 3, lineBreak: true });
        y += descH + 3;

        if (period) {
            doc.fontSize(6).fillColor('#000')
                .text(period, MG + 3, y, { width: CW - 3 });
            y += 8;
        }

        hr();

        doc.font('Helvetica-Bold').fontSize(7).fillColor('#000')
            .text('Amount', MG, y, { width: 36 });
        doc.font('Helvetica').fontSize(7).fillColor('#000')
            .text(Number(receipt.amount).toFixed(2), MG + 36, y, { width: CW - 36, align: 'right' });
        y += 11;

        if (hasPartial) {
            hr();

            doc.font('Helvetica').fontSize(7).fillColor('#000')
                .text('Total Due', MG, y, { width: 36 });
            doc.text(totalDue.toFixed(2), MG + 36, y, { width: CW - 36, align: 'right' });
            y += LH;

            if (balance > 0) {
                doc.font('Helvetica-Bold').fontSize(7).fillColor('#000')
                    .text('Balance', MG, y, { width: 36 });
                doc.text(balance.toFixed(2), MG + 36, y, { width: CW - 36, align: 'right' });
                y += LH;
            }
        }

        hr();

        doc.font('Helvetica-Bold').fontSize(9).fillColor('#000')
            .text('TOTAL', MG, y, { width: 48 });
        doc.text('Rs. ' + Number(receipt.amount).toFixed(2), MG + 48, y, { width: CW - 48, align: 'right' });
        y += 14;

        hr();

        doc.fontSize(5).fillColor('#000')
            .text('Printed: ' + new Date().toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true
            }), MG, y, { width: CW, align: 'center' });

        doc.end();

    } catch (error) {
        console.error(error);
        if (!res.headersSent) {
            res.status(500).json({ status: false, message: error.message });
        }
    }
};

// @desc    Get Print Data for Bluetooth Receipt Printer
// @route   GET /api/collections/receipts/:id/print
// @access  Public
const getCollectionPrintData = async (req, res) => {
    try {
        const receipt = await CollectionReceipt.findById(req.params.id)
            .populate({
                path: 'payer.entityId',
                select: 'name customId address phone'
            })
            .populate('dueId');

        if (!receipt) {
            return res.status(404).json({ status: false, message: 'Receipt not found' });
        }

        const isPartial = receipt.dueId?.status === 'PARTIAL';
        const title = isPartial ? 'PARTIAL PAYMENT RECEIPT' : 'COLLECTION RECEIPT';
        const desc = receipt.description || '';
        const period = receipt.dueId?.period || '';
        const totalDue = receipt.dueId?.amount || 0;
        const paidAmount = receipt.dueId?.paidAmount || 0;
        const balance = totalDue - paidAmount;
        const hasPartial = receipt.dueId && (receipt.dueId.frequency === 'Yearly' || receipt.dueId.status === 'PARTIAL');
        const payerName = receipt.payer.entityId?.name || receipt.payer.name || 'Unknown';
        const customId = receipt.payer.entityId?.customId || '-';
        const dateStr = new Date(receipt.date).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric'
        });
        const timeStr = new Date().toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
        });

        const lines = [
            { type: 0, content: "THAYINERI MUSLIM JAMA-AT", bold: 1, align: 1, format: 2 },
            { type: 0, content: "(TMJ)", bold: 1, align: 1, format: 0 },
            { type: 0, content: "Thayineri Kara Road, Thayineri,", bold: 0, align: 1, format: 0 },
            { type: 0, content: "Kerala 670307 | Ph: +91 8129059992", bold: 0, align: 1, format: 0 },
            { type: 0, content: " ", bold: 0, align: 0, format: 0 },
            { type: 0, content: title, bold: 1, align: 1, format: 0 },
            { type: 0, content: "--------------------------------", bold: 0, align: 0, format: 0 },
            { type: 0, content: `Receipt#: ${receipt.receiptNo}`, bold: 0, align: 0, format: 0 },
            { type: 0, content: `Date: ${dateStr}`, bold: 0, align: 0, format: 0 },
            { type: 0, content: `From: ${payerName}`, bold: 0, align: 0, format: 0 },
            { type: 0, content: `House: ${customId}`, bold: 0, align: 0, format: 0 },
            { type: 0, content: "--------------------------------", bold: 0, align: 0, format: 0 },
            { type: 0, content: "Description:", bold: 1, align: 0, format: 0 },
            { type: 0, content: desc, bold: 0, align: 0, format: 0 },
        ];

        if (period) {
            lines.push({ type: 0, content: `Period: ${period}`, bold: 0, align: 0, format: 0 });
        }

        lines.push({ type: 0, content: "--------------------------------", bold: 0, align: 0, format: 0 });
        lines.push({ type: 0, content: `Amount: Rs. ${Number(receipt.amount).toFixed(2)}`, bold: 0, align: 2, format: 0 });

        if (hasPartial) {
            lines.push({ type: 0, content: "--------------------------------", bold: 0, align: 0, format: 0 });
            lines.push({ type: 0, content: `Total Due: Rs. ${totalDue.toFixed(2)}`, bold: 0, align: 2, format: 0 });
            if (balance > 0) {
                lines.push({ type: 0, content: `Balance: Rs. ${balance.toFixed(2)}`, bold: 1, align: 2, format: 0 });
            }
        }

        lines.push(
            { type: 0, content: "--------------------------------", bold: 0, align: 0, format: 0 },
            { type: 0, content: `TOTAL: Rs. ${Number(receipt.amount).toFixed(2)}`, bold: 1, align: 2, format: 1 },
            { type: 0, content: "--------------------------------", bold: 0, align: 0, format: 0 },
            { type: 0, content: " ", bold: 0, align: 0, format: 0 },
            { type: 0, content: "Thank you!", bold: 1, align: 1, format: 0 },
            { type: 0, content: " ", bold: 0, align: 0, format: 0 },
            { type: 0, content: timeStr, bold: 0, align: 1, format: 0 },
        );

        const printDataObject = lines.reduce((acc, item, index) => {
            acc[index] = item;
            return acc;
        }, {});

        res.json(printDataObject);
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get Distinct Periods
// @route   GET /api/collections/periods
// @access  Public/Private
const getCollectionPeriods = async (req, res) => {
    try {
        const periods = await CollectionDue.distinct('period');
        // Sort periods logic (MM-YYYY or YYYY)
        // Simple alpha sort works for YYYY, but MM-YYYY needs customized sorting if accurate chronological order is needed.
        // For now, simple sort or descending.

        // Let's sort explicitly if standard date format
        // But since format is mixed, regular sort might suffice or customized.
        periods.sort().reverse();

        res.json({ status: true, data: periods });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Generate Dues in Bulk (Automation Trigger)
// @route   POST /api/collections/generate/bulk
// @access  Private/System
const generateBulkDues = async (req, res) => {
    try {
        const { entityType, period, frequency = 'Monthly' } = req.body;

        const { generatedCount, skippedCount, targetPeriod } = await generateBulkDuesInternal({
            entityType,
            period,
            frequency
        });

        res.json({
            status: true,
            message: `Bulk generation complete for ${targetPeriod} (${frequency})`,
            data: { generated: generatedCount, skipped: skippedCount, period: targetPeriod }
        });

    } catch (error) {
        console.error("Bulk Generation Error:", error);
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get Arrears Summary
// @route   GET /api/collections/arrears
// @access  Private
const getArrearsSummary = async (req, res) => {
    try {
        const { entityType } = req.query; // 'House' or 'Member'

        const match = { status: { $in: ['PENDING', 'PARTIAL'] } };
        if (entityType && entityType !== 'All') {
            match.entityType = entityType;
        }

        const arrears = await CollectionDue.aggregate([
            { $match: match },
            {
                $group: {
                    _id: { entityId: '$entityId', entityType: '$entityType' },
                    totalAmount: { $sum: { $subtract: ['$amount', '$paidAmount'] } },
                    pendingCount: { $sum: 1 },
                    periods: { $push: '$period' }
                }
            },
            {
                $lookup: {
                    from: 'houses',
                    localField: '_id.entityId',
                    foreignField: '_id',
                    as: 'houseInfo'
                }
            },
            {
                $lookup: {
                    from: 'members',
                    localField: '_id.entityId',
                    foreignField: '_id',
                    as: 'memberInfo'
                }
            },
            {
                $lookup: {
                    from: 'houses',
                    localField: 'memberInfo.house',
                    foreignField: '_id',
                    as: 'memberHouseInfo'
                }
            },
            {
                $project: {
                    entityId: '$_id.entityId',
                    entityType: '$_id.entityType',
                    totalAmount: 1,
                    pendingCount: 1,
                    periods: 1,
                    entity: {
                        $cond: [
                            { $eq: ['$_id.entityType', 'House'] },
                            { $arrayElemAt: ['$houseInfo', 0] },
                            {
                                $mergeObjects: [
                                    { $arrayElemAt: ['$memberInfo', 0] },
                                    { house: { $arrayElemAt: ['$memberHouseInfo', 0] } }
                                ]
                            }
                        ]
                    }
                }
            },
            { $sort: { totalAmount: -1 } }
        ]);

        res.json({ status: true, data: arrears });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Send Arrears Summary Reminder
// @route   POST /api/collections/remind/summary
// @access  Private
const sendArrearsReminder = async (req, res) => {
    try {
        const { entityId, entityType } = req.body;

        // 1. Get Arrears for this entity
        const dues = await CollectionDue.find({
            entityId,
            status: { $in: ['PENDING', 'PARTIAL'] }
        });

        if (dues.length === 0) {
            return res.status(400).json({ status: false, message: 'No pending dues found' });
        }

        const totalAmount = dues.reduce((sum, d) => sum + (d.amount - d.paidAmount), 0);
        const periodsList = dues.map(d => d.period).join(', ');

        // 2. Get Entity Info (to get WhatsApp number)
        const Model = entityType === 'House' ? House : Member;
        let entity;
        
        if (entityType === 'House') {
            entity = await Model.findById(entityId).populate('head');
        } else {
            entity = await Model.findById(entityId);
        }

        if (!entity) return res.status(404).json({ status: false, message: 'Entity not found' });

        const recipientName = entityType === 'House' ? entity.head?.name : entity.name;
        let recipientNumber = entityType === 'House' 
            ? (entity.head?.whatsapp || entity.head?.mobile)
            : (entity.whatsapp || entity.mobile);

        if (!recipientNumber) {
            return res.status(400).json({ status: false, message: 'No contact number found' });
        }

        // 3. Send WhatsApp
        const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
        const API_URL = process.env.WHATSAPP_API_URL;

        if (!WHATSAPP_TOKEN || !API_URL) {
            return res.status(500).json({ status: false, message: 'WhatsApp configuration missing' });
        }

        // Clean number
        let phone = recipientNumber.replace(/\D/g, '');
        if (phone.length === 10) phone = '91' + phone;

        const payload = {
            messaging_product: 'whatsapp',
            to: phone,
            type: 'template',
            template: {
                name: 'due_reminder_summary', 
                language: { code: 'ml' },
                components: [
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: recipientName || 'Recipient' },
                            { type: 'text', text: `₹${totalAmount}` },
                            { type: 'text', text: periodsList }
                        ]
                    },
                    {
                        type: 'button',
                        sub_type: 'url',
                        index: '0',
                        parameters: [
                            { type: 'text', text: (entityType === 'House' ? 'hou/' : 'mem/') + entityId }
                        ]
                    }
                ]
            }
        };

        await axios.post(API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        res.json({ status: true, message: 'Arrears reminder sent' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: error.message });
    }
};

const getPublicEntityDetails = async (req, res) => {
    try {
        const { type, id } = req.params;
        const isHouse = type === 'hou';

        if (isHouse) {
            const house = await House.findById(id)
                .populate('family', 'name customId')
                .populate('head', 'name customId mobile whatsapp');
            if (!house) return res.status(404).json({ status: false, message: 'House not found' });
            res.json({ status: true, data: house });
        } else {
            const member = await Member.findById(id)
                .populate('house', 'name customId')
                .populate('family', 'name customId');
            if (!member) return res.status(404).json({ status: false, message: 'Member not found' });
            res.json({ status: true, data: member });
        }
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

const getPublicEntityDues = async (req, res) => {
    try {
        const { type, id } = req.params;
        const entityType = type === 'hou' ? 'House' : 'Member';

        const dues = await CollectionDue.find({ entityId: id, entityType })
            .populate({
                path: 'entityId',
                select: 'name customId houseId',
                populate: { path: 'houseId', select: 'customId', strictPopulate: false }
            })
            .populate({
                path: 'transactions.receiptId',
                select: 'account receiptNo',
                populate: { path: 'account', select: 'name _id type' }
            })
            .sort({ createdAt: -1 });

        res.json({ status: true, data: dues });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export {
    updateSubscription,
    getDues,
    generateSingleDue,
    payDue,
    initiateRejection,
    confirmRejection,
    getCollectionReceipt,
    downloadCollectionReceiptPdf,
    getCollectionPrintData,
    getCollectionPeriods,
    generateBulkDues,
    getArrearsSummary,
    sendArrearsReminder,
    getPublicEntityDues,
    getPublicEntityDetails
};
