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
        if (due.entityType === 'House') {
            const h = await House.findById(due.entityId);
            payerInfo = {
                name: h ? `${h.name} (${h.customId})` : "House",
                entityType: 'House',
                entityId: due.entityId
            };
        } else {
            const m = await Member.findById(due.entityId);
            payerInfo = {
                name: m ? `${m.name} (${m.customId})` : "Member",
                entityType: 'Member',
                entityId: due.entityId
            };
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
            account.balance += Number(amount);
            await account.save();

            await AccountTransaction.create({
                account: account._id,
                type: 'INCOME',
                amount: Number(amount),
                balanceAfter: account.balance,
                date: date || new Date(),
                description: `Collection from ${payerInfo.name} - ${due.period} (${due.frequency})`,
                payment: null, // or link if needed
                collectionReceipt: receipt._id
            });
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

        // A5 Size: 420 x 595 points
        const doc = new PDFDocument({
            size: 'A5',
            margin: 40
        });

        // Stream to response
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Receipt-${receipt.receiptNo}.pdf`);

        doc.pipe(res);

        // === Configuration ===
        const MARGIN = 40;
        const PAGE_WIDTH = 420;
        const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);

        // Simple Black & White Color Scheme (Tally/Microsoft Style)
        const BLACK = '#000000';
        const DARK_GRAY = '#333333';
        const MEDIUM_GRAY = '#666666';
        const LIGHT_GRAY = '#999999';
        const BORDER_GRAY = '#cccccc';

        let y = MARGIN;

        // ==================== HEADER ====================

        // Organization Name - Bold & Centered
        doc.font('Helvetica-Bold')
            .fontSize(16)
            .fillColor(BLACK)
            .text('THAYINERI JUMA MASJID', MARGIN, y, {
                width: CONTENT_WIDTH,
                align: 'center'
            });
        y += 18;

        // Abbreviation
        doc.font('Helvetica')
            .fontSize(9)
            .fillColor(DARK_GRAY)
            .text('(TMJ)', MARGIN, y, {
                width: CONTENT_WIDTH,
                align: 'center'
            });
        y += 15;

        // Address
        doc.fontSize(8)
            .fillColor(MEDIUM_GRAY)
            .text('458X+XVH, Thayineri Road, Thrikaripur, Kerala 670307', MARGIN, y, {
                width: CONTENT_WIDTH,
                align: 'center'
            });
        y += 11;

        doc.text('Phone: +91 1234567898', MARGIN, y, {
            width: CONTENT_WIDTH,
            align: 'center'
        });
        y += 20;

        // Separator Line
        doc.lineWidth(1)
            .moveTo(MARGIN, y)
            .lineTo(PAGE_WIDTH - MARGIN, y)
            .strokeColor(BLACK)
            .stroke();
        y += 15;

        // ==================== RECEIPT TITLE ====================

        // Dynamic Title based on Payment Type
        const isPartial = receipt.dueId?.status === 'PARTIAL';
        const title = isPartial ? 'PARTIAL PAYMENT RECEIPT' : 'COLLECTION RECEIPT';

        doc.font('Helvetica-Bold')
            .fontSize(12)
            .fillColor(BLACK)
            .text(title, MARGIN, y, {
                width: CONTENT_WIDTH,
                align: 'center'
            });
        y += 20;

        // ==================== RECEIPT INFO TABLE ====================

        // Draw outer box
        const infoBoxTop = y;
        const infoBoxHeight = 65;
        doc.rect(MARGIN, infoBoxTop, CONTENT_WIDTH, infoBoxHeight)
            .lineWidth(1)
            .strokeColor(BLACK)
            .stroke();

        // Vertical divider in the middle
        const midX = MARGIN + (CONTENT_WIDTH / 2);
        doc.moveTo(midX, infoBoxTop)
            .lineTo(midX, infoBoxTop + infoBoxHeight)
            .stroke();

        // Left Section
        let infoY = infoBoxTop + 10;
        const leftLabelX = MARGIN + 8;
        const leftValueX = MARGIN + 70;

        doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK);

        // Receipt No
        doc.text('Receipt No:', leftLabelX, infoY);
        doc.font('Helvetica').text(receipt.receiptNo, leftValueX, infoY);
        infoY += 13;

        // Date
        doc.font('Helvetica-Bold').text('Date:', leftLabelX, infoY);
        doc.font('Helvetica').text(
            new Date(receipt.date).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            }),
            leftValueX,
            infoY
        );
        infoY += 13;

        // Day
        doc.font('Helvetica-Bold').text('Day:', leftLabelX, infoY);
        doc.font('Helvetica').text(
            new Date(receipt.date).toLocaleDateString('en-US', { weekday: 'long' }),
            leftValueX,
            infoY
        );

        // Right Section
        infoY = infoBoxTop + 10;
        const rightLabelX = midX + 8;
        const rightValueX = midX + 60;

        // Received From
        doc.font('Helvetica-Bold').text('From:', rightLabelX, infoY);
        const payerName = receipt.payer.entityId?.name || receipt.payer.name || 'Unknown';
        doc.font('Helvetica').text(payerName, rightValueX, infoY, {
            width: (PAGE_WIDTH - MARGIN - rightValueX - 8),
            lineBreak: true
        });
        infoY += 13;

        // House ID
        doc.font('Helvetica-Bold').text('House ID:', rightLabelX, infoY);
        const houseId = receipt.payer.entityType === 'House'
            ? receipt.payer.entityId?.customId
            : (receipt.payer.entityId?.customId || '-');
        doc.font('Helvetica').text(houseId || '-', rightValueX, infoY);

        y = infoBoxTop + infoBoxHeight + 15;

        // ==================== DETAILS TABLE ====================

        const tableTop = y;
        const colDescX = MARGIN;
        const colDescWidth = CONTENT_WIDTH * 0.65;
        const colAmountX = MARGIN + colDescWidth;
        const colAmountWidth = CONTENT_WIDTH * 0.35;
        const rowHeight = 22;

        // Table Header
        doc.rect(MARGIN, tableTop, CONTENT_WIDTH, rowHeight)
            .lineWidth(1)
            .strokeColor(BLACK)
            .fillAndStroke(BLACK, BLACK);

        doc.font('Helvetica-Bold')
            .fontSize(9)
            .fillColor('#FFFFFF')
            .text('Description', colDescX + 8, tableTop + 7, {
                width: colDescWidth - 16,
                align: 'left'
            })
            .text('Amount (Rs.)', colAmountX + 8, tableTop + 7, {
                width: colAmountWidth - 16,
                align: 'right'
            });

        let tableY = tableTop + rowHeight;

        // Details Row
        const descriptionText = receipt.description;
        const periodText = receipt.dueId?.period ? `Period: ${receipt.dueId.period}` : '';

        // Calculate row height based on content
        const descLines = doc.heightOfString(descriptionText, {
            width: colDescWidth - 16,
            lineBreak: true
        });
        const detailRowHeight = Math.max(descLines + (periodText ? 12 : 0) + 12, 35);

        // Draw detail row border
        doc.rect(MARGIN, tableY, CONTENT_WIDTH, detailRowHeight)
            .lineWidth(1)
            .strokeColor(BLACK)
            .stroke();

        // Vertical line between columns
        doc.moveTo(colAmountX, tableY)
            .lineTo(colAmountX, tableY + detailRowHeight)
            .stroke();

        // Description text
        doc.fillColor(BLACK)
            .font('Helvetica')
            .fontSize(9)
            .text(descriptionText, colDescX + 8, tableY + 8, {
                width: colDescWidth - 16,
                lineBreak: true
            });

        // Period sub-text
        if (periodText) {
            doc.fontSize(7)
                .fillColor(MEDIUM_GRAY)
                .text(periodText, colDescX + 8, tableY + descLines + 10, {
                    width: colDescWidth - 16
                });
        }

        // Amount
        doc.font('Helvetica')
            .fontSize(10)
            .fillColor(BLACK)
            .text(
                Number(receipt.amount).toFixed(2),
                colAmountX + 8,
                tableY + 8,
                {
                    width: colAmountWidth - 16,
                    align: 'right'
                }
            );

        tableY += detailRowHeight;

        // --- PARTIAL PAYMENT DETAILS & BALANCE ---
        if (receipt.dueId && (receipt.dueId.frequency === 'Yearly' || receipt.dueId.status === 'PARTIAL')) {
            const totalAmount = receipt.dueId.amount;
            const paidTotal = receipt.dueId.paidAmount; // This includes THIS receipt usually, check backend logic
            const balance = totalAmount - paidTotal;

            // Only show if there is useful info (e.g. balance > 0 or it was a partial payment)

            // Total Due Row (Plain)
            doc.rect(MARGIN, tableY, CONTENT_WIDTH, rowHeight)
                .strokeColor(BLACK)
                .stroke();

            // Vertical line
            doc.moveTo(colAmountX, tableY).lineTo(colAmountX, tableY + rowHeight).stroke();

            doc.font('Helvetica').fontSize(9).fillColor(MEDIUM_GRAY)
                .text('Total Due Amount', colDescX + 20, tableY + 6)
                .text(`Rs. ${totalAmount.toFixed(2)}`, colAmountX + 8, tableY + 6, { align: 'right', width: colAmountWidth - 16 });

            tableY += rowHeight;

            // Balance Row (Bold if balance exists)
            if (balance >= 0) {
                doc.rect(MARGIN, tableY, CONTENT_WIDTH, rowHeight)
                    .strokeColor(BLACK)
                    .stroke();
                // Vertical line
                doc.moveTo(colAmountX, tableY).lineTo(colAmountX, tableY + rowHeight).stroke();

                doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
                    .text('Balance Due', colDescX + 20, tableY + 6)
                    .text(`Rs. ${balance.toFixed(2)}`, colAmountX + 8, tableY + 6, { align: 'right', width: colAmountWidth - 16 });

                tableY += rowHeight;
            }
        }
        // -----------------------------------------

        // Total Row
        doc.rect(MARGIN, tableY, CONTENT_WIDTH, rowHeight)
            .lineWidth(1)
            .strokeColor(BLACK)
            .fillAndStroke('#f0f0f0', BLACK);

        // Vertical line
        doc.strokeColor(BLACK)
            .moveTo(colAmountX, tableY)
            .lineTo(colAmountX, tableY + rowHeight)
            .stroke();

        doc.font('Helvetica-Bold')
            .fontSize(10)
            .fillColor(BLACK)
            .text('Total Amount', colDescX + 8, tableY + 6, {
                width: colDescWidth - 16,
                align: 'left'
            })
            .text(
                `Rs. ${Number(receipt.amount).toFixed(2)}`,
                colAmountX + 8,
                tableY + 6,
                {
                    width: colAmountWidth - 16,
                    align: 'right'
                }
            );

        y = tableY + rowHeight + 30;

        // ==================== FOOTER ====================

        // Signature line
        const sigLineY = 500;
        const sigLineWidth = 100;
        const sigLineX = PAGE_WIDTH - MARGIN - sigLineWidth;

        doc.fontSize(7)
            .fillColor(MEDIUM_GRAY)
            .font('Helvetica')
            .text('Authorized Signature', sigLineX, sigLineY, {
                width: sigLineWidth,
                align: 'center'
            });

        doc.lineWidth(0.5)
            .moveTo(sigLineX, sigLineY + 25)
            .lineTo(sigLineX + sigLineWidth, sigLineY + 25)
            .strokeColor(BORDER_GRAY)
            .stroke();

        // Bottom separator
        const footerLineY = 530;
        doc.lineWidth(0.5)
            .moveTo(MARGIN, footerLineY)
            .lineTo(PAGE_WIDTH - MARGIN, footerLineY)
            .strokeColor(BORDER_GRAY)
            .stroke();

        // Generated timestamp
        doc.fontSize(6)
            .fillColor(LIGHT_GRAY)
            .text(
                `Generated on ${new Date().toLocaleString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                })}`,
                MARGIN,
                footerLineY + 8,
                {
                    width: CONTENT_WIDTH,
                    align: 'center'
                }
            );

        doc.end();

    } catch (error) {
        console.error(error);
        if (!res.headersSent) {
            res.status(500).json({ status: false, message: error.message });
        }
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
                            { $arrayElemAt: ['$memberInfo', 0] }
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
                .populate('head', 'name customId phone');
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
    getCollectionPeriods,
    generateBulkDues,
    getArrearsSummary,
    sendArrearsReminder,
    getPublicEntityDues,
    getPublicEntityDetails
};
