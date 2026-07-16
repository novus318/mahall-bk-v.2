import mongoose from 'mongoose';
import Payable from '../models/Payable.js';
import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';

// @desc    Create new loan/credit (Payable)
// @route   POST /api/payables
// @access  Private
export const createPayable = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const {
            lenderName,
            lenderContact,
            lenderType,
            loanType,
            amount,
            interestRate,
            loanDate,
            dueDate,
            account: accountId,
            purpose,
            notes
        } = req.body;

        // Validate account
        const account = await Account.findById(accountId).session(session);
        if (!account) {
            await session.abortTransaction();
            return res.status(404).json({ status: false, message: 'Account not found' });
        }

        const loanAmount = Number(amount);

        // Prevent duplicate: same lender, type, amount, and loanDate
        const dupDate = loanDate ? new Date(loanDate) : new Date();
        const dupStart = new Date(dupDate);
        dupStart.setDate(dupStart.getDate() - 1);
        const dupEnd = new Date(dupDate);
        dupEnd.setDate(dupEnd.getDate() + 1);

        const existing = await Payable.findOne({
            lenderName,
            loanType,
            amount: loanAmount,
            loanDate: { $gte: dupStart, $lte: dupEnd },
            status: { $ne: 'CANCELLED' }
        }).session(session);

        if (existing) {
            await session.abortTransaction();
            return res.status(409).json({ status: false, message: 'A duplicate loan with the same lender, type, amount and date already exists. Please verify before proceeding.' });
        }

        // Create the payable record using new and save() instead of create()
        const payable = new Payable({
            lenderName,
            lenderContact,
            lenderType,
            loanType,
            amount: loanAmount,
            interestRate: Number(interestRate) || 0,
            balanceDue: loanAmount,
            loanDate: loanDate ? new Date(loanDate) : new Date(),
            dueDate: dueDate ? new Date(dueDate) : null,
            account: accountId,
            purpose,
            notes,
            createdBy: req.user?._id
        });
        
        await payable.save({ session });

        // Add loan amount to account balance
        account.balance += loanAmount;
        await account.save({ session });

        // Create account transaction for loan received
        const transaction = new AccountTransaction({
            account: accountId,
            payable: payable._id,
            type: 'LOAN_RECEIVED',
            amount: loanAmount,
            balanceAfter: account.balance,
            date: loanDate ? new Date(loanDate) : new Date(),
            description: `${loanType || 'Loan'} received from ${lenderName}${purpose ? ' - ' + purpose : ''}`
        });
        
        await transaction.save({ session });

        // Update payable with transaction reference
        payable.initialTransaction = transaction._id;
        await payable.save({ session });

        await session.commitTransaction();

        res.status(201).json({
            status: true,
            message: 'Loan/Credit recorded successfully',
            data: payable
        });
    } catch (error) {
        console.log(error);
        await session.abortTransaction();
        res.status(500).json({ status: false, message: error.message });
    } finally {
        session.endSession();
    }
};

