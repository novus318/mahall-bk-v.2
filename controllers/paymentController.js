import Payment from '../models/Payment.js';
import PaymentCategory from '../models/PaymentCategory.js';
import SystemSettings from '../models/SystemSettings.js';
import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';

// --- Categories ---

export const getPaymentCategories = async (req, res) => {
    try {
        const categories = await PaymentCategory.find({ status: 'ACTIVE' });
        res.json({ status: true, data: categories });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export const createPaymentCategory = async (req, res) => {
    try {
        const { name, description } = req.body;
        const category = await PaymentCategory.create({ name, description });
        res.status(201).json({ status: true, data: category });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export const deletePaymentCategory = async (req, res) => {
    try {
        await PaymentCategory.findByIdAndUpdate(req.params.id, { status: 'INACTIVE' });
        res.json({ status: true, message: 'Category removed' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// --- Payments ---

export const getPayments = async (req, res) => {
    try {
        const { page = 1, limit = 20, search } = req.query;
        const query = {};

        if (search) {
            query.$or = [
                { receiptNo: { $regex: search, $options: 'i' } },
                { payee: { $regex: search, $options: 'i' } }
            ];
        }

        const count = await Payment.countDocuments(query);
        const payments = await Payment.find(query)
            .populate('category', 'name')
            .populate('account', 'name')
            .populate('createdBy', 'name')
            .sort({ date: -1, createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        res.json({
            status: true,
            data: payments,
            totalPages: Math.ceil(count / limit),
            currentPage: Number(page),
            totalCount: count
        });

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
}


export const getPaymentById = async (req, res) => {
    try {
        const payment = await Payment.findById(req.params.id)
            .populate('category', 'name')
            .populate('account', 'name');

        if (!payment) return res.status(404).json({ status: false, message: 'Payment not found' });

        res.json({ status: true, data: payment });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export const createPayment = async (req, res) => {
    try {
        const { date, accountId, categoryId, payee, items, description } = req.body;

        // 1. Calculate Total
        const totalAmount = items.reduce((sum, item) => sum + Number(item.amount), 0);

        if (totalAmount <= 0) {
            return res.status(400).json({ status: false, message: 'Total amount must be greater than 0' });
        }

        // 2. Check Account Balance
        const account = await Account.findById(accountId);
        if (!account) {
            return res.status(404).json({ status: false, message: 'Account not found' });
        }

        if (account.balance < totalAmount) {
            return res.status(400).json({ status: false, message: 'Insufficient funds in selected account' });
        }

        // 3. Generate Receipt & Update Settings
        let settings = await SystemSettings.findOne();
        if (!settings) settings = await SystemSettings.create({}); // handle legacy/init
        if (!settings.paymentSettings) settings.paymentSettings = {};

        let { receiptPrefix = 'PA-', receiptCurrentNumber = 1, receiptSequenceLimit = 999 } = settings.paymentSettings; // defaults
        let receiptNo = '';
        let isUnique = false;

        // Loop to ensure uniqueness (handling race conditions/manual deletes)
        while (!isUnique) {
            receiptNo = `${receiptPrefix}${String(receiptCurrentNumber).padStart(3, '0')}`;

            const existing = await Payment.findOne({ receiptNo });
            if (!existing) {
                isUnique = true;
            } else {
                // If collision, force increment
                // Check if we need to rotate prefix
                if (receiptCurrentNumber >= receiptSequenceLimit) {
                    const prefixBase = receiptPrefix.replace(/-$/, '');
                    let lastChar = prefixBase.slice(-1);
                    let rest = prefixBase.slice(0, -1);
                    let nextChar = String.fromCharCode(lastChar.charCodeAt(0) + 1);
                    if (nextChar > 'Z') nextChar = 'A';
                    receiptPrefix = `${rest}${nextChar}-`; // Update local var for next loop
                    receiptCurrentNumber = 1;
                } else {
                    receiptCurrentNumber++;
                }
            }
        }

        // Commit the NEW next number to settings (Current + 1 for next time)
        // Note: We used 'receiptCurrentNumber' for *this* transaction. 
        // So next one should be +1.

        // Logic check: if we used PA-003, we want settings to save PA-004 as next? 
        // OR does settings store the "Current to be used"? 
        // The implementation implies 'receiptCurrentNumber' is the ONE TO BE USED.
        // So we must save the STATE for the *following* transaction.

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

        settings.paymentSettings.receiptPrefix = nextPrefix;
        settings.paymentSettings.receiptCurrentNumber = nextNum;
        await settings.save();

        // 4. Create Payment
        const payment = await Payment.create({
            receiptNo,
            date: date || new Date(),
            paymentDate: date || new Date(), // Set both for consistency
            account: accountId,
            category: categoryId,
            payee,
            items,
            amount: totalAmount, // Map totalAmount to amount schema field
            totalAmount, // Keep if desired, but schema uses 'amount'
            description,
            notes: description, // Sync description to notes
            type: 'EXPENSE',
            createdBy: req.user._id
        });

        // 5. Update Account Balance
        account.balance -= totalAmount;
        await account.save();

        // 6. Log Transaction
        await AccountTransaction.create({
            account: account._id,
            relatedAccount: null, // No related account for expense
            payment: payment._id, // Link transaction to payment
            type: 'EXPENSE',
            amount: totalAmount,
            balanceAfter: account.balance,
            date: payment.date,
            description: `Payment ${receiptNo} to ${payee}`
        });

        res.status(201).json({ status: true, data: payment, message: 'Payment created successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: error.message });
    }
};

export const updatePayment = async (req, res) => {
    try {
        const { id } = req.params;
        const { date, accountId, categoryId, payee, items, description } = req.body;

        const payment = await Payment.findById(id);
        if (!payment) return res.status(404).json({ status: false, message: 'Payment not found' });

        const originalAmount = payment.amount;
        const originalAccountId = payment.account;
        const newTotalAmount = items.reduce((sum, item) => sum + Number(item.amount), 0);

        // Robust Date Parsing with Time Preservation
        let newDate = payment.date;
        if (date) {
            // Create date object from input (usually 00:00:00)
            const inputDate = new Date(date);

            // Preserve original time components to prevent re-ordering issues
            const originalDate = new Date(payment.date);
            inputDate.setHours(originalDate.getHours());
            inputDate.setMinutes(originalDate.getMinutes());
            inputDate.setSeconds(originalDate.getSeconds());
            inputDate.setMilliseconds(originalDate.getMilliseconds());

            newDate = inputDate;
        }

        if (newTotalAmount <= 0) return res.status(400).json({ status: false, message: 'Total amount must be greater than 0' });

        // 1. Handle Account & Financial Changes
        if (String(originalAccountId) === String(accountId)) {
            // Same Account: Adjust Balance
            const account = await Account.findById(originalAccountId);
            // Logic: Balance + Old - New (Refund Old, Deduct New)
            account.balance = account.balance + originalAmount - newTotalAmount;
            await account.save();

            // Update Transaction
            await AccountTransaction.findOneAndUpdate(
                { payment: payment._id },
                {
                    amount: newTotalAmount,
                    date: newDate,
                    balanceAfter: account.balance,
                    description: `Payment ${payment.receiptNo} to ${payee}`
                }
            );
        } else {
            // Account Changed
            // A. Revert Old Account
            const oldAccount = await Account.findById(originalAccountId);
            oldAccount.balance += originalAmount;
            await oldAccount.save();

            // Delete Old Transaction
            await AccountTransaction.findOneAndDelete({ payment: payment._id });

            // B. Apply to New Account
            const newAccount = await Account.findById(accountId);
            // Check balance for the NEW amount (since old is refunded to old account)
            if (newAccount.balance < newTotalAmount) {
                return res.status(400).json({ status: false, message: `Insufficient funds in new account` });
            }
            newAccount.balance -= newTotalAmount;
            await newAccount.save();

            // Create New Transaction
            await AccountTransaction.create({
                account: newAccount._id,
                payment: payment._id,
                type: 'EXPENSE',
                amount: newTotalAmount,
                balanceAfter: newAccount.balance,
                date: newDate,
                description: `Payment ${payment.receiptNo} to ${payee}`
            });
        }

        // 2. Update Payment Record
        payment.date = newDate;
        payment.paymentDate = newDate;
        payment.account = accountId;
        payment.category = categoryId;
        payment.payee = payee;
        payment.items = items;
        payment.amount = newTotalAmount;
        payment.description = description;
        payment.notes = description;

        await payment.save();

        res.json({ status: true, data: payment, message: 'Payment updated successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: error.message });
    }
};
