import Contract from '../models/Contract.js';
import Room from '../models/Room.js';
import Payment from '../models/Payment.js';
import RentDue from '../models/RentDue.js';

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

        if (contract) {
            if (tenant) contract.tenant = { ...contract.tenant, ...tenant };
            if (endDate) contract.endDate = endDate;
            if (rentAmount) contract.rentAmount = rentAmount;

            const updatedContract = await contract.save();
            res.json(updatedContract);
        } else {
            res.status(404).json({ message: 'Contract not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Terminate a contract
// @route   PUT /api/contracts/:id/terminate
const terminateContract = async (req, res) => {
    try {
        const { returnAmount, notes } = req.body;
        const contract = await Contract.findById(req.params.id);
        if (!contract) return res.status(404).json({ message: 'Contract not found' });
        if (contract.status !== 'ACTIVE') return res.status(400).json({ message: 'Contract is not active' });

        if (returnAmount !== undefined && Number(returnAmount) >= 0) {
            await Payment.create({
                contract: contract._id,
                amount: Number(returnAmount),
                type: 'REFUND',
                paymentDate: Date.now(),
                notes: notes || 'Deposit refund on termination'
            });
        }

        contract.status = 'TERMINATED';
        await contract.save();

        await Room.updateMany(
            { _id: { $in: contract.rooms } },
            { $set: { status: 'VACANT', currentContract: null } }
        );

        res.json({ message: 'Contract terminated', contract });

    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// --- FINANCIAL CONTROLLERS ---

const getFinancials = async (req, res) => {
    try {
        const rents = await RentDue.find({ contract: req.params.id }).sort({ monthYear: 1 });
        const deposits = await Payment.find({
            contract: req.params.id,
            type: { $in: ['DEPOSIT', 'REFUND'] }
        }).sort({ paymentDate: -1 });

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
        const { amount, date, notes } = req.body;
        const rentDue = await RentDue.findById(req.params.rentId);

        if (!rentDue) return res.status(404).json({ message: 'Rent record not found' });

        const paymentAmount = Number(amount);
        const balance = rentDue.amount - rentDue.collectedAmount;

        if (paymentAmount > balance) {
            return res.status(400).json({ message: `Payment exceeds pending balance of ₹${balance}` });
        }

        rentDue.transactions.push({
            amount: paymentAmount,
            date: date || Date.now(),
            notes: notes
        });

        const newCollected = rentDue.collectedAmount + paymentAmount;
        rentDue.collectedAmount = newCollected;
        rentDue.paymentDate = date || Date.now(); // Update last payment date
        rentDue.notes = notes; // Update latest note

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

// @desc    Collect Full Deposit
// @route   POST /api/contracts/:id/deposit/collect
const collectDeposit = async (req, res) => {
    try {
        const contract = await Contract.findById(req.params.id);
        if (!contract) return res.status(404).json({ message: 'Contract not found' });

        // Calculate currently held
        const deposits = await Payment.find({ contract: contract._id, type: { $in: ['DEPOSIT', 'REFUND'] } });
        const paid = deposits.filter(p => p.type === 'DEPOSIT').reduce((sum, p) => sum + p.amount, 0);
        const refunded = deposits.filter(p => p.type === 'REFUND').reduce((sum, p) => sum + p.amount, 0);
        const held = paid - refunded;

        const remaining = contract.depositAmount - held;

        if (remaining <= 0) {
            return res.status(400).json({ message: 'Deposit already fully collected' });
        }

        const payment = await Payment.create({
            contract: contract._id,
            amount: remaining,
            type: 'DEPOSIT',
            paymentDate: Date.now(),
            notes: 'Initial Security Deposit'
        });

        res.status(201).json(payment);
    } catch (error) {
        res.status(400).json({ message: error.message });
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
