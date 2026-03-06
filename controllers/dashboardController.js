import Member from '../models/Member.js';
import Family from '../models/Family.js';
import Contract from '../models/Contract.js';
import House from '../models/House.js';
import Payment from '../models/Payment.js';
import Payslip from '../models/Payslip.js';
import Receipt from '../models/Receipt.js';
import RentDue from '../models/RentDue.js';
import CollectionDue from '../models/CollectionDue.js';
import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';

export const getDashboardStats = async (req, res) => {
    try {
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        // 1. Counts
        const totalMembers = await Member.countDocuments();
        const activeFamilies = await Family.countDocuments();
        const activeTenants = await Contract.countDocuments({ status: 'ACTIVE' });
        const houses = await House.countDocuments();

        // 2. Financials (Aggregated from AccountTransaction)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);
        sixMonthsAgo.setHours(0, 0, 0, 0);

        const transactionStats = await AccountTransaction.aggregate([
            {
                $match: {
                    date: { $gte: sixMonthsAgo },
                    type: { $in: ['INCOME', 'EXPENSE'] }
                }
            },
            {
                $group: {
                    _id: {
                        year: { $year: "$date" },
                        month: { $month: "$date" },
                        type: "$type"
                    },
                    total: { $sum: "$amount" }
                }
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } }
        ]);

        const last6Months = [];
        const currentMonthData = { revenue: 0, expenses: 0 };
        const currentMonthKey = `${today.getFullYear()}-${today.getMonth() + 1}`;

        for (let i = 0; i < 6; i++) {
            const d = new Date(sixMonthsAgo);
            d.setMonth(d.getMonth() + i);
            const y = d.getFullYear();
            const m = d.getMonth() + 1;
            const key = `${y}-${m}`;
            const name = d.toLocaleString('default', { month: 'short' });

            const income = transactionStats.find(x => x._id.year === y && x._id.month === m && x._id.type === 'INCOME')?.total || 0;
            const expense = transactionStats.find(x => x._id.year === y && x._id.month === m && x._id.type === 'EXPENSE')?.total || 0;

            last6Months.push({ name, income, expense });

            if (key === currentMonthKey) {
                currentMonthData.revenue = income;
                currentMonthData.expenses = expense;
            }
        }

        // 3. Total Balance (Sum of all active accounts)
        const accountAggregation = await Account.aggregate([
            { $match: { status: 'ACTIVE' } },
            { $group: { _id: null, total: { $sum: "$balance" } } }
        ]);
        const totalBalance = accountAggregation.length > 0 ? accountAggregation[0].total : 0;

        // ========== RECEIVABLES (Money to GET) ==========

        // Pending House Collection Dues
        const houseDuesStats = await CollectionDue.aggregate([
            { $match: { entityType: 'House', status: { $in: ['PENDING', 'PARTIAL'] } } },
            {
                $group: {
                    _id: null,
                    totalPending: { $sum: { $subtract: ['$amount', '$paidAmount'] } },
                    count: { $sum: 1 }
                }
            }
        ]);
        const houseDuesPending = houseDuesStats[0]?.totalPending || 0;
        const houseDuesCount = houseDuesStats[0]?.count || 0;

        // Collected House Dues
        const houseDuesCollected = await CollectionDue.aggregate([
            { $match: { entityType: 'House', status: 'PAID' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const houseDuesCollectedAmount = houseDuesCollected[0]?.total || 0;

        // Pending Member Collection Dues
        const memberDuesStats = await CollectionDue.aggregate([
            { $match: { entityType: 'Member', status: { $in: ['PENDING', 'PARTIAL'] } } },
            {
                $group: {
                    _id: null,
                    totalPending: { $sum: { $subtract: ['$amount', '$paidAmount'] } },
                    count: { $sum: 1 }
                }
            }
        ]);
        const memberDuesPending = memberDuesStats[0]?.totalPending || 0;
        const memberDuesCount = memberDuesStats[0]?.count || 0;

        // Collected Member Dues
        const memberDuesCollected = await CollectionDue.aggregate([
            { $match: { entityType: 'Member', status: 'PAID' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const memberDuesCollectedAmount = memberDuesCollected[0]?.total || 0;

        // Pending Rent Dues
        const rentDuesStats = await RentDue.aggregate([
            { $match: { status: { $in: ['PENDING', 'PARTIAL'] } } },
            {
                $group: {
                    _id: null,
                    totalPending: { $sum: { $subtract: ['$amount', '$collectedAmount'] } },
                    count: { $sum: 1 }
                }
            }
        ]);
        const rentDuesPending = rentDuesStats[0]?.totalPending || 0;
        const rentDuesCount = rentDuesStats[0]?.count || 0;

        // Collected Rent
        const rentCollected = await RentDue.aggregate([
            { $match: { status: 'PAID' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const rentCollectedAmount = rentCollected[0]?.total || 0;

        // ========== PAYABLES (Money to GIVE) ==========

        // Pending Staff Salaries
        const pendingSalariesStats = await Payslip.aggregate([
            { $match: { status: 'PENDING' } },
            {
                $group: {
                    _id: null,
                    totalPending: { $sum: '$finalAmount' },
                    count: { $sum: 1 }
                }
            }
        ]);
        const pendingSalaries = pendingSalariesStats[0]?.totalPending || 0;
        const pendingSalariesCount = pendingSalariesStats[0]?.count || 0;

        // Paid Salaries
        const paidSalaries = await Payslip.aggregate([
            { $match: { status: 'PAID' } },
            { $group: { _id: null, total: { $sum: '$finalAmount' } } }
        ]);
        const paidSalariesAmount = paidSalaries[0]?.total || 0;

        // Pending Payments (Expenses)
        const pendingPaymentsStats = await Payment.aggregate([
            { $match: { status: 'PENDING' } },
            {
                $group: {
                    _id: null,
                    totalPending: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            }
        ]);
        const pendingPayments = pendingPaymentsStats[0]?.totalPending || 0;
        const pendingPaymentsCount = pendingPaymentsStats[0]?.count || 0;

        // Completed Payments
        const completedPayments = await Payment.aggregate([
            { $match: { status: 'COMPLETED' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const completedPaymentsAmount = completedPayments[0]?.total || 0;

        // Security Deposits (Liability - money we are holding and need to return)
        // This should be: Collected - Returned for ALL contracts
        const securityDepositsStats = await Contract.aggregate([
            {
                $group: {
                    _id: null,
                    totalCollected: { $sum: { $ifNull: ['$depositCollected', 0] } },
                    totalReturned: { $sum: { $ifNull: ['$depositReturned', 0] } },
                    activeCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ['$status', 'ACTIVE'] },
                                        { $gt: [{ $subtract: [{ $ifNull: ['$depositCollected', 0] }, { $ifNull: ['$depositReturned', 0] }] }, 0] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        const depositsCollected = securityDepositsStats[0]?.totalCollected || 0;
        const depositsReturned = securityDepositsStats[0]?.totalReturned || 0;
        const securityDeposits = depositsCollected - depositsReturned; // Currently held
        const securityDepositsCount = securityDepositsStats[0]?.activeCount || 0;

        // Calculate Total Receivables and Payables
        const totalReceivablesPending = houseDuesPending + memberDuesPending + rentDuesPending;
        const totalReceivablesCollected = houseDuesCollectedAmount + memberDuesCollectedAmount + rentCollectedAmount;

        const totalPayablesPending = pendingSalaries + pendingPayments + securityDeposits;
        const totalPayablesPaid = paidSalariesAmount + completedPaymentsAmount + depositsReturned;

        res.status(200).json({
            counts: {
                members: totalMembers,
                families: activeFamilies,
                tenants: activeTenants,
                houses: houses
            },
            financials: {
                balance: totalBalance,
                currentMonth: currentMonthData,
                trends: last6Months,

                // Receivables (Money to GET)
                receivables: {
                    total: {
                        pending: totalReceivablesPending,
                        collected: totalReceivablesCollected
                    },
                    houseDues: {
                        pending: houseDuesPending,
                        collected: houseDuesCollectedAmount,
                        count: houseDuesCount
                    },
                    memberDues: {
                        pending: memberDuesPending,
                        collected: memberDuesCollectedAmount,
                        count: memberDuesCount
                    },
                    rentDues: {
                        pending: rentDuesPending,
                        collected: rentCollectedAmount,
                        count: rentDuesCount
                    }
                },

                // Payables (Money to GIVE)
                payables: {
                    total: {
                        pending: totalPayablesPending,
                        paid: totalPayablesPaid
                    },
                    salaries: {
                        pending: pendingSalaries,
                        paid: paidSalariesAmount,
                        count: pendingSalariesCount
                    },
                    payments: {
                        pending: pendingPayments,
                        completed: completedPaymentsAmount,
                        count: pendingPaymentsCount
                    },
                    deposits: {
                        held: securityDeposits,
                        returned: depositsReturned,
                        count: securityDepositsCount
                    }
                }
            }
        });

    } catch (error) {
        console.error("Dashboard Stats Error:", error);
        res.status(500).json({ message: error.message });
    }
};

// GET /api/dashboard/recent
export const getRecentActivity = async (req, res) => {
    try {
        // Fetch recent account transactions instead of raw payments/receipts
        const transactions = await AccountTransaction.find()
            .sort({ date: -1 })
            .limit(7)
            .populate('account', 'name')
            .populate('relatedAccount', 'name')
            .populate('payment', '_id')
            .populate('receipt', '_id')
            .populate('staff', '_id')
            .populate({
                path: 'contract',
                select: 'tenant _id', // Just need tenant name usually but contract doesn't duplicate tenant info?
                // actually contract.tenant is an embedded object { name: ... }
            })
            .lean();

        res.status(200).json({
            transactions
        });
    } catch (error) {
        console.error("Recent Activity Error:", error);
        res.status(500).json({ message: error.message });
    }
};
