import Receipt from '../models/Receipt.js';
import ReceiptCategory from '../models/ReceiptCategory.js';
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
        account.balance += totalAmount;
        await account.save();

        // 6. Log Transaction
        await AccountTransaction.create({
            account: account._id,
            relatedAccount: null,
            receipt: receipt._id, // Link to receipt
            type: 'INCOME',
            amount: totalAmount,
            balanceAfter: account.balance,
            date: receipt.date,
            description: `Receipt ${receiptNo} from ${payer}`
        });

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
        if (String(originalAccountId) === String(accountId)) {
            // Same Account: Adjust Balance
            // Logic: Balance - Old + New (Remove Old Income, Add New Income)
            const account = await Account.findById(originalAccountId);

            // Note: Unlike expenses, Income ADDS to balance. So to undo, we subtract.
            account.balance = account.balance - originalAmount + newTotalAmount;
            await account.save();

            // Update Transaction
            await AccountTransaction.findOneAndUpdate(
                { receipt: receipt._id },
                {
                    amount: newTotalAmount,
                    date: newDate,
                    balanceAfter: account.balance,
                    description: `Receipt ${receipt.receiptNo} from ${payer}`
                }
            );
        } else {
            // Account Changed
            // A. Revert Old Account (Subtract original income)
            const oldAccount = await Account.findById(originalAccountId);
            oldAccount.balance -= originalAmount;
            await oldAccount.save();

            // Delete Old Transaction
            await AccountTransaction.findOneAndDelete({ receipt: receipt._id });

            // B. Apply to New Account (Add new income)
            const newAccount = await Account.findById(accountId);
            newAccount.balance += newTotalAmount;
            await newAccount.save();

            // Create New Transaction
            await AccountTransaction.create({
                account: newAccount._id,
                receipt: receipt._id,
                type: 'INCOME',
                amount: newTotalAmount,
                balanceAfter: newAccount.balance,
                date: newDate,
                description: `Receipt ${receipt.receiptNo} from ${payer}`
            });
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

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Receipt-${receipt.receiptNo}.pdf`);
        doc.pipe(res);

        const PW = doc.page.width;
        const MG = 50;
        const CW = PW - MG * 2;
        let y = MG;

        doc.font('Helvetica-Bold').fontSize(14).fillColor('#000')
            .text('THAYINERI MUSLIM JAMA-AT', MG, y, { width: CW, align: 'center' });
        y += 16;

        doc.font('Helvetica').fontSize(8).fillColor('#444')
            .text('(TMJ) | Thayineri Kara Road, Thayineri, Kerala 670307 | Ph: +91 8129059992', MG, y, { width: CW, align: 'center' });
        y += 14;

        doc.lineWidth(0.5).moveTo(MG, y).lineTo(PW - MG, y).strokeColor('#000').stroke();
        y += 12;

        doc.font('Helvetica-Bold').fontSize(16).fillColor('#000')
            .text('OFFICIAL RECEIPT', MG, y, { width: CW, align: 'center' });
        y += 20;

        doc.fontSize(9).fillColor('#000');
        doc.font('Helvetica-Bold').text('Receipt No:', MG, y, { width: 80 });
        doc.font('Helvetica').text(receipt.receiptNo, MG + 80, y, { width: CW - 80 });
        y += 13;

        doc.font('Helvetica-Bold').text('Date:', MG, y, { width: 80 });
        doc.font('Helvetica').text(new Date(receipt.date).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric'
        }), MG + 80, y, { width: CW - 80 });
        y += 20;

        doc.lineWidth(0.5).moveTo(MG, y).lineTo(PW - MG, y).strokeColor('#ccc').stroke();
        y += 12;

        const col1X = MG;
        const col2X = MG + CW / 2;

        doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('Received From:', col1X, y);
        doc.font('Helvetica').fontSize(10).text(receipt.payer, col1X + 85, y);
        if (receipt.payerContact) {
            y += 14;
            doc.font('Helvetica').fontSize(9).fillColor('#555').text(receipt.payerContact, col1X + 85, y);
            y -= 14;
        }
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('Deposited To:', col2X, y);
        doc.font('Helvetica').fontSize(10).text(receipt.account?.name || '-', col2X + 80, y);
        y += 14;

        doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('Category:', col1X, y);
        doc.font('Helvetica').fontSize(10).text(receipt.category?.name || '-', col1X + 60, y);
        y += 20;

        if (receipt.description) {
            doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('Description:', col1X, y);
            doc.font('Helvetica').fontSize(9).fillColor('#444').text(receipt.description, col1X + 75, y, { width: CW - 75 });
            y += 16;
        }

        doc.lineWidth(0.5).moveTo(MG, y).lineTo(PW - MG, y).strokeColor('#ccc').stroke();
        y += 10;

        const tColX = [MG, MG + 30, MG + CW - 120];
        const tColW = [30, CW - 150, 120];

        doc.lineWidth(0.5).rect(MG, y, CW, 18).fillAndStroke('#000', '#000');
        doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
        doc.text('#', tColX[0] + 6, y + 5, { width: tColW[0] });
        doc.text('Particulars', tColX[1] + 6, y + 5, { width: tColW[1] });
        doc.text('Amount', tColX[2] + 6, y + 5, { width: tColW[2] - 12, align: 'right' });
        y += 18;

        doc.font('Helvetica').fontSize(9).fillColor('#000');
        receipt.items.forEach((item, i) => {
            doc.lineWidth(0.5).rect(MG, y, CW, 20).stroke('#ddd');
            doc.text(String(i + 1), tColX[0] + 6, y + 5, { width: tColW[0] });
            doc.text(item.description, tColX[1] + 6, y + 5, { width: tColW[1] });
            doc.text('Rs. ' + Number(item.amount).toFixed(2), tColX[2] + 6, y + 5, { width: tColW[2] - 12, align: 'right' });
            y += 20;
        });

        doc.lineWidth(0.5).rect(MG, y, CW, 22).fillAndStroke('#f5f5f5', '#000');
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
        doc.text('TOTAL', tColX[1] + 6, y + 5, { width: tColW[1] });
        doc.text('Rs. ' + Number(receipt.amount).toFixed(2), tColX[2] + 6, y + 5, { width: tColW[2] - 12, align: 'right' });
        y += 30;

        doc.font('Helvetica').fontSize(8).fillColor('#555');
        doc.text('Authorised Signatory', MG, y, { width: CW, align: 'right' });
        y += 2;
        doc.lineWidth(0.5).moveTo(PW - MG - 120, y).lineTo(PW - MG, y).strokeColor('#000').stroke();
        y += 18;

        doc.fontSize(7).fillColor('#aaa')
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