// @desc    Get all payables
// @route   GET /api/payables
// @access  Private
export const getPayables = async (req, res) => {
    try {
        const { status, lenderType, loanType, search } = req.query;
        
        const query = {};
        
        if (status && status !== 'ALL') query.status = status;
        if (lenderType && lenderType !== 'ALL') query.lenderType = lenderType;
        if (loanType && loanType !== 'ALL') query.loanType = loanType;
        
        if (search) {
            query.$or = [
                { lenderName: { $regex: search, $options: 'i' } },
                { lenderContact: { $regex: search, $options: 'i' } },
                { purpose: { $regex: search, $options: 'i' } }
            ];
        }

        const payables = await Payable.find(query)
            .populate('account', 'name type')
            .populate('createdBy', 'name')
            .populate('repayments.account', 'name')
            .sort({ createdAt: -1 });

        // Calculate summary
        const summary = {
            totalLoans: payables.length,
            totalAmount: payables.reduce((sum, p) => sum + p.amount, 0),
            totalRepaid: payables.reduce((sum, p) => sum + p.totalRepaid, 0),
            totalDue: payables.reduce((sum, p) => sum + p.balanceDue, 0),
            activeCount: payables.filter(p => p.status === 'ACTIVE' || p.status === 'PARTIALLY_REPAID').length,
            overdueCount: payables.filter(p => p.status === 'OVERDUE').length
        };

        res.json({
            status: true,
            data: payables,
            summary
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get single payable
// @route   GET /api/payables/:id
// @access  Private
export const getPayableById = async (req, res) => {
    try {
        const payable = await Payable.findById(req.params.id)
            .populate('account', 'name type balance')
            .populate('createdBy', 'name')
            .populate('repayments.account', 'name type')
            .populate('initialTransaction')
            .populate('repayments.transaction');

        if (!payable) {
            return res.status(404).json({ status: false, message: 'Payable not found' });
        }

        res.json({
            status: true,
            data: payable
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Update payable
// @route   PUT /api/payables/:id
// @access  Private
export const updatePayable = async (req, res) => {
    try {
        const payable = await Payable.findById(req.params.id);
        
        if (!payable) {
            return res.status(404).json({ status: false, message: 'Payable not found' });
        }

        // Only allow updates if not fully repaid
        if (payable.status === 'REPAID') {
            return res.status(400).json({ status: false, message: 'Cannot update fully repaid loan' });
        }

        const allowedUpdates = ['lenderName', 'lenderContact', 'lenderType', 'dueDate', 'purpose', 'notes', 'interestRate'];
        
        allowedUpdates.forEach(field => {
            if (req.body[field] !== undefined) {
                payable[field] = req.body[field];
            }
        });

        await payable.save();

        res.json({
            status: true,
            message: 'Payable updated successfully',
            data: payable
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Record repayment
// @route   POST /api/payables/:id/repay
// @access  Private
export const recordRepayment = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { amount, account: accountId, date, notes } = req.body;
        const payableId = req.params.id;

        const payable = await Payable.findById(payableId).session(session);
        if (!payable) {
            await session.abortTransaction();
            return res.status(404).json({ status: false, message: 'Payable not found' });
        }

        // Check if already fully repaid
        if (payable.status === 'REPAID') {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'Loan already fully repaid' });
        }

        // Validate account
        const account = await Account.findById(accountId).session(session);
        if (!account) {
            await session.abortTransaction();
            return res.status(404).json({ status: false, message: 'Account not found' });
        }

        const repaymentAmount = Number(amount);

        // Check account balance
        if (account.balance < repaymentAmount) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'Insufficient funds in account' });
        }

        // Check if repayment exceeds balance due
        const actualRepayment = Math.min(repaymentAmount, payable.balanceDue);

        // Deduct from account
        account.balance -= actualRepayment;
        await account.save({ session });

        // Create transaction record
        const transaction = new AccountTransaction({
            account: accountId,
            payable: payableId,
            type: 'LOAN_REPAYMENT',
            amount: actualRepayment,
            balanceAfter: account.balance,
            date: date ? new Date(date) : new Date(),
            description: `Repayment to ${payable.lenderName}${notes ? ' - ' + notes : ''}`
        });
        
        await transaction.save({ session });

        // Add to repayments array
        payable.repayments.push({
            amount: actualRepayment,
            date: date ? new Date(date) : new Date(),
            account: accountId,
            notes,
            transaction: transaction._id
        });

        // Update totals
        payable.totalRepaid += actualRepayment;
        payable.balanceDue -= actualRepayment;

        await payable.save({ session });

        await session.commitTransaction();

        res.json({
            status: true,
            message: 'Repayment recorded successfully',
            data: payable
        });
    } catch (error) {
        await session.abortTransaction();
        res.status(500).json({ status: false, message: error.message });
    } finally {
        session.endSession();
    }
};

// @desc    Delete payable (only if no repayments)
// @route   DELETE /api/payables/:id
// @access  Private
export const deletePayable = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const payable = await Payable.findById(req.params.id).session(session);
        
        if (!payable) {
            await session.abortTransaction();
            return res.status(404).json({ status: false, message: 'Payable not found' });
        }

        // Only allow delete if no repayments have been made
        if (payable.totalRepaid > 0) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'Cannot delete payable with repayments. Please mark as cancelled instead.' });
        }

        // Reverse the loan amount from account
        const account = await Account.findById(payable.account).session(session);
        if (account) {
            if (account.balance < payable.amount) {
                await session.abortTransaction();
                return res.status(400).json({
                    status: false,
                    message: `Insufficient balance to reverse loan (Available: ₹${account.balance}, Required: ₹${payable.amount})`
                });
            }

            account.balance -= payable.amount;
            await account.save({ session });

            // Create reversal transaction
            const reversalTx = new AccountTransaction({
                account: account._id,
                type: 'EXPENSE',
                amount: payable.amount,
                balanceAfter: account.balance,
                date: new Date(),
                description: `Loan deletion reversal - ${payable.lenderName}`
            });
            await reversalTx.save({ session });
        }

        // Delete the initial transaction
        if (payable.initialTransaction) {
            await AccountTransaction.findByIdAndDelete(payable.initialTransaction).session(session);
        }

        // Delete the payable
        await Payable.findByIdAndDelete(req.params.id).session(session);

        await session.commitTransaction();

        res.json({
            status: true,
            message: 'Payable deleted successfully'
        });
    } catch (error) {
        await session.abortTransaction();
        res.status(500).json({ status: false, message: error.message });
    } finally {
        session.endSession();
    }
};

// @desc    Get payable summary/stats
// @route   GET /api/payables/summary/stats
// @access  Private
export const getPayableStats = async (req, res) => {
    try {
        const stats = await Payable.aggregate([
            {
                $group: {
                    _id: null,
                    totalLoans: { $sum: 1 },
                    totalAmount: { $sum: '$amount' },
                    totalRepaid: { $sum: '$totalRepaid' },
                    totalDue: { $sum: '$balanceDue' }
                }
            }
        ]);

        const statusCounts = await Payable.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]);

        const typeStats = await Payable.aggregate([
            {
                $group: {
                    _id: '$loanType',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$amount' }
                }
            }
        ]);

        res.json({
            status: true,
            data: {
                summary: stats[0] || { totalLoans: 0, totalAmount: 0, totalRepaid: 0, totalDue: 0 },
                statusCounts,
                typeStats
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Mark payable as cancelled
// @route   PUT /api/payables/:id/cancel
// @access  Private
export const cancelPayable = async (req, res) => {
    try {
        const payable = await Payable.findById(req.params.id);
        
        if (!payable) {
            return res.status(404).json({ status: false, message: 'Payable not found' });
        }

        if (payable.status === 'REPAID') {
            return res.status(400).json({ status: false, message: 'Cannot cancel fully repaid loan' });
        }

        payable.status = 'CANCELLED';
        await payable.save();

        res.json({
            status: true,
            message: 'Payable marked as cancelled',
            data: payable
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};
