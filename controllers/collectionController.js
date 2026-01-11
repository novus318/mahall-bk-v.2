import House from '../models/House.js';
import Member from '../models/Member.js';
import CollectionDue from '../models/CollectionDue.js';
import CollectionReceipt from '../models/CollectionReceipt.js';
import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import SystemSettings from '../models/SystemSettings.js';
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';

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

        // A5 Size: ~420 x 595 points
        const doc = new PDFDocument({ size: 'A5', margin: 30 }); // Smaller margin for A5

        // Stream to response
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Receipt-${receipt.receiptNo}.pdf`);

        doc.pipe(res);

        // --- PDF Content ---

        // Config
        const startX = 30;
        const endX = 390; // 420 - 30
        const contentWidth = endX - startX;
        const centerX = 210;

        // Header
        // doc.image('path/to/logo.png', startX, 30, { width: 40 }); // Placeholder

        doc.font('Helvetica-Bold').fontSize(16).fillColor('#15803d').text('VKJ', { align: 'center' });
        doc.fontSize(9).fillColor('#334155').text('VELLAP KHADIMUL ISLAM IAMA-ATH', { align: 'center' });
        doc.moveDown(0.3);

        doc.fontSize(7).fillColor('black').text('Reg. No: 1/88 K.W.B. Reg.No.A2/135/RA', { align: 'center' });
        doc.text('VELLAP, P.O. TRIKARIPUR-671310, KASARGOD DIST', { align: 'center' });
        doc.text('Phone: +91 9876543210', { align: 'center' });

        doc.moveDown(0.8);
        doc.lineWidth(0.5).moveTo(startX, doc.y).lineTo(endX, doc.y).strokeColor('#e2e8f0').stroke();
        doc.moveDown(1);

        // Info Grid
        const gridY = doc.y;
        doc.fillColor('black');

        // Left Column (MetaData)
        doc.fontSize(9);
        const labelX = startX;
        const valueX = startX + 50;

        doc.font('Helvetica-Bold').text('Date:', labelX, gridY);
        doc.font('Helvetica').text(new Date(receipt.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), valueX, gridY);

        doc.font('Helvetica-Bold').text('Day:', labelX, gridY + 12);
        doc.font('Helvetica').text(new Date(receipt.date).toLocaleDateString('en-US', { weekday: 'long' }), valueX, gridY + 12);

        doc.font('Helvetica-Bold').text('From:', labelX, gridY + 30);
        const payerName = receipt.payer.entityId?.name || receipt.payer.name || 'Unknown';
        doc.font('Helvetica').text(payerName, valueX, gridY + 30);

        doc.font('Helvetica-Bold').text('House:', labelX, gridY + 42);
        const houseId = receipt.payer.entityType === 'House' ? receipt.payer.entityId?.customId : (receipt.payer.entityId?.customId || '-');
        doc.font('Helvetica').text(houseId || '-', valueX, gridY + 42);

        // Right Column (Receipt No)
        doc.font('Helvetica-Bold').text('Receipt No:', 260, gridY);
        doc.font('Helvetica').text(receipt.receiptNo, 320, gridY);

        doc.moveDown(5); // Space before table

        // Details Table
        doc.font('Helvetica-Bold').fontSize(10).text('Details:', startX);
        doc.moveDown(0.3);

        const tableTop = doc.y;
        const rowHeight = 20;

        // Header Background
        doc.rect(startX, tableTop, contentWidth, rowHeight).fill('#f8fafc');
        doc.fillColor('black');

        // Header Text
        const descX = startX + 10;
        const amountX = endX - 70;
        const amountWidth = 60;

        doc.fontSize(8);
        doc.text('Description', descX, tableTop + 6);
        doc.text('Amount', amountX, tableTop + 6, { width: amountWidth, align: 'right' });

        // Divider
        doc.moveTo(startX, tableTop + rowHeight).lineTo(endX, tableTop + rowHeight).strokeColor('#cbd5e1').stroke();

        // Rows
        let currentY = tableTop + rowHeight + 8;

        // Description
        doc.font('Helvetica').fillColor('black').text(receipt.description, descX, currentY, { width: 240, align: 'left' });

        // Sub-description details
        if (receipt.dueId) {
            const textHeight = doc.heightOfString(receipt.description, { width: 240 });
            doc.fontSize(7).fillColor('#64748b').text(`Period: ${receipt.dueId.period}`, descX, currentY + textHeight + 2);
            // Move Y down to accommodate multiple lines
            // But for simplicy in this layout, we just let it flow. Amount is on top line usually.
        }

        // Amount
        doc.fontSize(9).font('Helvetica-Bold').fillColor('black').text(Number(receipt.amount).toFixed(2), amountX, currentY, { width: amountWidth, align: 'right' });

        // Calculate bottom of row roughly
        const descHeight = doc.heightOfString(receipt.description, { width: 240 });
        const rowBottom = currentY + descHeight + 15; // Padding

        // Bottom Divider
        doc.moveTo(startX, rowBottom).lineTo(endX, rowBottom).strokeColor('#cbd5e1').stroke();

        // Total Row
        const totalTop = rowBottom;
        doc.rect(startX, totalTop, contentWidth, 25).fill('#f8fafc');
        doc.fillColor('black').fontSize(9).font('Helvetica-Bold');
        doc.text('Total', descX, totalTop + 8);
        doc.text(`Rs. ${Number(receipt.amount).toFixed(2)}`, amountX, totalTop + 8, { width: amountWidth, align: 'right' });

        // Outer Border
        doc.rect(startX, tableTop, contentWidth, (totalTop + 25) - tableTop).strokeColor('#cbd5e1').stroke();

        // Footer
        const footerY = totalTop + 60;
        doc.fontSize(9).fillColor('#334155').font('Helvetica-Bold');
        doc.text('Regards,', startX, footerY);
        doc.text('VKJ', startX, footerY + 12);

        // Optional: Timestamp or generated by
        doc.fontSize(6).fillColor('#94a3b8').font('Helvetica');
        doc.text(`Generated on ${new Date().toLocaleString()}`, startX, 550, { align: 'center', width: contentWidth });

        doc.end();

    } catch (error) {
        console.error(error);
        if (!res.headersSent) {
            res.status(500).json({ status: false, message: error.message });
        }
    }
};

export { updateSubscription, getDues, generateSingleDue, payDue, initiateRejection, confirmRejection, getCollectionReceipt, downloadCollectionReceiptPdf };
