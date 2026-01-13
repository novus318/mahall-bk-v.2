import Receipt from '../models/Receipt.js';
import ReceiptCategory from '../models/ReceiptCategory.js';
import SystemSettings from '../models/SystemSettings.js';
import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';

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
