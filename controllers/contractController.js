import Contract from '../models/Contract.js';
import Room from '../models/Room.js';
import Payment from '../models/Payment.js';
import RentDue from '../models/RentDue.js';
import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';

// ... (Existing Imports)

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

            // Update account balance
            account.balance -= refundAmount;
            await account.save();

            // Create Account Transaction
            await AccountTransaction.create({
                account: account._id,
                contract: contract._id,
                type: 'EXPENSE',
                amount: refundAmount,
                balanceAfter: account.balance,
                date: paymentDate,
                description: `Security Deposit Refund - ${contract.tenant.name}`
            });

            // Update contract deposit returned amount
            contract.depositReturned = (contract.depositReturned || 0) + refundAmount;
        }

        // Terminate contract
        contract.status = 'TERMINATED';
        await contract.save();

        // Vacate rooms
        await Room.updateMany(
            { _id: { $in: contract.rooms } },
            { $set: { status: 'VACANT', currentContract: null } }
        );

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

        // Fetch deposit transactions from AccountTransaction
        const depositTransactions = await AccountTransaction.find({
            contract: req.params.id,
            description: { $regex: /Security Deposit/i }
        }).sort({ date: -1 });

        // Format deposits to match expected frontend structure
        const deposits = depositTransactions.map(tx => ({
            _id: tx._id,
            amount: tx.amount,
            type: tx.type === 'INCOME' ? 'DEPOSIT' : 'REFUND',
            paymentDate: tx.date
        }));

        res.json({ rents, deposits });
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
        const rentDue = await RentDue.findById(req.params.rentId).populate('contract'); // Populate contract for linking

        if (!rentDue) return res.status(404).json({ message: 'Rent record not found' });

        const paymentAmount = Number(amount);
        const balance = rentDue.amount - rentDue.collectedAmount;

        if (paymentAmount > balance) {
            return res.status(400).json({ message: `Payment exceeds pending balance of ₹${balance}` });
        }

        // Logic to preserve current time if date is today or just merge provided date with current time components
        // Actually, user standard practice: if they pick a date, usually they mean "that day".
        // BUT user asked: "time should be taken current time"
        // So we take the Provided Date (Year, Month, Day) and Current Time (Hours, Minutes, Seconds)

        let paymentDate = new Date();
        if (date) {
            const providedDate = new Date(date);
            paymentDate.setFullYear(providedDate.getFullYear());
            paymentDate.setMonth(providedDate.getMonth());
            paymentDate.setDate(providedDate.getDate());
            // Hours/Minutes/Seconds remain from 'new Date()' (now)
        }

        // --- Account Integration Start ---
        if (accountId) {
            // 1. Validate Account
            const account = await Account.findById(accountId);
            if (!account) return res.status(404).json({ message: 'Selected Account not found' });

            // 2. Update Balance (Income - Credit)
            account.balance += paymentAmount;
            await account.save();

            // 3. Create Account Transaction
            await AccountTransaction.create({
                account: account._id,
                contract: rentDue.contract._id, // Link to Contract/Tenant
                type: 'INCOME',
                amount: paymentAmount,
                balanceAfter: account.balance,
                date: paymentDate,
                description: `Rent Payment - ${rentDue.monthYear} (${rentDue.contract.tenant.name})`
            });
        }
        // --- Account Integration End ---

        rentDue.transactions.push({
            amount: paymentAmount,
            date: paymentDate,
            notes: notes
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

        await rentDue.save();
        res.json(rentDue);
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

        // Update account balance
        account.balance += depositAmount;
        await account.save();

        // Create Account Transaction
        await AccountTransaction.create({
            account: account._id,
            contract: contract._id,
            type: 'INCOME',
            amount: depositAmount,
            balanceAfter: account.balance,
            date: paymentDate,
            description: `Security Deposit Collected - ${contract.tenant.name}`
        });

        // Update contract deposit collected amount
        contract.depositCollected = (contract.depositCollected || 0) + depositAmount;
        await contract.save();

        res.status(201).json({
            status: true,
            message: 'Deposit collected successfully',
            data: { contract }
        });

    } catch (error) {
        console.error('Collect deposit error:', error);
        res.status(400).json({ status: false, message: error.message });
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
    collectDeposit // Renamed from manageDeposit
};
