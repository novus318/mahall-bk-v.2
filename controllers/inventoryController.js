import InventoryItem from '../models/InventoryItem.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import mongoose from 'mongoose';
import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import InventoryReceipt from '../models/InventoryReceipt.js';
import SystemSettings from '../models/SystemSettings.js';
import WhatsAppContact from '../models/WhatsAppContact.js';
import WhatsAppMessage from '../models/WhatsAppMessage.js';
import axios from 'axios';
import PDFDocument from 'pdfkit';
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
        let items;
        if (req.query.all === 'true') {
            items = await InventoryItem.find(filter).sort('-name');
        } else {
            items = await InventoryItem.find(filter)
                .sort('-name')
                .skip(skip)
                .limit(limit);
        }

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
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Update an item
// @route   PUT /api/inventory/items/:id
export const updateItem = async (req, res) => {
    try {
        const { name, averageValue, rentalRate } = req.body;
        const item = await InventoryItem.findById(req.params.id);
        
        if (!item) {
            return res.status(404).json({ status: false, message: 'Item not found' });
        }

        item.name = name || item.name;
        item.averageValue = averageValue !== undefined ? averageValue : item.averageValue;
        item.rentalRate = rentalRate !== undefined ? rentalRate : item.rentalRate;

        await item.save();

        res.json({ status: true, message: 'Item updated successfully', data: item });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
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
        if (req.query.itemId) filter['items.itemId'] = req.query.itemId; // Filter by specific item

        const total = await InventoryTransaction.countDocuments(filter);
        const transactions = await InventoryTransaction.find(filter)
            .populate('items.itemId', 'name rentalRate')
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
    const { items, typ, customerName, customerPhone, notes } = req.body;
    try {
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ status: false, message: 'No items provided' });
        }

        let totalRentAmount = 0;
        const processedItems = [];
        const itemsToUpdate = [];

        // Validate stock and calculate rent for all items first
        for (const reqItem of items) {
            const item = await InventoryItem.findById(reqItem.itemId);
            if (!item) return res.status(404).json({ status: false, message: `Item not found: ${reqItem.itemId}` });

            if (item.availableQuantity < reqItem.quantity) {
                return res.status(400).json({ status: false, message: `Only ${item.availableQuantity} available for ${item.name}` });
            }

            let amount = 0;
            if (typ === 'RENT_OUT') {
                const rate = reqItem.rentPerUnit !== undefined ? Number(reqItem.rentPerUnit) : item.rentalRate;
                amount = Number(reqItem.quantity) * rate;
            }

            processedItems.push({
                itemId: item._id,
                quantity: reqItem.quantity,
                rentPerUnit: reqItem.rentPerUnit !== undefined ? Number(reqItem.rentPerUnit) : item.rentalRate,
                amount: amount,
                returnedQuantity: 0
            });

            totalRentAmount += amount;
            
            // Queue for update
            item.availableQuantity -= Number(reqItem.quantity);
            itemsToUpdate.push(item);
        }

        const transaction = await InventoryTransaction.create({
            items: processedItems,
            typ,
            customerName: typ === 'RENT_OUT' ? customerName : 'INTERNAL',
            customerPhone,
            totalRentAmount,
            notes,
            status: 'ACTIVE'
        });

        // Save all updated items
        for (const item of itemsToUpdate) {
            await item.save();
        }

        res.status(201).json({ status: true, data: transaction });
    } catch (error) {
        console.error("Create Transaction Error:", error);
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

        // Restore all items
        for (const reqItem of transaction.items) {
            const item = await InventoryItem.findById(reqItem.itemId);
            if (item) {
                // If partial return is implemented later, check reqItem.returnedQuantity vs quantity
                const unreturnedQty = reqItem.quantity - reqItem.returnedQuantity;
                if (unreturnedQty > 0) {
                    item.availableQuantity += unreturnedQty;
                    reqItem.returnedQuantity = reqItem.quantity;
                    await item.save();
                }
            }
        }

        transaction.status = 'RETURNED';
        transaction.returnedDate = Date.now();
        await transaction.save();

        res.json({ status: true, message: 'Items returned successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Pay Inventory Rent
// @route   POST /api/inventory/transactions/:id/pay
export const payRent = async (req, res) => {
    try {
        const { accountId, amountPaid } = req.body;
        const transaction = await InventoryTransaction.findById(req.params.id).populate('items.itemId');
        
        if (!transaction) return res.status(404).json({ status: false, message: 'Transaction not found' });
        if (!accountId) return res.status(400).json({ status: false, message: 'Deposit Account is required' });
        if (!amountPaid || Number(amountPaid) <= 0) return res.status(400).json({ status: false, message: 'Valid amount required' });

        const paymentAmount = Number(amountPaid);
        const account = await Account.findById(accountId);
        if (!account) return res.status(404).json({ status: false, message: 'Account not found' });

        // Record Partial Payment
        transaction.payments.push({
            amount: paymentAmount,
            date: Date.now(),
            accountId: account._id
        });

        transaction.paidAmount = (transaction.paidAmount || 0) + paymentAmount;
        
        // Update Account Balance
        account.balance += paymentAmount;
        await account.save();

        let receipt = null;
        let receiptNo = null;

        const combinedItemNames = transaction.items.map(i => i.itemId?.name || 'Item').join(', ');

        // Check if fully paid to generate Official Receipt
        if (transaction.paidAmount >= transaction.totalRentAmount && !transaction.receiptId) {
            const count = await InventoryReceipt.countDocuments();
            receiptNo = `INV-RC-${new Date().getFullYear()}-${count + 1}`;

            receipt = await InventoryReceipt.create({
                receiptNo,
                amount: transaction.totalRentAmount, // Receipt is for the full amount
                transactionId: transaction._id,
                account: account._id,
                payerName: transaction.customerName,
                payerPhone: transaction.customerPhone,
                description: `Full Rent payment for ${combinedItemNames}`,
                createdBy: req.user ? req.user._id : undefined
            });

            transaction.receiptId = receipt._id;
        }

        await transaction.save();

        // Log Transaction to Account
        await AccountTransaction.create({
            account: account._id,
            inventoryReceipt: receipt ? receipt._id : undefined,
            type: 'INCOME',
            amount: paymentAmount,
            balanceAfter: account.balance,
            description: receiptNo ? `Inventory Rent: ${receiptNo} from ${transaction.customerName}` : `Partial Rent payment for ${combinedItemNames} from ${transaction.customerName}`
        });

        // Send WhatsApp Notification if phone is available
        if (transaction.customerPhone && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_API_URL) {
            try {
                let phone = transaction.customerPhone.replace(/\D/g, '');
                if (phone.length === 10) phone = `91${phone}`;
                
                let contact = await WhatsAppContact.findOne({ phoneNumber: phone });
                if (!contact) {
                    contact = await WhatsAppContact.create({
                        phoneNumber: phone,
                        profileName: transaction.customerName,
                        displayName: transaction.customerName,
                        type: 'UNKNOWN'
                    });
                }

                let messageBody = `Hello ${transaction.customerName},\n\nWe have received your rent payment of ₹${paymentAmount} for *${combinedItemNames}*.`;
                
                if (receiptNo) {
                    messageBody += `\nOfficial Receipt No: ${receiptNo}`;
                }

                const pendingAmount = transaction.totalRentAmount - transaction.paidAmount;
                if (pendingAmount > 0) {
                    messageBody += `\n\nRemaining Balance: ₹${pendingAmount}.`;
                } else {
                    messageBody += `\n\nYour rent is now fully paid.`;
                }
                messageBody += `\n\nThank you!`;

                await axios.post(process.env.WHATSAPP_API_URL, {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: phone,
                    type: 'text',
                    text: { body: messageBody }
                }, {
                    headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
                });

                contact.lastMessage = `You: ${messageBody.substring(0, 50)}...`;
                contact.lastMessageAt = new Date();
                await contact.save();
            } catch (waError) {
                console.error("WhatsApp Error:", waError.message);
            }
        }

        res.json({ status: true, message: 'Payment recorded successfully', data: transaction });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get Payments (Ledger) for Transaction
// @route   GET /api/inventory/transactions/:id/receipts
export const getTransactionReceipts = async (req, res) => {
    try {
        const transaction = await InventoryTransaction.findById(req.params.id).populate('payments.accountId', 'name');
        if (!transaction) return res.status(404).json({ status: false, message: 'Transaction not found' });
        
        let receipt = null;
        if (transaction.receiptId) {
            receipt = await InventoryReceipt.findById(transaction.receiptId);
        }

        // Return payments array and final receipt if available
        res.json({ status: true, data: { payments: transaction.payments.reverse(), receipt } });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Download Inventory Receipt PDF
// @route   GET /api/inventory/receipts/:id/pdf
export const downloadInventoryReceiptPdf = async (req, res) => {
    try {
        const receipt = await InventoryReceipt.findById(req.params.id).populate({
            path: 'transactionId',
            populate: { path: 'items.itemId' }
        });

        if (!receipt) return res.status(404).json({ status: false, message: 'Receipt not found' });

        const doc = new PDFDocument({ size: 'A5', margin: 40 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Inventory-Receipt-${receipt.receiptNo}.pdf`);
        doc.pipe(res);

        const MARGIN = 40;
        const PAGE_WIDTH = 420;
        const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);
        let y = MARGIN;

        // Header
        doc.font('Helvetica-Bold').fontSize(16).text('THAYINERI JUMA MASJID', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
        y += 18;
        doc.font('Helvetica').fontSize(9).text('(TMJ)', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
        y += 15;
        doc.fontSize(8).text('458X+XVH, Thayineri Road, Thrikaripur, Kerala 670307', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
        y += 20;

        doc.lineWidth(1).moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).stroke();
        y += 15;

        // Title
        doc.font('Helvetica-Bold').fontSize(12).text('INVENTORY RENTAL RECEIPT', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
        y += 20;

        // Info Box
        doc.rect(MARGIN, y, CONTENT_WIDTH, 50).stroke();
        const midX = MARGIN + (CONTENT_WIDTH / 2);
        doc.moveTo(midX, y).lineTo(midX, y + 50).stroke();

        doc.font('Helvetica-Bold').fontSize(8).text('Receipt No:', MARGIN + 8, y + 10);
        doc.font('Helvetica').text(receipt.receiptNo, MARGIN + 60, y + 10);
        doc.font('Helvetica-Bold').text('Date:', MARGIN + 8, y + 25);
        doc.font('Helvetica').text(new Date(receipt.date).toLocaleDateString(), MARGIN + 60, y + 25);

        doc.font('Helvetica-Bold').text('From:', midX + 8, y + 10);
        doc.font('Helvetica').text(receipt.payerName, midX + 45, y + 10);

        y += 65;

        // Table
        doc.rect(MARGIN, y, CONTENT_WIDTH, 20).fillAndStroke('#000000', '#000000');
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9)
            .text('Description', MARGIN + 8, y + 6)
            .text('Amount (Rs.)', MARGIN, y + 6, { align: 'right', width: CONTENT_WIDTH - 8 });
        y += 20;

        doc.rect(MARGIN, y, CONTENT_WIDTH, 30).stroke();
        doc.fillColor('#000000').font('Helvetica').fontSize(9)
            .text(receipt.description, MARGIN + 8, y + 10, { width: CONTENT_WIDTH * 0.6 })
            .text(receipt.amount.toFixed(2), MARGIN, y + 10, { align: 'right', width: CONTENT_WIDTH - 8 });
        y += 30;

        // Total
        doc.rect(MARGIN, y, CONTENT_WIDTH, 20).fillAndStroke('#f0f0f0', '#000000');
        doc.fillColor('#000000').font('Helvetica-Bold').fontSize(10)
            .text('Total Amount', MARGIN + 8, y + 6)
            .text(`Rs. ${receipt.amount.toFixed(2)}`, MARGIN, y + 6, { align: 'right', width: CONTENT_WIDTH - 8 });

        doc.end();
    } catch (error) {
        console.error(error);
        if (!res.headersSent) res.status(500).json({ status: false, message: error.message });
    }
};
