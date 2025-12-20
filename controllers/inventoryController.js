import InventoryItem from '../models/InventoryItem.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import mongoose from 'mongoose';

// @desc    Get all inventory items with Pagination & Search
// @route   GET /api/inventory/items
export const getItems = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const search = req.query.search || '';

        const filter = {};
        if (search) {
            filter.name = { $regex: search, $options: 'i' };
        }

        const total = await InventoryItem.countDocuments(filter);
        const items = await InventoryItem.find(filter)
            .sort('-name')
            .skip(skip)
            .limit(limit);

        res.json({
            status: true,
            data: items,
            pagination: {
                current: page,
                pages: Math.ceil(total / limit),
                total
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Create new item
// @route   POST /api/inventory/items
export const createItem = async (req, res) => {
    const { name, totalQuantity, averageValue, rentalRate } = req.body;
    try {
        const item = await InventoryItem.create({
            name,
            totalQuantity,
            availableQuantity: totalQuantity, // Initially all available
            averageValue,
            rentalRate,
            history: [{ typ: 'RESTOCK', quantity: totalQuantity, cost: averageValue }]
        });
        res.status(201).json({ status: true, data: item });
    } catch (error) {
        res.status(400).json({ status: false, message: error.message });
    }
};

// @desc    Restock item (Add quantity & Recalc WAC)
// @route   PUT /api/inventory/items/:id/restock
export const restockItem = async (req, res) => {
    const { quantity, unitCost } = req.body; // New Quantity and Cost per unit
    try {
        const item = await InventoryItem.findById(req.params.id);
        if (!item) return res.status(404).json({ status: false, message: 'Item not found' });

        // Calculate Weighted Average Cost
        // NewAvg = ((OldQty * OldAvg) + (NewQty * NewCost)) / (OldQty + NewQty)
        const totalOldValue = item.totalQuantity * item.averageValue;
        const totalNewValue = Number(quantity) * Number(unitCost);
        const newTotalQty = item.totalQuantity + Number(quantity);

        const newAverageValue = (totalOldValue + totalNewValue) / newTotalQty;

        item.totalQuantity = newTotalQty;
        item.availableQuantity += Number(quantity);
        item.averageValue = newAverageValue;
        item.history.push({ typ: 'RESTOCK', quantity: Number(quantity), cost: Number(unitCost) });

        await item.save();

        res.json({ status: true, data: item, message: 'Restocked successfully' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Report Damaged Item (Write-off)
// @route   PUT /api/inventory/items/:id/damage
export const reportDamage = async (req, res) => {
    const { quantity, notes } = req.body;
    try {
        const item = await InventoryItem.findById(req.params.id);
        if (!item) return res.status(404).json({ status: false, message: 'Item not found' });

        if (item.availableQuantity < quantity) {
            return res.status(400).json({ status: false, message: `Only ${item.availableQuantity} available to write off` });
        }

        item.totalQuantity -= Number(quantity);
        item.availableQuantity -= Number(quantity);

        // Cost is current average value (loss)
        item.history.push({
            typ: 'DAMAGE',
            quantity: Number(quantity),
            cost: item.averageValue
        });

        await item.save();

        res.json({ status: true, data: item, message: 'Logged as damaged' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get active rentals/transactions with Pagination
// @route   GET /api/inventory/transactions
export const getTransactions = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10; // Default 10, user might ask for 5
        const skip = (page - 1) * limit;

        // Build filter object
        const filter = {};
        if (!req.query.all) filter.status = 'ACTIVE'; // Default to active only unless ?all=true
        if (req.query.itemId) filter.itemId = req.query.itemId; // Filter by specific item

        const total = await InventoryTransaction.countDocuments(filter);
        const transactions = await InventoryTransaction.find(filter)
            .populate('itemId', 'name rentalRate')
            .sort('-issuedDate')
            .skip(skip)
            .limit(limit);

        res.json({
            status: true,
            data: transactions,
            pagination: {
                current: page,
                pages: Math.ceil(total / limit),
                total
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get paginated restock history for an item
// @route   GET /api/inventory/items/:id/restock-history
export const getItemRestockHistory = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const skip = (page - 1) * limit;

        // Get total count of history entries
        const countResult = await InventoryItem.aggregate([
            { $match: { _id: new mongoose.Types.ObjectId(req.params.id) } },
            { $project: { count: { $size: "$history" } } }
        ]);

        const total = countResult.length > 0 ? countResult[0].count : 0;

        // Fetch sliced history (Note: $slice with negative usually gets last N, but for pagination we want standard order or reverse?)
        // Usually history is pushed (oldest first). We probably want newest first (reverse).
        // Mongoose slice [skip, limit] slices from start.
        // To get "newest" (end of array) with slice is tricky with skip/limit logic unless we reverse array first (expensive).
        // Better: Use aggregation to $unwind, $sort, $skip, $limit.

        const historyData = await InventoryItem.aggregate([
            { $match: { _id: new mongoose.Types.ObjectId(req.params.id) } },
            { $project: { history: 1 } },
            { $unwind: "$history" },
            { $sort: { "history.date": -1 } }, // Newest first
            { $skip: skip },
            { $limit: limit },
            { $replaceRoot: { newRoot: "$history" } }
        ]);

        res.json({
            status: true,
            data: historyData,
            pagination: {
                current: page,
                pages: Math.ceil(total / limit),
                total
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Create Transaction (Rent Out / Issue)
// @route   POST /api/inventory/transactions
export const createTransaction = async (req, res) => {
    // typ: 'RENT_OUT' | 'USE_INTERNAL'
    const { itemId, typ, quantity, customerName, customerPhone, notes, rentPerUnit } = req.body;
    try {
        const item = await InventoryItem.findById(itemId);
        if (!item) return res.status(404).json({ status: false, message: 'Item not found' });

        if (item.availableQuantity < quantity) {
            return res.status(400).json({ status: false, message: `Only ${item.availableQuantity} available` });
        }

        let rentAmount = 0;
        if (typ === 'RENT_OUT') {
            const rate = rentPerUnit !== undefined ? Number(rentPerUnit) : item.rentalRate;
            rentAmount = Number(quantity) * rate;
        }

        const transaction = await InventoryTransaction.create({
            itemId,
            typ,
            quantity,
            customerName: typ === 'RENT_OUT' ? customerName : 'INTERNAL',
            customerPhone,
            totalRentAmount: rentAmount,
            notes,
            status: 'ACTIVE'
        });

        // Decrement available quantity
        item.availableQuantity -= Number(quantity);
        await item.save();

        res.status(201).json({ status: true, data: transaction });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Return Items
// @route   PUT /api/inventory/transactions/:id/return
export const returnTransaction = async (req, res) => {
    try {
        const transaction = await InventoryTransaction.findById(req.params.id);
        if (!transaction) return res.status(404).json({ status: false, message: 'Transaction not found' });

        if (transaction.status === 'RETURNED') {
            return res.status(400).json({ status: false, message: 'Already returned' });
        }

        const item = await InventoryItem.findById(transaction.itemId);
        if (item) {
            item.availableQuantity += transaction.quantity;
            await item.save();
        }

        transaction.status = 'RETURNED';
        transaction.returnedDate = Date.now();
        await transaction.save();

        res.json({ status: true, message: 'Items returned successfully' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};
