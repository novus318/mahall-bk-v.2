import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import XLSX from 'xlsx';
import mongoose from 'mongoose';

// @desc    Create new account
// @route   POST /api/accounts
// @access  Private
export const createAccount = async (req, res) => {
    try {
        const { name, type, accountNumber, holderName, bankName, openingBalance, isPrimary } = req.body;

        if (isPrimary) {
            await Account.updateMany({}, { isPrimary: false });
        }

        const count = await Account.countDocuments();
        const shouldBePrimary = isPrimary || count === 0;

        const account = await Account.create({
            name,
            type,
            accountNumber,
            holderName,
            bankName,
            openingBalance: Number(openingBalance) || 0,
            balance: Number(openingBalance) || 0,
            isPrimary: shouldBePrimary
        });

        // Log Opening Balance
        await AccountTransaction.create({
            account: account._id,
            type: 'OPENING_BALANCE',
            amount: Number(openingBalance) || 0,
            balanceAfter: Number(openingBalance) || 0,
            date: new Date(),
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

        if (isPrimary && !account.isPrimary) {
            await Account.updateMany({}, { isPrimary: false });
            account.isPrimary = true;
        }

        account.name = name || account.name;
        account.holderName = holderName || account.holderName;
        if (account.type === 'BANK') {
            account.bankName = bankName || account.bankName;
            account.accountNumber = accountNumber || account.accountNumber;
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

        fromAccount.balance -= Number(amount);
        toAccount.balance += Number(amount);

        await fromAccount.save();
        await toAccount.save();

        // Log Transactions
        await AccountTransaction.create({
            account: fromAccount._id,
            relatedAccount: toAccount._id,
            type: 'TRANSFER_OUT',
            amount: Number(amount),
            balanceAfter: fromAccount.balance,
            date: new Date(),
            description: description || `Transfer to ${toAccount.name}`
        });

        await AccountTransaction.create({
            account: toAccount._id,
            relatedAccount: fromAccount._id,
            type: 'TRANSFER_IN',
            amount: Number(amount),
            balanceAfter: toAccount.balance,
            date: new Date(),
            description: description || `Transfer from ${fromAccount.name}`
        });

        res.json({ status: true, message: 'Transfer successful' });

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get Account Transactions
// @route   GET /api/accounts/:id/transactions
// @access  Private
export const getAccountTransactions = async (req, res) => {
    try {
        console.log('getAccountTransactions params:', req.params); // DEBUG

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ status: false, message: 'Invalid Account ID' });
        }

        const transactions = await AccountTransaction.find({ account: req.params.id })
            .populate('relatedAccount', 'name')
            .populate('payment', 'receiptNo _id')
            .populate('receipt', 'receiptNo _id') // Added receipt population
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
        console.log('getAllTransactions query:', req.query); // DEBUG
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
            const isCredit = ['OPENING_BALANCE', 'TRANSFER_IN', 'INCOME'].includes(t.type);
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

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Transactions');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', 'attachment; filename="transactions.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};
