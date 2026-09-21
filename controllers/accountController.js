import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import CollectionDue from '../models/CollectionDue.js';
import RentDue from '../models/RentDue.js';
import Payable from '../models/Payable.js';
import Contract from '../models/Contract.js';
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

// @desc    Income & Expense Report (date-wise with Excel export)
// @route   GET /api/accounts/reports/income-expense
// @access  Private
export const getIncomeExpenseReport = async (req, res) => {
    try {
        const { startDate, endDate, format: responseFormat } = req.query;

        const query = { type: { $in: ['INCOME', 'EXPENSE'] } };

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.date.$lte = end;
            }
        }

        const transactions = await AccountTransaction.find(query)
            .populate('account', 'name type')
            .sort({ date: 1 });

        // Group by date
        const groupedByDate = {};
        let totalIncome = 0;
        let totalExpense = 0;

        for (const tx of transactions) {
            const dateKey = new Date(tx.date).toISOString().split('T')[0];
            if (!groupedByDate[dateKey]) {
                groupedByDate[dateKey] = { date: dateKey, income: 0, expense: 0, transactions: [] };
            }
            if (tx.type === 'INCOME') {
                groupedByDate[dateKey].income += tx.amount;
                totalIncome += tx.amount;
            } else {
                groupedByDate[dateKey].expense += tx.amount;
                totalExpense += tx.amount;
            }
            groupedByDate[dateKey].transactions.push({
                _id: tx._id,
                date: tx.date,
                description: tx.description,
                type: tx.type,
                amount: tx.amount,
                account: tx.account?.name || 'N/A',
                accountType: tx.account?.type || '',
            });
        }

        const dailySummary = Object.values(groupedByDate).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // If Excel export requested
        if (responseFormat === 'excel') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Income & Expense Report');

            // Title
            worksheet.mergeCells('A1:F1');
            const titleCell = worksheet.getCell('A1');
            titleCell.value = 'Income & Expense Report';
            titleCell.font = { size: 14, bold: true };
            titleCell.alignment = { horizontal: 'center' };

            // Date range
            worksheet.mergeCells('A2:F2');
            const dateCell = worksheet.getCell('A2');
            dateCell.value = `From: ${startDate || 'Start'} To: ${endDate || 'End'}`;
            dateCell.font = { size: 10, color: { argb: '666666' } };
            dateCell.alignment = { horizontal: 'center' };

            worksheet.addRow([]);

            // Summary row
            worksheet.addRow([]);
            const summaryRow = worksheet.addRow(['', 'Total Income', totalIncome, 'Total Expense', totalExpense, 'Net', totalIncome - totalExpense]);
            summaryRow.font = { bold: true };
            worksheet.getRow(summaryRow.number).getCell(2).font = { bold: true, color: { argb: '008000' } };
            worksheet.getRow(summaryRow.number).getCell(3).font = { bold: true, color: { argb: '008000' } };
            worksheet.getRow(summaryRow.number).getCell(4).font = { bold: true, color: { argb: 'FF0000' } };
            worksheet.getRow(summaryRow.number).getCell(5).font = { bold: true, color: { argb: 'FF0000' } };

            worksheet.addRow([]);

            // Headers
            const headers = ['Date', 'Description', 'Type', 'Amount', 'Account', 'Account Type'];
            const headerRow = worksheet.addRow(headers);
            headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
            headerRow.eachCell((cell) => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '333333' } };
                cell.alignment = { horizontal: 'center' };
            });

            // Data rows
            for (const day of dailySummary) {
                for (const tx of day.transactions) {
                    worksheet.addRow([
                        new Date(tx.date).toLocaleDateString('en-GB'),
                        tx.description,
                        tx.type,
                        tx.amount,
                        tx.account,
                        tx.accountType
                    ]);
                }
            }

            // Auto-width columns
            worksheet.columns.forEach((col) => {
                col.width = 20;
            });

            const buffer = await workbook.xlsx.writeBuffer();
            res.setHeader('Content-Disposition', `attachment; filename="income-expense-report-${startDate || 'all'}-to-${endDate || 'all'}.xlsx"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            return res.send(buffer);
        }

        // JSON response
        res.json({
            status: true,
            data: {
                dailySummary,
                totals: { income: totalIncome, expense: totalExpense, net: totalIncome - totalExpense },
                transactionCount: transactions.length
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get receivables report (amounts owed TO the organization)
// @route   GET /api/accounts/reports/receivables
// @access  Private
export const getReceivablesReport = async (req, res) => {
    try {
        const { startDate, endDate, status, format } = req.query;

        const dateFilter = {};
        if (startDate || endDate) {
            dateFilter.createdAt = {};
            if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
            if (endDate) dateFilter.createdAt.$lte = new Date(endDate + 'T23:59:59.999Z');
        }

        const statusFilter = status ? { status } : { status: { $in: ['PENDING', 'PARTIAL'] } };

        // Collection Dues
        const collectionDues = await CollectionDue.find({ ...dateFilter, ...statusFilter })
            .populate('entityId', 'name flatNumber')
            .lean();

        // Rent Dues
        const rentDues = await RentDue.find({ ...dateFilter, ...statusFilter })
            .populate({ path: 'contract', populate: { path: 'tenant', select: 'name' } })
            .lean();

        const collectionPending = collectionDues.reduce((sum, d) => sum + (d.amount - (d.paidAmount || 0)), 0);
        const rentPending = rentDues.reduce((sum, d) => sum + (d.amount - (d.collectedAmount || 0)), 0);

        const data = {
            summary: {
                collectionDues: {
                    count: collectionDues.length,
                    totalAmount: collectionDues.reduce((sum, d) => sum + d.amount, 0),
                    paidAmount: collectionDues.reduce((sum, d) => sum + (d.paidAmount || 0), 0),
                    pendingAmount: collectionPending
                },
                rentDues: {
                    count: rentDues.length,
                    totalAmount: rentDues.reduce((sum, d) => sum + d.amount, 0),
                    paidAmount: rentDues.reduce((sum, d) => sum + (d.collectedAmount || 0), 0),
                    pendingAmount: rentPending
                },
                grandTotal: {
                    totalAmount: collectionDues.reduce((sum, d) => sum + d.amount, 0) + rentDues.reduce((sum, d) => sum + d.amount, 0),
                    pendingAmount: collectionPending + rentPending
                }
            },
            collectionDues,
            rentDues
        };

        if (format === 'excel') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Receivables Report');

            worksheet.mergeCells('A1:G1');
            worksheet.getCell('A1').value = 'Receivables Report';
            worksheet.getCell('A1').font = { bold: true, size: 14 };
            worksheet.getCell('A1').alignment = { horizontal: 'center' };

            worksheet.mergeCells('A2:G2');
            worksheet.getCell('A2').value = `From: ${startDate || 'All'} To: ${endDate || 'All'}`;
            worksheet.getCell('A2').font = { size: 10, italic: true };

            worksheet.getCell('A4').value = 'Summary';
            worksheet.getCell('A4').font = { bold: true, size: 12 };
            worksheet.getCell('A5').value = 'Category';
            worksheet.getCell('B5').value = 'Count';
            worksheet.getCell('C5').value = 'Total';
            worksheet.getCell('D5').value = 'Paid';
            worksheet.getCell('E5').value = 'Pending';
            worksheet.getRow(5).font = { bold: true };

            worksheet.getCell('A6').value = 'Collection Dues';
            worksheet.getCell('B6').value = data.summary.collectionDues.count;
            worksheet.getCell('C6').value = data.summary.collectionDues.totalAmount;
            worksheet.getCell('D6').value = data.summary.collectionDues.paidAmount;
            worksheet.getCell('E6').value = data.summary.collectionDues.pendingAmount;

            worksheet.getCell('A7').value = 'Rent Dues';
            worksheet.getCell('B7').value = data.summary.rentDues.count;
            worksheet.getCell('C7').value = data.summary.rentDues.totalAmount;
            worksheet.getCell('D7').value = data.summary.rentDues.paidAmount;
            worksheet.getCell('E7').value = data.summary.rentDues.pendingAmount;

            worksheet.getCell('A9').value = 'Grand Total';
            worksheet.getCell('A9').font = { bold: true };
            worksheet.getCell('C9').value = data.summary.grandTotal.totalAmount;
            worksheet.getCell('E9').value = data.summary.grandTotal.pendingAmount;

            // Collection Dues detail
            const row = 11;
            worksheet.getCell(row, 1).value = 'Collection Dues';
            worksheet.getCell(row, 1).font = { bold: true, size: 12 };
            ['Entity', 'Type', 'Period', 'Amount', 'Paid', 'Pending', 'Status'].forEach((h, i) => {
                worksheet.getCell(row + 1, i + 1).value = h;
                worksheet.getRow(row + 1).font = { bold: true };
            });
            collectionDues.forEach((d, i) => {
                worksheet.getCell(row + 2 + i, 1).value = d.entityId?.name || 'N/A';
                worksheet.getCell(row + 2 + i, 2).value = d.entityType;
                worksheet.getCell(row + 2 + i, 3).value = d.period;
                worksheet.getCell(row + 2 + i, 4).value = d.amount;
                worksheet.getCell(row + 2 + i, 5).value = d.paidAmount || 0;
                worksheet.getCell(row + 2 + i, 6).value = d.amount - (d.paidAmount || 0);
                worksheet.getCell(row + 2 + i, 7).value = d.status;
            });

            // Rent Dues detail
            const rRow = row + 2 + collectionDues.length + 1;
            worksheet.getCell(rRow, 1).value = 'Rent Dues';
            worksheet.getCell(rRow, 1).font = { bold: true, size: 12 };
            ['Tenant', 'Period', 'Amount', 'Collected', 'Pending', 'Status'].forEach((h, i) => {
                worksheet.getCell(rRow + 1, i + 1).value = h;
                worksheet.getRow(rRow + 1).font = { bold: true };
            });
            rentDues.forEach((d, i) => {
                worksheet.getCell(rRow + 2 + i, 1).value = d.contract?.tenant?.name || 'N/A';
                worksheet.getCell(rRow + 2 + i, 2).value = d.monthYear;
                worksheet.getCell(rRow + 2 + i, 3).value = d.amount;
                worksheet.getCell(rRow + 2 + i, 4).value = d.collectedAmount || 0;
                worksheet.getCell(rRow + 2 + i, 5).value = d.amount - (d.collectedAmount || 0);
                worksheet.getCell(rRow + 2 + i, 6).value = d.status;
            });

            worksheet.columns.forEach(col => { col.width = 18; });

            const buffer = await workbook.xlsx.writeBuffer();
            res.setHeader('Content-Disposition', 'attachment; filename="receivables-report.xlsx"');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            return res.send(buffer);
        }

        res.json({ status: true, data });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get payables report (amounts the organization OWES)
// @route   GET /api/accounts/reports/payables
// @access  Private
export const getPayablesReport = async (req, res) => {
    try {
        const { startDate, endDate, status, format } = req.query;

        const dateFilter = {};
        if (startDate || endDate) {
            dateFilter.createdAt = {};
            if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
            if (endDate) dateFilter.createdAt.$lte = new Date(endDate + 'T23:59:59.999Z');
        }

        const statusFilter = status ? { status } : { status: { $in: ['ACTIVE', 'PARTIALLY_REPAID', 'OVERDUE'] } };

        const payables = await Payable.find({ ...dateFilter, ...statusFilter })
            .populate('account', 'name type')
            .lean();

        const totalLoanAmount = payables.reduce((sum, p) => sum + p.amount, 0);
        const totalRepaid = payables.reduce((sum, p) => sum + (p.totalRepaid || 0), 0);
        const totalBalanceDue = payables.reduce((sum, p) => sum + (p.balanceDue || 0), 0);

        const data = {
            summary: {
                totalCount: payables.length,
                totalLoanAmount,
                totalRepaid,
                totalBalanceDue,
                activeCount: payables.filter(p => p.status === 'ACTIVE').length,
                partialCount: payables.filter(p => p.status === 'PARTIALLY_REPAID').length,
                overdueCount: payables.filter(p => p.status === 'OVERDUE').length
            },
            payables
        };

        if (format === 'excel') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Payables Report');

            worksheet.mergeCells('A1:I1');
            worksheet.getCell('A1').value = 'Payables Report';
            worksheet.getCell('A1').font = { bold: true, size: 14 };
            worksheet.getCell('A1').alignment = { horizontal: 'center' };

            worksheet.mergeCells('A2:I2');
            worksheet.getCell('A2').value = `From: ${startDate || 'All'} To: ${endDate || 'All'}`;
            worksheet.getCell('A2').font = { size: 10, italic: true };

            worksheet.getCell('A4').value = 'Summary';
            worksheet.getCell('A4').font = { bold: true, size: 12 };
            worksheet.getCell('A5').value = 'Total Payables';
            worksheet.getCell('B5').value = data.summary.totalCount;
            worksheet.getCell('A6').value = 'Total Loan Amount';
            worksheet.getCell('B6').value = data.summary.totalLoanAmount;
            worksheet.getCell('A7').value = 'Total Repaid';
            worksheet.getCell('B7').value = data.summary.totalRepaid;
            worksheet.getCell('A8').value = 'Total Balance Due';
            worksheet.getCell('B8').value = data.summary.totalBalanceDue;
            [5, 6, 7, 8].forEach(r => { worksheet.getRow(r).font = { bold: true }; });

            worksheet.getCell('A10').value = 'Details';
            worksheet.getCell('A10').font = { bold: true, size: 12 };
            ['Lender', 'Type', 'Loan Type', 'Amount', 'Repaid', 'Balance', 'Loan Date', 'Due Date', 'Status'].forEach((h, i) => {
                worksheet.getCell(11, i + 1).value = h;
                worksheet.getRow(11).font = { bold: true };
            });

            payables.forEach((p, i) => {
                worksheet.getCell(12 + i, 1).value = p.lenderName;
                worksheet.getCell(12 + i, 2).value = p.lenderType;
                worksheet.getCell(12 + i, 3).value = p.loanType;
                worksheet.getCell(12 + i, 4).value = p.amount;
                worksheet.getCell(12 + i, 5).value = p.totalRepaid || 0;
                worksheet.getCell(12 + i, 6).value = p.balanceDue || 0;
                worksheet.getCell(12 + i, 7).value = p.loanDate ? new Date(p.loanDate).toLocaleDateString() : '';
                worksheet.getCell(12 + i, 8).value = p.dueDate ? new Date(p.dueDate).toLocaleDateString() : '';
                worksheet.getCell(12 + i, 9).value = p.status;
            });

            worksheet.columns.forEach(col => { col.width = 18; });

            const buffer = await workbook.xlsx.writeBuffer();
            res.setHeader('Content-Disposition', 'attachment; filename="payables-report.xlsx"');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            return res.send(buffer);
        }

        res.json({ status: true, data });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};
