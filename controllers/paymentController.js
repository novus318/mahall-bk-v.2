import mongoose from 'mongoose';
import Payment from '../models/Payment.js';
import PaymentCategory from '../models/PaymentCategory.js';
import SystemSettings from '../models/SystemSettings.js';
import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import PDFDocument from 'pdfkit';
import { sendPaymentAlert } from './settingsController.js';

// --- Categories ---

export const getPaymentCategories = async (req, res) => {
    try {
        const categories = await PaymentCategory.find({ status: 'ACTIVE' });
        res.json({ status: true, data: categories });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export const createPaymentCategory = async (req, res) => {
    try {
        const { name, description } = req.body;

        // Check if category exists (even inactive)
        const existingCategory = await PaymentCategory.findOne({ name });

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

        const category = await PaymentCategory.create({ name, description });
        res.status(201).json({ status: true, data: category });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export const updatePaymentCategory = async (req, res) => {
    try {
        const { name, description } = req.body;
        const category = await PaymentCategory.findByIdAndUpdate(
            req.params.id,
            { name, description },
            { new: true }
        );
        res.json({ status: true, data: category });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export const deletePaymentCategory = async (req, res) => {
    try {
        await PaymentCategory.findByIdAndUpdate(req.params.id, { status: 'INACTIVE' });
        res.json({ status: true, message: 'Category removed' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// --- Payments ---

export const getPayments = async (req, res) => {
    try {
        const { page = 1, limit = 20, search, status } = req.query;
        const query = {};

        if (search) {
            query.$or = [
                { receiptNo: { $regex: search, $options: 'i' } },
                { payee: { $regex: search, $options: 'i' } }
            ];
        }

        // Filter by status if provided
        if (status) {
            query.status = status;
        }

        const count = await Payment.countDocuments(query);
        const payments = await Payment.find(query)
            .populate('category', 'name')
            .populate('account', 'name')
            .populate('createdBy', 'name')
            .sort({ date: -1, createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        res.json({
            status: true,
            data: payments,
            totalPages: Math.ceil(count / limit),
            currentPage: Number(page),
            totalCount: count
        });

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
}


export const getPaymentById = async (req, res) => {
    try {
        const payment = await Payment.findById(req.params.id)
            .populate('category', 'name')
            .populate('account', 'name');

        if (!payment) return res.status(404).json({ status: false, message: 'Payment not found' });

        res.json({ status: true, data: payment });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export const createPayment = async (req, res) => {
    try {
        const { date, accountId, categoryId, payee, payeeContact, items, description, isPaid } = req.body;

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

        // 3. Determine payment status
        const paymentStatus = isPaid === true ? 'COMPLETED' : 'PENDING';
        const paidAt = isPaid === true ? new Date() : null;

        // 4. Generate Receipt & Update Settings
        let settings = await SystemSettings.findOne();
        if (!settings) settings = await SystemSettings.create({});
        if (!settings.paymentSettings) settings.paymentSettings = {};

        let { receiptPrefix = 'PA-', receiptCurrentNumber = 1, receiptSequenceLimit = 999 } = settings.paymentSettings;
        let receiptNo = '';
        let isUnique = false;

        while (!isUnique) {
            receiptNo = `${receiptPrefix}${String(receiptCurrentNumber).padStart(3, '0')}`;

            const existing = await Payment.findOne({ receiptNo });
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

        settings.paymentSettings.receiptPrefix = nextPrefix;
        settings.paymentSettings.receiptCurrentNumber = nextNum;
        await settings.save();

        // 5. Create Payment with status
        const payment = await Payment.create({
            receiptNo,
            date: date || new Date(),
            paymentDate: date || new Date(),
            account: accountId,
            category: categoryId,
            payee,
            payeeContact,
            items,
            amount: totalAmount,
            totalAmount,
            description,
            notes: description,
            type: 'EXPENSE',
            status: paymentStatus,
            paidAt,
            createdBy: req.user._id
        });

        // 6. Only update account balance and create transaction if payment is completed
        if (paymentStatus === 'COMPLETED') {
            if (account.balance < totalAmount) {
                return res.status(400).json({
                    status: false,
                    message: `Insufficient account balance (Available: ₹${account.balance}, Required: ₹${totalAmount})`
                });
            }

            const session = await mongoose.startSession();
            try {
                session.startTransaction();
                account.balance -= totalAmount;
                await account.save({ session });

                await AccountTransaction.create([{
                    account: account._id,
                    relatedAccount: null,
                    payment: payment._id,
                    type: 'EXPENSE',
                    amount: totalAmount,
                    balanceAfter: account.balance,
                    date: payment.date,
                    description: `Payment ${receiptNo} to ${payee}`
                }], { session });

                await session.commitTransaction();
            } catch (txnError) {
                await session.abortTransaction();
                throw txnError;
            } finally {
                session.endSession();
            }
        }

        await sendPaymentAlert(payment, 'CREATE');

        const statusMessage = paymentStatus === 'COMPLETED' 
            ? 'Payment created and completed successfully' 
            : 'Payment created successfully (Pending)';

        res.status(201).json({ status: true, data: payment, message: statusMessage });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: error.message });
    }
};

export const updatePayment = async (req, res) => {
    try {
        const { id } = req.params;
        const { date, accountId, categoryId, payee, payeeContact, items, description } = req.body;

        const payment = await Payment.findById(id);
        if (!payment) return res.status(404).json({ status: false, message: 'Payment not found' });

        if (payment.status === 'DELETED') {
            return res.status(400).json({ status: false, message: 'Cannot edit a deleted payment.' });
        }

        const originalAmount = payment.amount;
        const originalAccountId = payment.account;
        const newTotalAmount = items.reduce((sum, item) => sum + Number(item.amount), 0);

        let newDate = payment.date;
        if (date) {
            const inputDate = new Date(date);
            const now = new Date();
            inputDate.setHours(now.getHours());
            inputDate.setMinutes(now.getMinutes());
            inputDate.setSeconds(now.getSeconds());
            inputDate.setMilliseconds(now.getMilliseconds());
            newDate = inputDate;
        }

        if (newTotalAmount <= 0) return res.status(400).json({ status: false, message: 'Total amount must be greater than 0' });

        // Handle Account & Financial Changes for COMPLETED payments
        if (payment.status === 'COMPLETED') {
            if (String(originalAccountId) === String(accountId)) {
                const account = await Account.findById(originalAccountId);
                const resultingBalance = account.balance + originalAmount - newTotalAmount;

                if (resultingBalance < 0) {
                    return res.status(400).json({
                        status: false,
                        message: `Insufficient account balance (Available: ₹${account.balance}, Required extra: ₹${newTotalAmount - originalAmount})`
                    });
                }

                const session = await mongoose.startSession();
                try {
                    session.startTransaction();
                    account.balance = resultingBalance;
                    await account.save({ session });

                    await AccountTransaction.findOneAndUpdate(
                        { payment: payment._id },
                        {
                            amount: newTotalAmount,
                            date: newDate,
                            balanceAfter: account.balance,
                            description: `Payment ${payment.receiptNo} to ${payee}`
                        },
                        { session }
                    );

                    await session.commitTransaction();
                } catch (txnError) {
                    await session.abortTransaction();
                    throw txnError;
                } finally {
                    session.endSession();
                }
            } else {
                const oldAccount = await Account.findById(originalAccountId);
                const newAccount = await Account.findById(accountId);

                if (newAccount.balance < newTotalAmount) {
                    return res.status(400).json({
                        status: false,
                        message: `Insufficient balance in target account (Available: ₹${newAccount.balance}, Required: ₹${newTotalAmount})`
                    });
                }

                const session = await mongoose.startSession();
                try {
                    session.startTransaction();

                    oldAccount.balance += originalAmount;
                    await oldAccount.save({ session });

                    await AccountTransaction.findOneAndDelete(
                        { payment: payment._id },
                        { session }
                    );

                    newAccount.balance -= newTotalAmount;
                    await newAccount.save({ session });

                    await AccountTransaction.create([{
                        account: newAccount._id,
                        payment: payment._id,
                        type: 'EXPENSE',
                        amount: newTotalAmount,
                        balanceAfter: newAccount.balance,
                        date: newDate,
                        description: `Payment ${payment.receiptNo} to ${payee}`
                    }], { session });

                    await session.commitTransaction();
                } catch (txnError) {
                    await session.abortTransaction();
                    throw txnError;
                } finally {
                    session.endSession();
                }
            }
        }

        payment.date = newDate;
        payment.paymentDate = newDate;
        payment.account = accountId;
        payment.category = categoryId;
        payment.payee = payee;
        payment.payeeContact = payeeContact;
        payment.items = items;
        payment.amount = newTotalAmount;
        payment.description = description;
        payment.notes = description;

        await payment.save();

        await sendPaymentAlert(payment, 'UPDATE');

        res.json({ status: true, data: payment, message: 'Payment updated successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: error.message });
    }
};

export const markPaymentAsPaid = async (req, res) => {
    try {
        const { id } = req.params;
        const { date, accountId } = req.body;

        const payment = await Payment.findById(id);
        if (!payment) return res.status(404).json({ status: false, message: 'Payment not found' });

        if (payment.status === 'COMPLETED') {
            return res.status(400).json({ status: false, message: 'Payment is already completed' });
        }

        if (payment.status === 'DELETED') {
            return res.status(400).json({ status: false, message: 'Cannot complete a deleted payment' });
        }

        const account = await Account.findById(accountId || payment.account);
        if (!account) {
            return res.status(404).json({ status: false, message: 'Account not found' });
        }

        const paymentAmount = payment.amount;
        if (account.balance < paymentAmount) {
            return res.status(400).json({
                status: false,
                message: `Insufficient account balance (Available: ₹${account.balance}, Required: ₹${paymentAmount})`
            });
        }

        const paymentDate = date ? new Date(date) : new Date();

        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            account.balance -= paymentAmount;
            await account.save({ session });

            await AccountTransaction.create([{
                account: account._id,
                relatedAccount: null,
                payment: payment._id,
                type: 'EXPENSE',
                amount: paymentAmount,
                balanceAfter: account.balance,
                date: paymentDate,
                description: `Payment ${payment.receiptNo} to ${payment.payee} (Marked as Paid)`
            }], { session });

            payment.status = 'COMPLETED';
            payment.paidAt = new Date();
            payment.account = account._id;
            if (date) {
                payment.date = paymentDate;
                payment.paymentDate = paymentDate;
            }
            await payment.save({ session });

            await session.commitTransaction();
        } catch (txnError) {
            await session.abortTransaction();
            throw txnError;
        } finally {
            session.endSession();
        }

        res.json({ 
            status: true, 
            data: payment, 
            message: 'Payment marked as completed successfully' 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: error.message });
    }
};

export const deletePayment = async (req, res) => {
    try {
        const { id } = req.params;

        const payment = await Payment.findById(id);
        if (!payment) return res.status(404).json({ status: false, message: 'Payment not found' });

        if (payment.status === 'COMPLETED') {
            const account = await Account.findById(payment.account);

            const session = await mongoose.startSession();
            try {
                session.startTransaction();

                account.balance += payment.amount;
                await account.save({ session });

                await AccountTransaction.findOneAndDelete(
                    { payment: payment._id },
                    { session }
                );

                payment.status = 'DELETED';
                payment.deletedAt = new Date();
                await payment.save({ session });

                await session.commitTransaction();
            } catch (txnError) {
                await session.abortTransaction();
                throw txnError;
            } finally {
                session.endSession();
            }
        } else {
            payment.status = 'DELETED';
            payment.deletedAt = new Date();
            await payment.save();
        }

        res.json({ 
            status: true, 
            message: 'Payment deleted successfully (transaction reversed)' 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Download Payment Voucher PDF
// @route   GET /api/payments/:id/pdf
export const downloadPaymentPdf = async (req, res) => {
    try {
        const payment = await Payment.findById(req.params.id)
            .populate('category', 'name')
            .populate('account', 'name');

        if (!payment) return res.status(404).json({ status: false, message: 'Payment not found' });

        const doc = new PDFDocument({ size: 'A5', margin: 30 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Voucher-${payment.receiptNo}.pdf`);
        doc.pipe(res);

        const PW = doc.page.width;
        const MG = 30;
        const CW = PW - MG * 2;
        let y = MG;

        doc.font('Helvetica-Bold').fontSize(16).fillColor('#000')
            .text('THAYINERI MUSLIM JAMA-AT', MG, y, { width: CW, align: 'center' });
        y += 22;

        doc.font('Helvetica').fontSize(9).fillColor('#555')
            .text('(TMJ) | Thayineri Kara Road, Thayineri, Kerala 670307 | Ph: +91 8129059992', MG, y, { width: CW, align: 'center' });
        y += 14;

        doc.lineWidth(0.5).moveTo(MG, y).lineTo(PW - MG, y).strokeColor('#000').stroke();
        y += 14;

        doc.font('Helvetica-Bold').fontSize(15).fillColor('#000')
            .text('PAYMENT VOUCHER', MG, y, { width: CW, align: 'center' });
        y += 22;

        const L = 70;
        const LH = 14;
        doc.fontSize(9).fillColor('#000');
        doc.font('Helvetica-Bold').text('Voucher No:', MG, y, { width: L });
        doc.font('Helvetica').text(payment.receiptNo, MG + L, y);
        y += LH;

        doc.font('Helvetica-Bold').text('Date:', MG, y, { width: L });
        doc.font('Helvetica').text(new Date(payment.date).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric'
        }), MG + L, y);
        y += LH + 2;

        doc.lineWidth(0.5).moveTo(MG, y).lineTo(PW - MG, y).strokeColor('#ccc').stroke();
        y += 12;

        const lw = 60;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('Pay To:', MG, y, { width: lw });
        doc.font('Helvetica').fontSize(9).text(payment.payee, MG + lw, y);
        y += LH;

        if (payment.payeeContact) {
            doc.font('Helvetica').fontSize(8).fillColor('#777').text(payment.payeeContact, MG + lw, y);
            y += 11;
        }

        doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('Paid From:', MG, y, { width: lw });
        doc.font('Helvetica').fontSize(9).text(payment.account?.name || '-', MG + lw, y);
        y += LH;

        doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('Category:', MG, y, { width: lw });
        doc.font('Helvetica').fontSize(9).text(payment.category?.name || '-', MG + lw, y);
        y += LH;

        if (payment.description) {
            doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('Description:', MG, y, { width: lw });
            doc.font('Helvetica').fontSize(9).fillColor('#444').text(payment.description, MG + lw, y, { width: CW - lw });
            y += LH;
        }

        doc.lineWidth(0.5).moveTo(MG, y).lineTo(PW - MG, y).strokeColor('#ccc').stroke();
        y += 12;

        const tColX = [MG, MG + 18, MG + CW - 90];
        const tColW = [18, CW - 108, 90];

        doc.lineWidth(0.5).rect(MG, y, CW, 18).fillAndStroke('#000', '#000');
        doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
        doc.text('#', tColX[0] + 5, y + 5, { width: tColW[0], align: 'center' });
        doc.text('Particulars', tColX[1] + 5, y + 5, { width: tColW[1] });
        doc.text('Amount', tColX[2] + 5, y + 5, { width: tColW[2] - 10, align: 'right' });
        y += 18;

        doc.font('Helvetica').fontSize(9).fillColor('#000');
        payment.items.forEach((item, i) => {
            doc.lineWidth(0.5).rect(MG, y, CW, 20).stroke('#eee');
            doc.text(String(i + 1), tColX[0] + 5, y + 5, { width: tColW[0], align: 'center' });
            doc.text(item.description, tColX[1] + 5, y + 5, { width: tColW[1] });
            doc.text('Rs. ' + Number(item.amount).toFixed(2), tColX[2] + 5, y + 5, { width: tColW[2] - 10, align: 'right' });
            y += 20;
        });

        doc.lineWidth(0.5).rect(MG, y, CW, 22).fillAndStroke('#f5f5f5', '#000');
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
        doc.text('TOTAL', tColX[1] + 5, y + 5, { width: tColW[1] });
        doc.text('Rs. ' + Number(payment.amount).toFixed(2), tColX[2] + 5, y + 5, { width: tColW[2] - 10, align: 'right' });
        y += 30;

        doc.fontSize(8).fillColor('#888')
            .text('Generated: ' + new Date().toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true
            }), MG, y, { width: CW, align: 'center' });

        doc.end();

    } catch (error) {
        console.error(error);
        if (!res.headersSent) res.status(500).json({ status: false, message: error.message });
    }
};
