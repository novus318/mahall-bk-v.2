import mongoose from 'mongoose';
import axios from 'axios';
import Contract from '../models/Contract.js';
import Room from '../models/Room.js';
import Payment from '../models/Payment.js';
import RentDue from '../models/RentDue.js';
import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import Receipt from '../models/Receipt.js';
import SystemSettings from '../models/SystemSettings.js';
import { generateBulkRentInternal } from '../services/contractService.js';

// @desc    Create a new contract
// @route   POST /api/contracts
// @access  Private
const createContract = async (req, res) => {
    try {
        const { tenant, roomIds, startDate, endDate, rentAmount, depositAmount } = req.body;

        const rooms = await Room.find({ _id: { $in: roomIds } });

        if (rooms.length !== roomIds.length) {
            return res.status(400).json({ message: 'One or more rooms not found' });
        }

        const occupiedRooms = rooms.filter(room => room.status !== 'VACANT');
        if (occupiedRooms.length > 0) {
            const occupiedNumbers = occupiedRooms.map(r => r.roomNumber).join(', ');
            return res.status(400).json({ message: `Rooms occupied: ${occupiedNumbers}` });
        }

        const contract = await Contract.create({
            tenant,
            rooms: roomIds,
            startDate,
            endDate,
            rentAmount,
            depositAmount,
            status: 'ACTIVE'
        });

        await Room.updateMany(
            { _id: { $in: roomIds } },
            {
                $set: {
                    status: 'OCCUPIED',
                    currentContract: contract._id
                }
            }
        );

        res.status(201).json(contract);

    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Get all contracts
// @route   GET /api/contracts
const getContracts = async (req, res) => {
    try {
        const { page = 1, limit = 10, search, status, building } = req.query;
        const query = {};

        if (status) {
            query.status = status === 'HISTORY' ? { $ne: 'ACTIVE' } : status;
        }

        if (search) {
            query.$or = [
                { 'tenant.name': { $regex: search, $options: 'i' } },
                { 'tenant.phone': { $regex: search, $options: 'i' } }
            ];
        }

        if (building) {
            const roomsInBuilding = await Room.find({ building }).select('_id');
            const roomIds = roomsInBuilding.map(r => r._id);
            query.rooms = { $in: roomIds };
        }

        const count = await Contract.countDocuments(query);
        const contracts = await Contract.find(query)
            .populate('rooms', 'roomNumber building')
            .sort({ createdAt: -1 })
            .limit(Number(limit))
            .skip((Number(page) - 1) * Number(limit));

        res.json({
            contracts,
            totalPages: Math.ceil(count / limit),
            currentPage: Number(page),
            totalContracts: count
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get single contract
// @route   GET /api/contracts/:id
const getContract = async (req, res) => {
    try {
        const contract = await Contract.findById(req.params.id)
            .populate('rooms', 'roomNumber building status');

        if (!contract) {
            return res.status(404).json({ message: 'Contract not found' });
        }
        res.json(contract);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Update a contract
// @route   PUT /api/contracts/:id
const updateContract = async (req, res) => {
    try {
        const { tenant, endDate, rentAmount } = req.body;
        const contract = await Contract.findById(req.params.id);

        if (!contract) {
            return res.status(404).json({ message: 'Contract not found' });
        }

        // Update tenant details properly
        if (tenant) {
            contract.tenant = {
                name: tenant.name ?? contract.tenant.name,
                phone: tenant.phone ?? contract.tenant.phone,
                adhaar: tenant.adhaar ?? contract.tenant.adhaar,
                place: tenant.place ?? contract.tenant.place,
                shopName: tenant.shopName !== undefined ? tenant.shopName : contract.tenant.shopName
            };
        }

        if (endDate) contract.endDate = endDate;
        if (rentAmount !== undefined) contract.rentAmount = rentAmount;

        await contract.save();

        // Fetch and return the populated contract (like GET endpoint does)
        const updatedContract = await Contract.findById(contract._id)
            .populate('rooms', 'roomNumber building status');
            
        res.json(updatedContract);
    } catch (error) {
        console.error('Update contract error:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Terminate a contract
// @route   PUT /api/contracts/:id/terminate
const terminateContract = async (req, res) => {
    try {
        const { returnAmount, accountId, notes, date } = req.body;
        const contract = await Contract.findById(req.params.id);

        if (!contract) {
            return res.status(404).json({ status: false, message: 'Contract not found' });
        }

        if (contract.status !== 'ACTIVE') {
            return res.status(400).json({ status: false, message: 'Contract is not active' });
        }

        // Handle deposit return if amount provided
        if (returnAmount !== undefined && Number(returnAmount) > 0) {
            const refundAmount = Number(returnAmount);
            const depositHeld = (contract.depositCollected || 0) - (contract.depositReturned || 0);

            if (refundAmount > depositHeld) {
                return res.status(400).json({
                    status: false,
                    message: `Return amount exceeds deposit held (₹${depositHeld})`
                });
            }

            // Validate account
            if (!accountId) {
                return res.status(400).json({ status: false, message: 'Please select an account for refund' });
            }

            const account = await Account.findById(accountId);
            if (!account) {
                return res.status(404).json({ status: false, message: 'Account not found' });
            }

            // Check account has sufficient balance
            if (account.balance < refundAmount) {
                return res.status(400).json({
                    status: false,
                    message: `Insufficient balance in account (₹${account.balance})`
                });
            }

            // Prepare payment date
            let paymentDate = new Date();
            if (date) {
                const providedDate = new Date(date);
                paymentDate.setFullYear(providedDate.getFullYear());
                paymentDate.setMonth(providedDate.getMonth());
                paymentDate.setDate(providedDate.getDate());
            }

            const session = await mongoose.startSession();
            try {
                session.startTransaction();

                account.balance -= refundAmount;
                await account.save({ session });

                await AccountTransaction.create([{
                    account: account._id,
                    contract: contract._id,
                    type: 'EXPENSE',
                    amount: refundAmount,
                    balanceAfter: account.balance,
                    date: paymentDate,
                    description: `Security Deposit Refund - ${contract.tenant.name}`
                }], { session });

                contract.depositReturned = (contract.depositReturned || 0) + refundAmount;
                contract.status = 'TERMINATED';
                await contract.save({ session });

                await Room.updateMany(
                    { _id: { $in: contract.rooms } },
                    { $set: { status: 'VACANT', currentContract: null } },
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
            contract.status = 'TERMINATED';
            await contract.save();

            await Room.updateMany(
                { _id: { $in: contract.rooms } },
                { $set: { status: 'VACANT', currentContract: null } }
            );
        }

        res.json({
            status: true,
            message: 'Contract terminated successfully',
            data: contract
        });

    } catch (error) {
        console.error('Terminate contract error:', error);
        res.status(400).json({ status: false, message: error.message });
    }
};

// --- FINANCIAL CONTROLLERS ---

const getFinancials = async (req, res) => {
    try {
        const rents = await RentDue.find({ contract: req.params.id }).sort({ monthYear: 1 });

        // Collect all receipt IDs from rent transactions
        const receiptIds = rents.flatMap(r =>
            (r.transactions || []).map(t => t.receipt).filter(Boolean)
        );

        // Fetch receipt info for all referenced receipts
        let receiptMap = {};
        if (receiptIds.length > 0) {
            const receipts = await Receipt.find({ _id: { $in: receiptIds } }).select('_id receiptNo');
            receiptMap = Object.fromEntries(receipts.map(r => [r._id.toString(), { _id: r._id, receiptNo: r.receiptNo }]));
        }

        // Enrich transactions with receipt info
        const enrichedRents = rents.map(r => {
            const doc = r.toObject();
            doc.transactions = (doc.transactions || []).map(t => ({
                ...t,
                receipt: t.receipt ? receiptMap[t.receipt.toString()] || null : null
            }));
            return doc;
        });

        // Fetch deposit transactions from AccountTransaction
        const depositTransactions = await AccountTransaction.find({
            contract: req.params.id,
            description: { $regex: /Security Deposit/i }
        }).populate('receipt', '_id receiptNo').sort({ date: -1 });

        // Format deposits to match expected frontend structure
        const deposits = depositTransactions.map(tx => ({
            _id: tx._id,
            amount: tx.amount,
            type: tx.type === 'INCOME' ? 'DEPOSIT' : 'REFUND',
            paymentDate: tx.date,
            receipt: tx.receipt ? { _id: tx.receipt._id, receiptNo: tx.receipt.receiptNo } : null
        }));

        res.json({ rents: enrichedRents, deposits });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const generateRent = async (req, res) => {
    try {
        const { month, year, amount } = req.body;
        const contractId = req.params.id;
        const monthYear = `${String(month).padStart(2, '0')}-${year}`;

        const exists = await RentDue.findOne({ contract: contractId, monthYear });
        if (exists) {
            return res.status(400).json({ message: 'Rent for this month already generated' });
        }

        const rentDue = await RentDue.create({
            contract: contractId,
            monthYear,
            amount: Number(amount),
            status: 'PENDING'
        });

        res.status(201).json(rentDue);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const payRent = async (req, res) => {
    try {
        const { amount, date, notes, accountId } = req.body;
        const rentDue = await RentDue.findById(req.params.rentId).populate('contract');

        if (!rentDue) return res.status(404).json({ message: 'Rent record not found' });

        const paymentAmount = Number(amount);
        const balance = rentDue.amount - rentDue.collectedAmount;

        if (paymentAmount > balance) {
            return res.status(400).json({ message: `Payment exceeds pending balance of ₹${balance}` });
        }

        let paymentDate = new Date();
        if (date) {
            const providedDate = new Date(date);
            paymentDate.setFullYear(providedDate.getFullYear());
            paymentDate.setMonth(providedDate.getMonth());
            paymentDate.setDate(providedDate.getDate());
        }

        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            let account = null;
            if (accountId) {
                account = await Account.findById(accountId).session(session);
                if (!account) {
                    await session.abortTransaction();
                    return res.status(404).json({ message: 'Selected Account not found' });
                }
                account.balance += paymentAmount;
                await account.save({ session });
            }

            const settings = await SystemSettings.findOneAndUpdate(
                {},
                { $inc: { 'rentSettings.receiptCurrentNumber': 1 } },
                { upsert: true, new: true, setDefaultsOnInsert: true, session }
            );
            const prefix = settings.rentSettings?.receiptPrefix || 'RNT-';
            const nextNum = settings.rentSettings?.receiptCurrentNumber || 1;
            const receiptNo = `${prefix}${new Date().getFullYear()}-${nextNum}`;

            const receipt = await Receipt.create([{
                receiptNo,
                date: paymentDate,
                amount: paymentAmount,
                type: 'INCOME',
                account: account ? account._id : undefined,
                payer: rentDue.contract.tenant.name,
                payerContact: rentDue.contract.tenant.phone,
                description: `Rent Payment - ${rentDue.monthYear} (${rentDue.contract.tenant.name})`,
                items: [{ description: `Rent for ${rentDue.monthYear}`, amount: paymentAmount }]
            }], { session });

            if (account) {
                await AccountTransaction.create([{
                    account: account._id,
                    contract: rentDue.contract._id,
                    receipt: receipt[0]._id,
                    type: 'INCOME',
                    amount: paymentAmount,
                    balanceAfter: account.balance,
                    date: paymentDate,
                    description: `Rent Payment - ${rentDue.monthYear} (${rentDue.contract.tenant.name})`
                }], { session });
            }

            rentDue.transactions.push({
                amount: paymentAmount,
                date: paymentDate,
                notes: notes,
                receipt: receipt[0]._id
            });

            const newCollected = rentDue.collectedAmount + paymentAmount;
            rentDue.collectedAmount = newCollected;
            rentDue.paymentDate = paymentDate;
            rentDue.notes = notes;

            if (newCollected >= rentDue.amount) {
                rentDue.status = 'PAID';
            } else {
                rentDue.status = 'PARTIAL';
            }

            await rentDue.save({ session });
            await session.commitTransaction();
            res.json(rentDue);
        } catch (txnError) {
            await session.abortTransaction();
            throw txnError;
        } finally {
            session.endSession();
        }
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Collect Deposit
// @route   POST /api/contracts/:id/deposit/collect
const collectDeposit = async (req, res) => {
    try {
        const { accountId, amount, date, notes } = req.body;
        const contract = await Contract.findById(req.params.id);

        if (!contract) {
            return res.status(404).json({ status: false, message: 'Contract not found' });
        }

        // Validate amount
        const depositAmount = Number(amount) || contract.depositAmount;
        const remaining = contract.depositAmount - (contract.depositCollected || 0);

        if (remaining <= 0) {
            return res.status(400).json({ status: false, message: 'Deposit already fully collected' });
        }

        if (depositAmount > remaining) {
            return res.status(400).json({
                status: false,
                message: `Amount exceeds remaining deposit of ₹${remaining}`
            });
        }

        // Validate and get account
        if (!accountId) {
            return res.status(400).json({ status: false, message: 'Please select an account' });
        }

        const account = await Account.findById(accountId);
        if (!account) {
            return res.status(404).json({ status: false, message: 'Account not found' });
        }

        // Prepare payment date (use provided date with current time)
        let paymentDate = new Date();
        if (date) {
            const providedDate = new Date(date);
            paymentDate.setFullYear(providedDate.getFullYear());
            paymentDate.setMonth(providedDate.getMonth());
            paymentDate.setDate(providedDate.getDate());
        }

        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            const settings = await SystemSettings.findOneAndUpdate(
                {},
                { $inc: { 'depositSettings.receiptCurrentNumber': 1 } },
                { upsert: true, new: true, setDefaultsOnInsert: true, session }
            );
            const prefix = settings.depositSettings?.receiptPrefix || 'SD-';
            const nextNum = settings.depositSettings?.receiptCurrentNumber || 1;
            const receiptNo = `${prefix}${new Date().getFullYear()}-${nextNum}`;

            const receipt = await Receipt.create([{
                receiptNo,
                date: paymentDate,
                amount: depositAmount,
                type: 'INCOME',
                account: account._id,
                payer: contract.tenant.name,
                payerContact: contract.tenant.phone,
                description: `Security Deposit - ${contract.tenant.name} ${contract.rooms.map(r => r.roomNumber).join(', ')}`,
                items: [{ description: 'Security Deposit', amount: depositAmount }]
            }], { session });

            account.balance += depositAmount;
            await account.save({ session });

            await AccountTransaction.create([{
                account: account._id,
                contract: contract._id,
                receipt: receipt[0]._id,
                type: 'INCOME',
                amount: depositAmount,
                balanceAfter: account.balance,
                date: paymentDate,
                description: `Security Deposit Collected - ${contract.tenant.name}`
            }], { session });

            contract.depositCollected = (contract.depositCollected || 0) + depositAmount;
            await contract.save({ session });

            await session.commitTransaction();

            res.status(201).json({
                status: true,
                message: 'Deposit collected successfully',
                data: { contract, receipt: { _id: receipt[0]._id, receiptNo: receipt[0].receiptNo } }
            });
        } catch (txnError) {
            await session.abortTransaction();
            throw txnError;
        } finally {
            session.endSession();
        }

    } catch (error) {
        console.error('Collect deposit error:', error);
        res.status(400).json({ status: false, message: error.message });
    }
};

const generateBulkRent = async (req, res) => {
    try {
        const { period } = req.body;

        const { generatedCount, skippedCount, targetPeriod } = await generateBulkRentInternal({
            period
        });

        res.json({
            status: true,
            message: `Bulk rent generation complete for ${targetPeriod}`,
            data: { generated: generatedCount, skipped: skippedCount, period: targetPeriod }
        });
    } catch (error) {
        console.error("Bulk Rent Generation Error:", error);
        res.status(500).json({ status: false, message: error.message });
    }
};

const getRentDues = async (req, res) => {
    try {
        const { contractId, status, period } = req.query;
        const query = {};
        if (contractId) query.contract = contractId;
        if (status) query.status = status;
        if (period) query.monthYear = period;

        const dues = await RentDue.find(query)
            .populate('contract', 'tenant.name tenant.phone rentAmount rooms')
            .sort({ monthYear: -1 });

        res.json({ status: true, data: dues });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

const getRentPeriods = async (req, res) => {
    try {
        const periods = await RentDue.distinct('monthYear', {});
        res.json({ status: true, data: periods.sort() });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

const getRentArrearsSummary = async (req, res) => {
    try {
        const match = { status: { $in: ['PENDING', 'PARTIAL'] } };

        const arrears = await RentDue.aggregate([
            { $match: match },
            {
                $group: {
                    _id: '$contract',
                    totalAmount: { $sum: { $subtract: ['$amount', '$collectedAmount'] } },
                    pendingCount: { $sum: 1 },
                    periods: { $push: '$monthYear' }
                }
            },
            {
                $lookup: {
                    from: 'contracts',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'contractInfo'
                }
            },
            { $unwind: { path: '$contractInfo', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    contractId: '$_id',
                    totalAmount: 1,
                    pendingCount: 1,
                    periods: 1,
                    contract: {
                        _id: '$contractInfo._id',
                        tenant: '$contractInfo.tenant',
                        rentAmount: '$contractInfo.rentAmount'
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

const sendRentReminder = async (req, res) => {
    try {
        const { contractId } = req.body;

        const dues = await RentDue.find({
            contract: contractId,
            status: { $in: ['PENDING', 'PARTIAL'] }
        }).populate('contract', 'tenant');

        if (dues.length === 0) {
            return res.status(400).json({ status: false, message: 'No pending rents found' });
        }

        const tenant = dues[0].contract?.tenant;
        if (!tenant || !tenant.phone) {
            return res.status(400).json({ status: false, message: 'No contact number found' });
        }

        const totalAmount = dues.reduce((sum, d) => sum + (d.amount - d.collectedAmount), 0);
        const periodsList = dues.map(d => d.monthYear).join(', ');

        const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
        const API_URL = process.env.WHATSAPP_API_URL;

        if (!WHATSAPP_TOKEN || !API_URL) {
            return res.status(500).json({ status: false, message: 'WhatsApp configuration missing' });
        }

        let phone = tenant.phone.replace(/\D/g, '');
        if (phone.length === 10) phone = '91' + phone;

        const payload = {
            messaging_product: 'whatsapp',
            to: phone,
            type: 'template',
            template: {
                name: 'rent_due_reminder_summary',
                language: { code: 'ml' },
                components: [
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: tenant.name || 'Tenant' },
                            { type: 'text', text: `₹${totalAmount}` },
                            { type: 'text', text: periodsList }
                        ]
                    },
                    {
                        type: 'button',
                        sub_type: 'url',
                        index: '0',
                        parameters: [
                            { type: 'text', text: 'payRent/' + contractId }
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

        res.json({ status: true, message: 'Rent reminder sent' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: error.message });
    }
};

const getPublicRentDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const contract = await Contract.findById(id).populate('rooms', 'roomNumber building');
        if (!contract) return res.status(404).json({ status: false, message: 'Contract not found' });
        res.json({ status: true, data: contract });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

const getPublicRentDues = async (req, res) => {
    try {
        const { id } = req.params;
        const dues = await RentDue.find({ contract: id }).sort({ monthYear: -1 });
        res.json({ status: true, data: dues });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export {
    createContract,
    getContracts,
    getContract,
    updateContract,
    terminateContract,
    getFinancials,
    generateRent,
    payRent,
    collectDeposit,
    generateBulkRent,
    getRentDues,
    getRentPeriods,
    getRentArrearsSummary,
    sendRentReminder,
    getPublicRentDetails,
    getPublicRentDues
};
