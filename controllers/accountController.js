import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';

// Helper function to get current date in Indian timezone (IST - UTC+5:30)
const getIndianTime = () => {
    const now = new Date();
    // IST is UTC+5:30
    const istOffset = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds
    const utc = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
    return new Date(utc + istOffset);
};

// @desc    Create new account
// @route   POST /api/accounts
// @access  Private
export const createAccount = async (req, res) => {
    try {
        const { name, type, accountNumber, holderName, bankName, openingBalance, isPrimary } = req.body;

        // Check for duplicate account name + type
        const existingByName = await Account.findOne({ name: name.trim(), type, status: 'ACTIVE' });
        if (existingByName) {
            return res.status(400).json({ status: false, message: `An account with name "${name}" of type ${type} already exists` });
        }

        // Check for duplicate bank account number
        if (type === 'BANK' && accountNumber) {
            const existingByNumber = await Account.findOne({ accountNumber: accountNumber.trim(), status: 'ACTIVE' });
            if (existingByNumber) {
                return res.status(400).json({ status: false, message: `An account with number "${accountNumber}" already exists (${existingByNumber.name})` });
            }
        }

        if (isPrimary) {
            await Account.updateMany({}, { isPrimary: false });
        }

        const count = await Account.countDocuments();
        const shouldBePrimary = isPrimary || count === 0;

        const account = await Account.create({
            name: name.trim(),
            type,
            accountNumber: accountNumber?.trim(),
            holderName: holderName.trim(),
            bankName: bankName?.trim(),
            openingBalance: Number(openingBalance) || 0,
            balance: Number(openingBalance) || 0,
            isPrimary: shouldBePrimary
        });

        // Log Opening Balance with Indian timezone
        await AccountTransaction.create({
            account: account._id,
            type: 'OPENING_BALANCE',
            amount: Number(openingBalance) || 0,
            balanceAfter: Number(openingBalance) || 0,
            date: getIndianTime(),
            description: 'Opening Balance'
        });

        res.status(201).json({
            status: true,
            data: account
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get all accounts
// @route   GET /api/accounts
// @access  Private
export const getAccounts = async (req, res) => {
    try {
        const accounts = await Account.find({ status: 'ACTIVE' }).sort({ isPrimary: -1, createdAt: -1 });
        res.json({ status: true, data: accounts });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Update account
// @route   PUT /api/accounts/:id
// @access  Private
export const updateAccount = async (req, res) => {
    try {
        const account = await Account.findById(req.params.id);
        if (!account) {
            return res.status(404).json({ status: false, message: 'Account not found' });
        }

        const { name, holderName, bankName, accountNumber, isPrimary } = req.body;

        // Check for duplicate account name + type (excluding self)
        if (name && name.trim() !== account.name) {
            const existingByName = await Account.findOne({
                name: name.trim(),
                type: account.type,
                status: 'ACTIVE',
                _id: { $ne: account._id }
            });
            if (existingByName) {
                return res.status(400).json({ status: false, message: `An account with name "${name}" of type ${account.type} already exists` });
            }
        }

        // Check for duplicate bank account number (excluding self)
        if (account.type === 'BANK' && accountNumber && accountNumber.trim() !== account.accountNumber) {
            const existingByNumber = await Account.findOne({
                accountNumber: accountNumber.trim(),
                status: 'ACTIVE',
                _id: { $ne: account._id }
            });
            if (existingByNumber) {
                return res.status(400).json({ status: false, message: `An account with number "${accountNumber}" already exists (${existingByNumber.name})` });
            }
        }

        if (isPrimary && !account.isPrimary) {
            await Account.updateMany({}, { isPrimary: false });
            account.isPrimary = true;
        }

        account.name = name?.trim() || account.name;
        account.holderName = holderName?.trim() || account.holderName;
        if (account.type === 'BANK') {
            account.bankName = bankName?.trim() || account.bankName;
            account.accountNumber = accountNumber?.trim() || account.accountNumber;
        }

        const updatedAccount = await account.save();
        res.json({ status: true, data: updatedAccount });

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Delete (Soft) account
// @route   DELETE /api/accounts/:id
// @access  Private
export const deleteAccount = async (req, res) => {
    try {
        const account = await Account.findById(req.params.id);
        if (!account) {
            return res.status(404).json({ status: false, message: 'Account not found' });
        }

        account.status = 'INACTIVE';
        account.isPrimary = false;
        await account.save();

        res.json({ status: true, message: 'Account deactivated' });

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Transfer Funds
// @route   POST /api/accounts/transfer
// @access  Private
export const transferFunds = async (req, res) => {
    try {
        const { fromAccountId, toAccountId, amount, description } = req.body;

        if (Number(amount) <= 0) {
            return res.status(400).json({ status: false, message: 'Invalid amount' });
        }

        const fromAccount = await Account.findById(fromAccountId);
        const toAccount = await Account.findById(toAccountId);

        if (!fromAccount || !toAccount) {
            return res.status(404).json({ status: false, message: 'Account not found' });
        }

        if (fromAccount.balance < amount) {
            return res.status(400).json({ status: false, message: 'Insufficient funds' });
        }

        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            fromAccount.balance -= Number(amount);
            toAccount.balance += Number(amount);

            await fromAccount.save({ session });
            await toAccount.save({ session });

            await AccountTransaction.create([{
                account: fromAccount._id,
                relatedAccount: toAccount._id,
                type: 'TRANSFER_OUT',
                amount: Number(amount),
                balanceAfter: fromAccount.balance,
                date: getIndianTime(),
                description: description || `Transfer to ${toAccount.name}`
            }], { session });

            await AccountTransaction.create([{
                account: toAccount._id,
                relatedAccount: fromAccount._id,
                type: 'TRANSFER_IN',
                amount: Number(amount),
                balanceAfter: toAccount.balance,
                date: getIndianTime(),
                description: description || `Transfer from ${fromAccount.name}`
            }], { session });

            await session.commitTransaction();
            res.json({ status: true, message: 'Transfer successful' });
        } catch (txnError) {
            await session.abortTransaction();
            throw txnError;
        } finally {
            session.endSession();
        }

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get Account Transactions
// @route   GET /api/accounts/:id/transactions
// @access  Private
export const getAccountTransactions = async (req, res) => {
    try {

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ status: false, message: 'Invalid Account ID' });
        }

        const transactions = await AccountTransaction.find({ account: req.params.id })
            .populate('relatedAccount', 'name')
            .populate('payment', 'receiptNo _id')
            .populate('receipt', 'receiptNo _id')
            .populate('staff', '_id')
            .populate('contract', '_id')
            .populate({
                path: 'collectionReceipt',
                select: 'receiptNo payer',
                populate: { path: 'payer.entityId', select: 'name customId' } // Optional: depending on if we need deep detail
            })
            .sort({ date: -1, createdAt: -1 });

        res.json({ status: true, data: transactions });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get All Transactions (Global Ledger)
// @route   GET /api/accounts/transactions/all
// @access  Private
export const getAllTransactions = async (req, res) => {
    try {
        const { page = 1, limit = 20, type, accountId, search, startDate, endDate } = req.query;

        const query = {};

        if (type && type !== 'ALL') query.type = type;
        if (accountId && accountId !== 'ALL' && mongoose.Types.ObjectId.isValid(accountId)) {
            query.account = accountId;
        }

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        if (search) {
            query.description = { $regex: search, $options: 'i' };
        }

        const count = await AccountTransaction.countDocuments(query);
        const transactions = await AccountTransaction.find(query)
            .populate('account', 'name type')
            .populate('relatedAccount', 'name')
            .populate('payment', 'receiptNo _id')
            .populate('receipt', 'receiptNo _id')
            .populate('staff', '_id')
            .populate('contract', '_id')
            .populate({
                path: 'collectionReceipt',
                select: 'receiptNo payer',
                populate: { path: 'payer.entityId', select: 'name customId' }
            })
            .sort({ date: -1, createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        res.json({
            status: true,
            data: transactions,
            totalPages: Math.ceil(count / limit),
            currentPage: Number(page),
            totalTransactions: count
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Export Transactions to Excel
// @route   GET /api/accounts/transactions/export
// @access  Private
export const exportTransactions = async (req, res) => {
    try {
        const { type, accountId, search, startDate, endDate } = req.query;

        const query = {};

        // Filters
        if (type && type !== 'ALL') query.type = type;
        if (accountId && accountId !== 'ALL' && mongoose.Types.ObjectId.isValid(accountId)) {
            query.account = accountId;
        }

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        if (search) {
            query.description = { $regex: search, $options: 'i' };
        }

        const transactions = await AccountTransaction.find(query)
            .populate('account', 'name')
            .populate('relatedAccount', 'name')
            .sort({ date: -1, createdAt: -1 });

        // Transform data
        const data = transactions.map(t => {
            const isCredit = ['OPENING_BALANCE', 'TRANSFER_IN', 'INCOME', 'LOAN_RECEIVED'].includes(t.type);
            return {
                Date: new Date(t.date).toLocaleDateString(),
                Description: t.description,
                Type: t.type,
                Credit: isCredit ? t.amount : 0,
                Debit: !isCredit ? t.amount : 0,
                BalanceAfter: t.balanceAfter,
                Account: t.account?.name || 'N/A',
                RelatedAccount: t.relatedAccount?.name || '-',
            };
        });

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Transactions');
        
        // Add headers
        if (data.length > 0) {
            worksheet.columns = Object.keys(data[0]).map(key => ({ header: key, key: key }));
        }
        
        // Add data rows
        data.forEach(row => {
            worksheet.addRow(row);
        });
        
        const buffer = await workbook.xlsx.writeBuffer();

        res.setHeader('Content-Disposition', 'attachment; filename="transactions.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};
