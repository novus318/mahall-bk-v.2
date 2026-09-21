import Staff from '../models/Staff.js';
import Payslip from '../models/Payslip.js';
import StaffTransaction from '../models/StaffTransaction.js';
import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import SystemSettings from '../models/SystemSettings.js';
import axios from 'axios';
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';

// @desc    Create new staff
// @route   POST /api/staff
// @access  Private
export const createStaff = async (req, res) => {
    try {
        const { name, dob, employeeId, department, position, baseSalary, phone, email, joinDate, address, emergencyContact, qualifications, religiousQualifications, aadhaarNumber, bankAccount, otherAllowance, jobDescription, additionalInfo } = req.body;

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
            joinDate: joinDate || Date.now(),
            address,
            emergencyContact,
            qualifications,
            religiousQualifications,
            aadhaarNumber,
            bankAccount,
            otherAllowance: otherAllowance || 0,
            jobDescription,
            additionalInfo
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
            // Allow regeneration if REJECTED
            if (exists.status === 'REJECTED') {
                exists.status = 'PENDING';
                exists.baseSalary = staff.baseSalary;
                exists.leaveDays = 0;
                exists.leaveDeduction = 0;
                exists.advanceDeduction = 0;
                exists.finalAmount = staff.baseSalary;
                exists.rejectionOtp = undefined;
                exists.rejectionOtpExpires = undefined;
                await exists.save();
                return res.json({ status: true, message: 'Payslip regenerated (previous extracted)', data: exists });
            }
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
        const { leaveDays = 0, advanceDeduction = 0, accountId } = req.body;

        if (!accountId) {
            throw new Error('Payment Account is required');
        }

        const payslip = await Payslip.findById(req.params.payslipId).populate('staff');
        if (!payslip) {
            throw new Error('Payslip not found');
        }

        if (payslip.status === 'PAID') {
            throw new Error('Payslip already paid');
        }

        const staff = payslip.staff;

        // Validate Account & Balance
        const account = await Account.findById(accountId);
        if (!account) throw new Error('Account not found');
        if (account.status !== 'ACTIVE') throw new Error('Account is inactive');

        // Validate Advance Deduction
        if (advanceDeduction > 0 && advanceDeduction > staff.currentAdvance) {
            throw new Error(`Advance deduction (₹${advanceDeduction}) cannot exceed current balance (₹${staff.currentAdvance})`);
        }

        // Final Calculations
        const leaveDeduction = Math.round((payslip.baseSalary / 30) * leaveDays);
        const finalAmount = Math.max(0, payslip.baseSalary - leaveDeduction - advanceDeduction);

        if (account.balance < finalAmount) {
            throw new Error(`Insufficient account balance (Available: ₹${account.balance}, Required: ₹${finalAmount})`);
        }

        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            payslip.leaveDays = leaveDays;
            payslip.leaveDeduction = leaveDeduction;
            payslip.advanceDeduction = advanceDeduction;
            payslip.finalAmount = finalAmount;
            payslip.status = 'PAID';
            payslip.paymentDate = new Date();
            await payslip.save({ session });

            if (advanceDeduction > 0) {
                staff.currentAdvance -= advanceDeduction;
                await staff.save({ session });

                await StaffTransaction.create([{
                    staff: staff._id,
                    type: 'ADVANCE_REPAID',
                    amount: advanceDeduction,
                    notes: `Repayment via Payslip ${payslip.monthYear}`,
                    date: new Date()
                }], { session });
            }

            await StaffTransaction.create([{
                staff: staff._id,
                type: 'SALARY_PAYMENT',
                amount: payslip.baseSalary - leaveDeduction,
                notes: `Salary Payment for ${payslip.monthYear}`,
                date: new Date()
            }], { session });

            account.balance -= finalAmount;
            await account.save({ session });

            await AccountTransaction.create([{
                account: account._id,
                type: 'EXPENSE',
                amount: finalAmount,
                balanceAfter: account.balance,
                date: new Date(),
                description: `Salary Payment - ${staff.name} (${payslip.monthYear})`,
                payment: null,
                staff: staff._id
            }], { session });

            await session.commitTransaction();
            res.json({ status: true, message: 'Payslip paid successfully', data: payslip });

            // Send WhatsApp salary confirmation (non-blocking, after response)
            // Template: salary_confirm (ml) — {{1}}=name, {{2}}=month, {{3}}=amount + URL button -> payslip PDF
            (() => {
                try {
                    const rawContact = (staff?.phone || '').toString().trim();
                    if (!rawContact) {
                        console.log('[salary_confirm] skipped: staff phone empty');
                        return;
                    }
                    const API_URL = process.env.WHATSAPP_API_URL;
                    const TOKEN = process.env.WHATSAPP_TOKEN;
                    if (!API_URL || !TOKEN) {
                        console.error('[salary_confirm] skipped: WHATSAPP_API_URL or WHATSAPP_TOKEN not configured');
                        return;
                    }
                    let phone = rawContact.replace(/\D/g, '');
                    if (phone.length === 10) phone = '91' + phone;
                    if (phone.length === 11 && phone.startsWith('0')) phone = phone.slice(1);
                    if (phone.length < 10 || phone.length > 15) {
                        console.error(`[salary_confirm] skipped: invalid phone "${rawContact}" -> "${phone}"`);
                        return;
                    }

                    // "MM-YYYY" -> "June 2026" (fallback to raw monthYear)
                    let monthLabel = payslip.monthYear;
                    try {
                        const [m, y] = String(payslip.monthYear || '').split('-');
                        const mi = parseInt(m, 10);
                        if (mi >= 1 && mi <= 12 && y) {
                            const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                            monthLabel = `${names[mi - 1]} ${y}`;
                        }
                    } catch { /* keep raw */ }

                    const amountStr = Number(finalAmount).toLocaleString('en-IN');

                    const payload = {
                        messaging_product: 'whatsapp',
                        recipient_type: 'individual',
                        to: phone,
                        type: 'template',
                        template: {
                            name: 'salary_confirm',
                            language: { code: 'ml' },
                            components: [
                                {
                                    type: 'body',
                                    parameters: [
                                        { type: 'text', text: staff?.name || 'Staff' }, // {{1}}
                                        { type: 'text', text: monthLabel },              // {{2}}
                                        { type: 'text', text: amountStr }                // {{3}}
                                    ]
                                },
                                {
                                    type: 'button',
                                    sub_type: 'url',
                                    index: '0',
                                    parameters: [
                                        { type: 'text', text: `api/staff/${staff._id.toString()}/payslips/${payslip._id.toString()}/pdf` }
                                    ]
                                }
                            ]
                        }
                    };

                    console.log(`[salary_confirm] sending to ${phone} for payslip ${payslip.monthYear} (${payslip._id})`);
                    axios.post(API_URL, payload, {
                        headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
                        timeout: 15000
                    }).then(({ data }) => {
                        console.log('[salary_confirm] sent:', data?.messages?.[0]?.id || data);
                    }).catch((error) => {
                        console.error('[salary_confirm] failed:', error.response?.data ? JSON.stringify(error.response.data) : error.message);
                    });
                } catch (error) {
                    console.error('[salary_confirm] failed:', error.message);
                }
            })();
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

// @desc    Initiate Rejection (Send OTP)
// @route   POST /api/staff/:id/payslips/:payslipId/reject/initiate
// @access  Private
export const initiatePayslipRejection = async (req, res) => {
    try {
        const payslip = await Payslip.findById(req.params.payslipId);
        if (!payslip) return res.status(404).json({ status: false, message: 'Payslip not found' });

        if (payslip.status !== 'PENDING') {
            return res.status(400).json({ status: false, message: 'Only PENDING payslips can be rejected' });
        }

        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        payslip.rejectionOtp = otp;
        payslip.rejectionOtpExpires = otpExpires;
        await payslip.save();

        // Get Contacts
        const settings = await SystemSettings.findOne();
        const contacts = settings?.alertContacts || [];

        if (contacts.length === 0) {
            return res.status(400).json({ status: false, message: 'No alert contacts configured' });
        }

        // Send WhatsApp OTP
        const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
        const API_URL = process.env.WHATSAPP_API_URL;

        if (!WHATSAPP_TOKEN || !API_URL) {
            console.warn("WhatsApp config missing, skipping sending but OTP generated for testing");
            // Allow proceed for testing if env missing (or return error in prod)
            // return res.status(500).json({ status: false, message: 'WhatsApp configuration missing' });
        } else {
            let sentCount = 0;
            for (const contact of contacts) {
                if (!contact.number) continue;
                const payload = {
                    messaging_product: 'whatsapp',
                    to: contact.number,
                    type: 'template',
                    template: {
                        name: 'otp',
                        language: { code: 'en' },
                        components: [
                            { type: 'body', parameters: [{ type: 'text', text: otp }] },
                            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: otp }] },
                        ]
                    }
                };
                try {
                    await axios.post(API_URL, payload, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } });
                    sentCount++;
                } catch (e) {
                    console.error(`Failed to send OTP to ${contact.number}`);
                }
            }
            if (sentCount === 0) console.warn("Failed to send any WhatsApp OTPs");
        }

        res.json({ status: true, message: 'OTP Sent for Rejection' });

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Confirm Rejection
// @route   POST /api/staff/:id/payslips/:payslipId/reject/confirm
// @access  Private
export const confirmPayslipRejection = async (req, res) => {
    try {
        const { otp } = req.body;
        const payslip = await Payslip.findById(req.params.payslipId);

        if (!payslip) return res.status(404).json({ status: false, message: 'Payslip not found' });

        if (!payslip.rejectionOtp || !payslip.rejectionOtpExpires) {
            return res.status(400).json({ status: false, message: 'No OTP generated' });
        }

        if (new Date() > payslip.rejectionOtpExpires) {
            return res.status(400).json({ status: false, message: 'OTP expired' });
        }

        if (payslip.rejectionOtp !== otp) {
            return res.status(400).json({ status: false, message: 'Invalid OTP' });
        }

        payslip.status = 'REJECTED';
        payslip.rejectionOtp = undefined;
        payslip.rejectionOtpExpires = undefined;
        await payslip.save();

        res.json({ status: true, message: 'Payslip rejected', data: payslip });

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Download Payslip PDF
// @route   GET /api/staff/:id/payslips/:payslipId/pdf
// @access  Public (mirrors downloadPaymentPdf)
export const downloadPayslipPdf = async (req, res) => {
    try {
        const payslip = await Payslip.findById(req.params.payslipId).populate('staff');

        if (!payslip) return res.status(404).json({ status: false, message: 'Payslip not found' });

        // Optional staff-match guard when :id is supplied
        if (req.params.id && payslip.staff && payslip.staff._id.toString() !== req.params.id) {
            return res.status(400).json({ status: false, message: 'Payslip does not belong to this staff' });
        }

        const staff = payslip.staff;

        const doc = new PDFDocument({ size: 'A5', margin: 30 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Payslip-${payslip.monthYear}-${staff?.employeeId || 'staff'}.pdf`);
        doc.pipe(res);

        const PW = doc.page.width;
        const MG = 30;
        const CW = PW - MG * 2;
        let y = MG;

        doc.font('Helvetica-Bold').fontSize(16).fillColor('#000')
            .text('THAYINERI MUSLIM JAMA-AT', MG, y, { width: CW, align: 'center' });
        y += 22;

        doc.font('Helvetica').fontSize(9).fillColor('#555')
            .text('(TMJ) | Thayineri Kara Road, Thayineri, Kerala 670307 | Ph: +91 8129059992', MG, y, { width: CW, align: 'center' });
        y += 14;

        doc.lineWidth(0.5).moveTo(MG, y).lineTo(PW - MG, y).strokeColor('#000').stroke();
        y += 14;

        doc.font('Helvetica-Bold').fontSize(15).fillColor('#000')
            .text('SALARY PAYSLIP', MG, y, { width: CW, align: 'center' });
        y += 16;

        doc.font('Helvetica').fontSize(9).fillColor('#555')
            .text(`${payslip.monthYear}  |  ${payslip.status}`, MG, y, { width: CW, align: 'center' });
        y += 16;

        doc.lineWidth(0.5).moveTo(MG, y).lineTo(PW - MG, y).strokeColor('#ccc').stroke();
        y += 12;

        const L = 90;
        const LH = 14;
        doc.fontSize(9).fillColor('#000');
        const row = (label, value) => {
            doc.font('Helvetica-Bold').text(label, MG, y, { width: L });
            doc.font('Helvetica').text(String(value ?? '-'), MG + L, y, { width: CW - L });
            y += LH;
        };

        row('Employee:', staff?.name || '-');
        row('Employee ID:', staff?.employeeId || '-');
        row('Department:', staff?.department || '-');
        row('Position:', staff?.position || '-');
        if (payslip.paymentDate) {
            row('Paid On:', new Date(payslip.paymentDate).toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric'
            }));
        }
        row('Generated:', new Date(payslip.generatedDate || payslip.createdAt).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric'
        }));

        y += 2;
        doc.lineWidth(0.5).moveTo(MG, y).lineTo(PW - MG, y).strokeColor('#ccc').stroke();
        y += 12;

        // Earnings / Deductions table (same visual language as downloadPaymentPdf)
        const tColX = [MG, MG + 18, MG + CW - 90];
        const tColW = [18, CW - 108, 90];

        doc.lineWidth(0.5).rect(MG, y, CW, 18).fillAndStroke('#000', '#000');
        doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
        doc.text('#', tColX[0] + 5, y + 5, { width: tColW[0], align: 'center' });
        doc.text('Particulars', tColX[1] + 5, y + 5, { width: tColW[1] });
        doc.text('Amount', tColX[2] + 5, y + 5, { width: tColW[2] - 10, align: 'right' });
        y += 18;

        const itemRow = (i, label, amount, opts = {}) => {
            doc.lineWidth(0.5).rect(MG, y, CW, 20).stroke('#eee');
            doc.fillColor(opts.color || '#000').font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
            doc.text(String(i), tColX[0] + 5, y + 5, { width: tColW[0], align: 'center' });
            doc.text(label, tColX[1] + 5, y + 5, { width: tColW[1] });
            doc.text('Rs. ' + Number(amount).toFixed(2), tColX[2] + 5, y + 5, { width: tColW[2] - 10, align: 'right' });
            y += 20;
        };

        let idx = 1;
        itemRow(idx++, 'Base Salary', payslip.baseSalary);
        if (staff?.otherAllowance > 0) itemRow(idx++, 'Other Allowance', staff.otherAllowance);
        if (payslip.leaveDeduction > 0) itemRow(idx++, `Leave Deduction (${payslip.leaveDays || 0} day(s))`, -payslip.leaveDeduction, { color: '#b91c1c' });
        if (payslip.advanceDeduction > 0) itemRow(idx++, 'Advance Deduction', -payslip.advanceDeduction, { color: '#b91c1c' });

        doc.lineWidth(0.5).rect(MG, y, CW, 22).fillAndStroke('#f5f5f5', '#000');
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
        doc.text('NET PAY', tColX[1] + 5, y + 5, { width: tColW[1] });
        doc.text('Rs. ' + Number(payslip.finalAmount).toFixed(2), tColX[2] + 5, y + 5, { width: tColW[2] - 10, align: 'right' });
        y += 30;

        doc.font('Helvetica').fontSize(8).fillColor('#888')
            .text('Generated: ' + new Date().toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true
            }), MG, y, { width: CW, align: 'center' });

        doc.end();

    } catch (error) {
        console.error(error);
        if (!res.headersSent) res.status(500).json({ status: false, message: error.message });
    }
};
