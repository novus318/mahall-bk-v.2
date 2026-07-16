import mongoose from 'mongoose';
import Receipt from '../models/Receipt.js';
import ReceiptCategory from '../models/ReceiptCategory.js';
import RentDue from '../models/RentDue.js';
import SystemSettings from '../models/SystemSettings.js';
import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import PDFDocument from 'pdfkit';

// --- Categories ---

export const getReceiptCategories = async (req, res) => {
    try {
        const categories = await ReceiptCategory.find({ status: 'ACTIVE' });
        res.json({ status: true, data: categories });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export const createReceiptCategory = async (req, res) => {
    try {
        const { name, description } = req.body;

        // Check if category exists (even inactive)
        const existingCategory = await ReceiptCategory.findOne({ name });

        if (existingCategory) {
            if (existingCategory.status === 'INACTIVE') {
                // Reactivate
                existingCategory.status = 'ACTIVE';
                existingCategory.description = description || existingCategory.description;
                await existingCategory.save();
                return res.status(200).json({ status: true, data: existingCategory, message: 'Category restored' });
            } else {
                return res.status(400).json({ status: false, message: 'Category already exists' });
            }
        }

        const category = await ReceiptCategory.create({ name, description });
        res.status(201).json({ status: true, data: category });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export const updateReceiptCategory = async (req, res) => {
    try {
        const { name, description } = req.body;
        const category = await ReceiptCategory.findByIdAndUpdate(
            req.params.id,
            { name, description },
            { new: true }
        );
        res.json({ status: true, data: category });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export const deleteReceiptCategory = async (req, res) => {
    try {
        await ReceiptCategory.findByIdAndUpdate(req.params.id, { status: 'INACTIVE' });
        res.json({ status: true, message: 'Category removed' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// --- Receipts ---

export const getReceipts = async (req, res) => {
    try {
        const { page = 1, limit = 20, search } = req.query;
        const query = {};

        if (search) {
            query.$or = [
                { receiptNo: { $regex: search, $options: 'i' } },
                { payer: { $regex: search, $options: 'i' } }
            ];
        }

        const count = await Receipt.countDocuments(query);
        const receipts = await Receipt.find(query)
            .populate('category', 'name')
            .populate('account', 'name')
            .populate('createdBy', 'name')
            .sort({ date: -1, createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        res.json({
            status: true,
            data: receipts,
            totalPages: Math.ceil(count / limit),
            currentPage: Number(page),
            totalCount: count
        });

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
}


export const getReceiptById = async (req, res) => {
    try {
        const receipt = await Receipt.findById(req.params.id)
            .populate('category', 'name')
            .populate('account', 'name')
            .populate('createdBy', 'name'); // Useful for signature

        if (!receipt) return res.status(404).json({ status: false, message: 'Receipt not found' });

        res.json({ status: true, data: receipt });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export const createReceipt = async (req, res) => {
    try {
        const { date, accountId, categoryId, payer, payerContact, items, description } = req.body; // Added payerContact

        // 1. Calculate Total
        const totalAmount = items.reduce((sum, item) => sum + Number(item.amount), 0);

        if (totalAmount <= 0) {
            return res.status(400).json({ status: false, message: 'Total amount must be greater than 0' });
        }

        // 2. Check Account
        const account = await Account.findById(accountId);
        if (!account) {
            return res.status(404).json({ status: false, message: 'Account not found' });
        }

        // 3. Generate Receipt Number
        let settings = await SystemSettings.findOne();
        if (!settings) settings = await SystemSettings.create({});
        if (!settings.incomeSettings) settings.incomeSettings = {};

        let { receiptPrefix = 'RC-', receiptCurrentNumber = 1, receiptSequenceLimit = 999 } = settings.incomeSettings;
        let receiptNo = '';
        let isUnique = false;

        while (!isUnique) {
            receiptNo = `${receiptPrefix}${String(receiptCurrentNumber).padStart(3, '0')}`;

            const existing = await Receipt.findOne({ receiptNo });
            if (!existing) {
                isUnique = true;
            } else {
                if (receiptCurrentNumber >= receiptSequenceLimit) {
                    const prefixBase = receiptPrefix.replace(/-$/, '');
                    let lastChar = prefixBase.slice(-1);
                    let rest = prefixBase.slice(0, -1);
                    let nextChar = String.fromCharCode(lastChar.charCodeAt(0) + 1);
                    if (nextChar > 'Z') nextChar = 'A';
                    receiptPrefix = `${rest}${nextChar}-`;
                    receiptCurrentNumber = 1;
                } else {
                    receiptCurrentNumber++;
                }
            }
        }

        // Save Next Number State
        let nextNum = receiptCurrentNumber + 1;
        let nextPrefix = receiptPrefix;

        if (nextNum > receiptSequenceLimit) {
            const prefixBase = receiptPrefix.replace(/-$/, '');
            let lastChar = prefixBase.slice(-1);
            let rest = prefixBase.slice(0, -1);
            let nextChar = String.fromCharCode(lastChar.charCodeAt(0) + 1);
            if (nextChar > 'Z') nextChar = 'A';
            nextPrefix = `${rest}${nextChar}-`;
            nextNum = 1;
        }

        settings.incomeSettings.receiptPrefix = nextPrefix;
        settings.incomeSettings.receiptCurrentNumber = nextNum;
        await settings.save();

        // 4. Create Receipt
        const receipt = await Receipt.create({
            receiptNo,
            date: date || new Date(),
            account: accountId,
            category: categoryId,
            payer,
            payerContact, // Added
            items,
            amount: totalAmount,
            description,
            createdBy: req.user._id
        });

        // 5. Update Account Balance (ADD Money)
        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            account.balance += totalAmount;
            await account.save({ session });

            await AccountTransaction.create([{
                account: account._id,
                relatedAccount: null,
                receipt: receipt._id,
                type: 'INCOME',
                amount: totalAmount,
                balanceAfter: account.balance,
                date: receipt.date,
                description: `Receipt ${receiptNo} from ${payer}`
            }], { session });

            await session.commitTransaction();
        } catch (txnError) {
            await session.abortTransaction();
            throw txnError;
        } finally {
            session.endSession();
        }

        res.status(201).json({ status: true, data: receipt, message: 'Receipt created successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: error.message });
    }
};

export const updateReceipt = async (req, res) => {
    try {
        const { id } = req.params;
        const { date, accountId, categoryId, payer, payerContact, items, description } = req.body; // Added payerContact

        const receipt = await Receipt.findById(id);
        if (!receipt) return res.status(404).json({ status: false, message: 'Receipt not found' });

        const originalAmount = receipt.amount;
        const originalAccountId = receipt.account;
        const newTotalAmount = items.reduce((sum, item) => sum + Number(item.amount), 0);

        // Robust Date Parsing with Time Preservation
        let newDate = receipt.date;
        if (date) {
            // Create date object from input (usually 00:00:00)
            const inputDate = new Date(date);

            // Use current time for the effective date
            const now = new Date();
            inputDate.setHours(now.getHours());
            inputDate.setMinutes(now.getMinutes());
            inputDate.setSeconds(now.getSeconds());
            inputDate.setMilliseconds(now.getMilliseconds());

            newDate = inputDate;
        }

        if (newTotalAmount <= 0) return res.status(400).json({ status: false, message: 'Total amount must be greater than 0' });

        // 1. Handle Account & Financial Changes
        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            if (String(originalAccountId) === String(accountId)) {
                const account = await Account.findById(originalAccountId).session(session);
                const newBalance = account.balance - originalAmount + newTotalAmount;

                if (newBalance < 0) {
                    await session.abortTransaction();
                    return res.status(400).json({
                        status: false,
                        message: `Insufficient balance to adjust receipt (Available: ₹${account.balance})`
                    });
                }

                account.balance = newBalance;
                await account.save({ session });

                await AccountTransaction.findOneAndUpdate(
                    { receipt: receipt._id },
                    {
                        amount: newTotalAmount,
                        date: newDate,
                        balanceAfter: account.balance,
                        description: `Receipt ${receipt.receiptNo} from ${payer}`
                    },
                    { session }
                );
            } else {
                const oldAccount = await Account.findById(originalAccountId).session(session);
                if (oldAccount.balance < originalAmount) {
                    await session.abortTransaction();
                    return res.status(400).json({
                        status: false,
                        message: `Insufficient balance in original account to reverse (Available: ₹${oldAccount.balance}, Required: ₹${originalAmount})`
                    });
                }

                oldAccount.balance -= originalAmount;
                await oldAccount.save({ session });

                await AccountTransaction.findOneAndDelete(
                    { receipt: receipt._id },
                    { session }
                );

                const newAccount = await Account.findById(accountId).session(session);
                newAccount.balance += newTotalAmount;
                await newAccount.save({ session });

                await AccountTransaction.create([{
                    account: newAccount._id,
                    receipt: receipt._id,
                    type: 'INCOME',
                    amount: newTotalAmount,
                    balanceAfter: newAccount.balance,
                    date: newDate,
                    description: `Receipt ${receipt.receiptNo} from ${payer}`
                }], { session });
            }

            await session.commitTransaction();
        } catch (txnError) {
            await session.abortTransaction();
            throw txnError;
        } finally {
            session.endSession();
        }

        // 2. Update Receipt Record
        receipt.date = newDate;
        receipt.account = accountId;
        receipt.category = categoryId;
        receipt.payer = payer;
        receipt.payerContact = payerContact; // Added
        receipt.items = items;
        receipt.amount = newTotalAmount;
        receipt.description = description;

        await receipt.save();

        res.json({ status: true, data: receipt, message: 'Receipt updated successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Download Receipt Voucher PDF
// @route   GET /api/receipts/:id/pdf
export const downloadReceiptPdf = async (req, res) => {
    try {
        const receipt = await Receipt.findById(req.params.id)
            .populate('category', 'name')
            .populate('account', 'name');

        if (!receipt) return res.status(404).json({ status: false, message: 'Receipt not found' });

        // Check if this receipt is linked to a rent due (for partial payment info)
        const rentDue = await RentDue.findOne({ 'transactions.receipt': receipt._id }).select('amount collectedAmount status monthYear');

        const isPartial = rentDue?.status === 'PARTIAL';
        const title = isPartial ? 'PARTIAL PAYMENT RECEIPT' : 'OFFICIAL RECEIPT';
        const totalDue = rentDue?.amount || 0;
        const balance = rentDue ? (totalDue - (rentDue.collectedAmount || 0)) : 0;

        const PW = 144;
        const MG = 6;
        const CW = PW - MG * 2;
        const LH = 10;

        // Measure description height first
        const desc = receipt.description || '';
        const mDoc = new PDFDocument({ size: [PW, 1000], margin: MG });
        mDoc.font('Helvetica').fontSize(7);
        const descH = mDoc.heightOfString(desc, { width: CW - 2, lineBreak: true });
        mDoc.end();

        // Calculate total page height
        let ph = MG;
        ph += 9;                        // org full name
        ph += 7;                        // (TMJ)
        ph += 8;                        // address line 1
        ph += 8;                        // address line 2
        ph += 5;                        // hr
        ph += 10;                       // title
        ph += 5;                        // hr
        ph += LH * 4;                   // receipt#, date, from, info rows
        ph += 5;                        // hr
        ph += 8;                        // Description label
        ph += descH + 3;                // description text
        ph += 5;                        // hr
        ph += 11;                       // amount
        if (isPartial) {
            ph += 5;                    // hr
            ph += LH;                   // total due
            if (balance > 0) ph += LH;  // balance
        }
        ph += 5;                        // hr
        ph += 14;                       // total row
        ph += 5;                        // hr
        ph += 7;                        // print timestamp
        ph += MG;

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
        row('From:', receipt.payer);
        row('Contact:', receipt.payerContact || '-');

        hr();

        doc.font('Helvetica-Bold').fontSize(7).fillColor('#000')
            .text('Description', MG, y);
        y += 8;

        doc.font('Helvetica').fontSize(7).fillColor('#000')
            .text(desc, MG + 2, y, { width: CW - 2, lineBreak: true });
        y += descH + 3;

        hr();

        doc.font('Helvetica-Bold').fontSize(7).fillColor('#000')
            .text('Amount', MG, y, { width: 36 });
        doc.font('Helvetica').fontSize(7).fillColor('#000')
            .text(Number(receipt.amount).toFixed(2), MG + 36, y, { width: CW - 36, align: 'right' });
        y += 11;

        if (isPartial) {
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
        if (!res.headersSent) res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get Thermal Print Data for Income Receipt
// @route   GET /api/print/inc/:id
export const getIncomePrintData = async (req, res) => {
    try {
        const receipt = await Receipt.findById(req.params.id)
            .populate('category')
            .populate('account');

        if (!receipt) {
            return res.status(404).json({ status: false, message: 'Receipt not found' });
        }

        const timeStr = new Date().toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
        });

        const dateStr = new Date(receipt.date).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric'
        });

        const desc = receipt.description || '';
        const items = receipt.items || [];
        const payerContact = receipt.payerContact ? `Ph: ${receipt.payerContact}` : '';

        const lines = [
            { type: 0, content: "THAYINERI MUSLIM JAMA-AT", bold: 1, align: 1, format: 2 },
            { type: 0, content: "(TMJ)", bold: 1, align: 1, format: 0 },
            { type: 0, content: "Thayineri Kara Road, Thayineri,", bold: 0, align: 1, format: 0 },
            { type: 0, content: "Kerala 670307 | Ph: +91 8129059992", bold: 0, align: 1, format: 0 },
            { type: 0, content: " ", bold: 0, align: 0, format: 0 },
            { type: 0, content: "INCOME RECEIPT", bold: 1, align: 1, format: 0 },
            { type: 0, content: "--------------------------------", bold: 0, align: 0, format: 0 },
            { type: 0, content: `Receipt#: ${receipt.receiptNo}`, bold: 0, align: 0, format: 0 },
            { type: 0, content: `Date: ${dateStr}`, bold: 0, align: 0, format: 0 },
            { type: 0, content: `Received From: ${receipt.payer}`, bold: 0, align: 0, format: 0 },
            ...(payerContact ? [{ type: 0, content: payerContact, bold: 0, align: 0, format: 0 }] : []),
            ...(receipt.category ? [{ type: 0, content: `Category: ${receipt.category.name}`, bold: 0, align: 0, format: 0 }] : []),
            { type: 0, content: "--------------------------------", bold: 0, align: 0, format: 0 },
        ];

        if (desc) {
            lines.push(
                { type: 0, content: "Description:", bold: 1, align: 0, format: 0 },
                { type: 0, content: desc, bold: 0, align: 0, format: 0 },
                { type: 0, content: "--------------------------------", bold: 0, align: 0, format: 0 },
            );
        }

        if (items.length > 0) {
            lines.push({ type: 0, content: "Items:", bold: 1, align: 0, format: 0 });
            items.forEach(item => {
                lines.push({ type: 0, content: `${item.description}: Rs. ${Number(item.amount).toFixed(2)}`, bold: 0, align: 2, format: 0 });
            });
            lines.push({ type: 0, content: "--------------------------------", bold: 0, align: 0, format: 0 });
        }

        lines.push(
            { type: 0, content: `Amount: Rs. ${Number(receipt.amount).toFixed(2)}`, bold: 0, align: 2, format: 0 },
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
