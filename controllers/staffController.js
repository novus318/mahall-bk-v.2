import Staff from '../models/Staff.js';
import Payslip from '../models/Payslip.js';
import StaffTransaction from '../models/StaffTransaction.js';

// @desc    Create new staff
// @route   POST /api/staff
// @access  Private
export const createStaff = async (req, res) => {
    try {
        const { name, dob, employeeId, department, position, baseSalary, phone, email, joinDate } = req.body;

        const staffExists = await Staff.findOne({ employeeId });
        if (staffExists) {
            return res.status(400).json({ status: false, message: 'Staff with this Employee ID already exists' });
        }

        const staff = await Staff.create({
            name,
            dob,
            employeeId,
            department,
            position,
            baseSalary,
            phone,
            email,
            joinDate: joinDate || Date.now()
        });

        res.status(201).json({
            status: true,
            data: staff
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get all staff with pagination and search
// @route   GET /api/staff
// @access  Private
export const getStaff = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const skip = (page - 1) * limit;

        const query = {};
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { employeeId: { $regex: search, $options: 'i' } },
                { department: { $regex: search, $options: 'i' } }
            ];
        }

        const total = await Staff.countDocuments(query);
        const pages = Math.ceil(total / limit);

        const staff = await Staff.find(query)
            .sort({ name: 1 })
            .skip(skip)
            .limit(limit);

        res.json({
            status: true,
            data: staff,
            page,
            pages,
            total
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get staff by ID with financials
// @route   GET /api/staff/:id
// @access  Private
export const getStaffById = async (req, res) => {
    try {
        const staff = await Staff.findById(req.params.id);
        if (!staff) {
            return res.status(404).json({ status: false, message: 'Staff not found' });
        }

        const payslips = await Payslip.find({ staff: staff._id }).sort({ generatedDate: -1 });
        const transactions = await StaffTransaction.find({ staff: staff._id }).sort({ date: -1 }).limit(20);

        res.json({
            status: true,
            data: {
                staff,
                payslips,
                transactions
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Update staff
// @route   PUT /api/staff/:id
// @access  Private
export const updateStaff = async (req, res) => {
    try {
        const staff = await Staff.findById(req.params.id);
        if (!staff) {
            return res.status(404).json({ status: false, message: 'Staff not found' });
        }

        const updatedStaff = await Staff.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json({ status: true, data: updatedStaff });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Give Advance
// @route   POST /api/staff/:id/advance
// @access  Private
export const giveAdvance = async (req, res) => {
    try {
        const { amount, notes } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ status: false, message: 'Valid amount required' });
        }

        const staff = await Staff.findById(req.params.id);
        if (!staff) {
            return res.status(404).json({ status: false, message: 'Staff not found' });
        }

        // Update Staff Balance
        staff.currentAdvance += Number(amount);
        await staff.save();

        // Log Transaction
        await StaffTransaction.create({
            staff: staff._id,
            type: 'ADVANCE_GIVEN',
            amount: amount,
            notes: notes || 'Advance given',
            date: new Date()
        });

        res.json({ status: true, message: 'Advance given successfully', data: staff });

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Generate Payslip
// @route   POST /api/staff/:id/payslips
// @access  Private
export const generatePayslip = async (req, res) => {
    try {
        const { month, year } = req.body; // Only Month/Year needed now

        const staff = await Staff.findById(req.params.id);
        if (!staff) {
            return res.status(404).json({ status: false, message: 'Staff not found' });
        }

        const monthYear = `${String(month).padStart(2, '0')}-${year}`;

        // Check if already exists
        const exists = await Payslip.findOne({ staff: staff._id, monthYear });
        if (exists) {
            return res.status(400).json({ status: false, message: `Payslip for ${monthYear} already exists` });
        }

        // Create Initial Payslip (PENDING, Full Salary, No Deductions yet)
        const payslip = await Payslip.create({
            staff: staff._id,
            monthYear,
            baseSalary: staff.baseSalary,
            leaveDays: 0,
            leaveDeduction: 0,
            advanceDeduction: 0,
            finalAmount: staff.baseSalary, // Default to base
            status: 'PENDING'
        });

        res.json({ status: true, message: 'Payslip generated', data: payslip });

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Mark Payslip as Paid
// @route   PUT /api/staff/:id/payslips/:payslipId/pay
// @access  Private
export const markPayslipPaid = async (req, res) => {
    try {
        const { leaveDays = 0, advanceDeduction = 0 } = req.body;

        const payslip = await Payslip.findById(req.params.payslipId).populate('staff');
        if (!payslip) {
            return res.status(404).json({ status: false, message: 'Payslip not found' });
        }

        if (payslip.status === 'PAID') {
            return res.status(400).json({ status: false, message: 'Payslip already paid' });
        }

        const staff = payslip.staff;

        // Validate Advance Deduction
        if (advanceDeduction > 0 && advanceDeduction > staff.currentAdvance) {
            return res.status(400).json({
                status: false,
                message: `Advance deduction (₹${advanceDeduction}) cannot exceed current balance (₹${staff.currentAdvance})`
            });
        }

        // Final Calculations
        const leaveDeduction = Math.round((payslip.baseSalary / 30) * leaveDays);
        const finalAmount = Math.max(0, payslip.baseSalary - leaveDeduction - advanceDeduction);

        // Update Payslip
        payslip.leaveDays = leaveDays;
        payslip.leaveDeduction = leaveDeduction;
        payslip.advanceDeduction = advanceDeduction;
        payslip.finalAmount = finalAmount;
        payslip.status = 'PAID';
        payslip.paymentDate = new Date();

        await payslip.save();

        // Handle Advance Repayment
        if (advanceDeduction > 0) {
            staff.currentAdvance -= advanceDeduction;
            await staff.save();

            await StaffTransaction.create({
                staff: staff._id,
                type: 'ADVANCE_REPAID',
                amount: advanceDeduction,
                notes: `Repayment via Payslip ${payslip.monthYear}`,
                date: new Date()
            });
        }

        // Log Salary Payment (Gross Amount to reflect full entitlement)
        await StaffTransaction.create({
            staff: staff._id,
            type: 'SALARY_PAYMENT',
            amount: payslip.baseSalary - leaveDeduction,
            notes: `Salary Payment for ${payslip.monthYear}`,
            date: new Date()
        });

        res.json({ status: true, message: 'Payslip paid successfully', data: payslip });

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};
