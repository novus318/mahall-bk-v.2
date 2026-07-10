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
import Payable from '../models/Payable.js';

export const getDashboardStats = async (req, res) => {
    try {
        const today = new Date();
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);
        sixMonthsAgo.setHours(0, 0, 0, 0);

        // Execute all queries in parallel for much better performance
        const [
            totalMembers,
            activeFamilies,
            activeTenants,
            houses,
            transactionStats,
            accountAggregation,
            collectionDuesStats,
            rentDuesStats,
            payslipStats,
            paymentStats,
            securityDepositsStats,
            loansStats
        ] = await Promise.all([
            // 1. Counts (4 queries in parallel)
            Member.countDocuments(),
            Family.countDocuments(),
            Contract.countDocuments({ status: 'ACTIVE' }),
            House.countDocuments(),

            // 2. Transaction Stats
            AccountTransaction.aggregate([
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
            ]),

            // 3. Total Balance
            Account.aggregate([
                { $match: { status: 'ACTIVE' } },
                { $group: { _id: null, total: { $sum: "$balance" } } }
            ]),

            // 4. Collection Dues - Combined query for both House and Member
            CollectionDue.aggregate([
                {
                    $facet: {
                        housePending: [
                            { $match: { entityType: 'House', status: { $in: ['PENDING', 'PARTIAL'] } } },
                            {
                                $group: {
                                    _id: null,
                                    totalPending: { $sum: { $subtract: ['$amount', '$paidAmount'] } },
                                    count: { $sum: 1 }
                                }
                            }
                        ],
                        houseCollected: [
                            { $match: { entityType: 'House', paidAmount: { $gt: 0 } } },
                            { $group: { _id: null, total: { $sum: '$paidAmount' } } }
                        ],
                        memberPending: [
                            { $match: { entityType: 'Member', status: { $in: ['PENDING', 'PARTIAL'] } } },
                            {
                                $group: {
                                    _id: null,
                                    totalPending: { $sum: { $subtract: ['$amount', '$paidAmount'] } },
                                    count: { $sum: 1 }
                                }
                            }
                        ],
                        memberCollected: [
                            { $match: { entityType: 'Member', paidAmount: { $gt: 0 } } },
                            { $group: { _id: null, total: { $sum: '$paidAmount' } } }
                        ]
                    }
                }
            ]),

            // 5. Rent Dues - Combined query
            RentDue.aggregate([
                {
                    $facet: {
                        pending: [
                            { $match: { status: { $in: ['PENDING', 'PARTIAL'] } } },
                            {
                                $group: {
                                    _id: null,
                                    totalPending: { $sum: { $subtract: ['$amount', '$collectedAmount'] } },
                                    count: { $sum: 1 }
                                }
                            }
                        ],
                        collected: [
                            { $match: { collectedAmount: { $gt: 0 } } },
                            { $group: { _id: null, total: { $sum: '$collectedAmount' } } }
                        ]
                    }
                }
            ]),

            // 6. Payslips - Combined query
            Payslip.aggregate([
                {
                    $facet: {
                        pending: [
                            { $match: { status: 'PENDING' } },
                            {
                                $group: {
                                    _id: null,
                                    totalPending: { $sum: '$finalAmount' },
                                    count: { $sum: 1 }
                                }
                            }
                        ],
                        paid: [
                            { $match: { status: 'PAID' } },
                            { $group: { _id: null, total: { $sum: '$finalAmount' } } }
                        ]
                    }
                }
            ]),

            // 7. Payments - Combined query
            Payment.aggregate([
                {
                    $facet: {
                        pending: [
                            { $match: { status: 'PENDING' } },
                            {
                                $group: {
                                    _id: null,
                                    totalPending: { $sum: '$amount' },
                                    count: { $sum: 1 }
                                }
                            }
                        ],
                        completed: [
                            { $match: { status: 'COMPLETED' } },
                            { $group: { _id: null, total: { $sum: '$amount' } } }
                        ]
                    }
                }
            ]),

            // 8. Security Deposits
            Contract.aggregate([
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
            ]),

            // 9. Loans
            Payable.aggregate([
                {
                    $match: { status: { $in: ['ACTIVE', 'PARTIALLY_REPAID', 'OVERDUE'] } }
                },
                {
                    $group: {
                        _id: null,
                        totalBalanceDue: { $sum: '$balanceDue' },
                        totalRepaid: { $sum: '$totalRepaid' },
                        totalAmount: { $sum: '$amount' },
                        count: { $sum: 1 },
                        overdueCount: {
                            $sum: {
                                $cond: [{ $eq: ['$status', 'OVERDUE'] }, 1, 0]
                            }
                        }
                    }
                }
            ])
        ]);

        // Process transaction stats for last 6 months
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

        // Extract values from aggregation results
        const totalBalance = accountAggregation.length > 0 ? accountAggregation[0].total : 0;

        // Collection Dues (using facet results)
        const collectionDues = collectionDuesStats[0];
        const houseDuesPending = collectionDues.housePending[0]?.totalPending || 0;
        const houseDuesCount = collectionDues.housePending[0]?.count || 0;
        const houseDuesCollectedAmount = collectionDues.houseCollected[0]?.total || 0;
        const memberDuesPending = collectionDues.memberPending[0]?.totalPending || 0;
        const memberDuesCount = collectionDues.memberPending[0]?.count || 0;
        const memberDuesCollectedAmount = collectionDues.memberCollected[0]?.total || 0;

        // Rent Dues (using facet results)
        const rentDues = rentDuesStats[0];
        const rentDuesPending = rentDues.pending[0]?.totalPending || 0;
        const rentDuesCount = rentDues.pending[0]?.count || 0;
        const rentCollectedAmount = rentDues.collected[0]?.total || 0;

        // Payslips (using facet results)
        const payslips = payslipStats[0];
        const pendingSalaries = payslips.pending[0]?.totalPending || 0;
        const pendingSalariesCount = payslips.pending[0]?.count || 0;
        const paidSalariesAmount = payslips.paid[0]?.total || 0;

        // Payments (using facet results)
        const payments = paymentStats[0];
        const pendingPayments = payments.pending[0]?.totalPending || 0;
        const pendingPaymentsCount = payments.pending[0]?.count || 0;
        const completedPaymentsAmount = payments.completed[0]?.total || 0;

        // Security Deposits
        const depositsCollected = securityDepositsStats[0]?.totalCollected || 0;
        const depositsReturned = securityDepositsStats[0]?.totalReturned || 0;
        const securityDeposits = depositsCollected - depositsReturned;
        const securityDepositsCount = securityDepositsStats[0]?.activeCount || 0;

        // Loans
        const loansPending = loansStats[0]?.totalBalanceDue || 0;
        const loansRepaid = loansStats[0]?.totalRepaid || 0;
        const loansTotal = loansStats[0]?.totalAmount || 0;
        const loansCount = loansStats[0]?.count || 0;
        const loansOverdueCount = loansStats[0]?.overdueCount || 0;

        // Calculate Total Receivables and Payables
        const totalReceivablesPending = houseDuesPending + memberDuesPending + rentDuesPending;
        const totalReceivablesCollected = houseDuesCollectedAmount + memberDuesCollectedAmount + rentCollectedAmount;

        const totalPayablesPending = pendingSalaries + pendingPayments + securityDeposits + loansPending;
        const totalPayablesPaid = paidSalariesAmount + completedPaymentsAmount + depositsReturned + loansRepaid;

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
                    },
                    loans: {
                        pending: loansPending,
                        repaid: loansRepaid,
                        total: loansTotal,
                        count: loansCount,
                        overdueCount: loansOverdueCount
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
        // Use aggregation instead of populate to reduce database round trips
        const transactions = await AccountTransaction.aggregate([
            { $sort: { date: -1 } },
            { $limit: 7 },
            {
                $lookup: {
                    from: 'accounts',
                    localField: 'account',
                    foreignField: '_id',
                    as: 'account',
                    pipeline: [{ $project: { name: 1 } }]
                }
            },
            {
                $lookup: {
                    from: 'accounts',
                    localField: 'relatedAccount',
                    foreignField: '_id',
                    as: 'relatedAccount',
                    pipeline: [{ $project: { name: 1 } }]
                }
            },
            {
                $lookup: {
                    from: 'payments',
                    localField: 'payment',
                    foreignField: '_id',
                    as: 'payment',
                    pipeline: [{ $project: { _id: 1 } }]
                }
            },
            {
                $lookup: {
                    from: 'receipts',
                    localField: 'receipt',
                    foreignField: '_id',
                    as: 'receipt',
                    pipeline: [{ $project: { _id: 1 } }]
                }
            },
            {
                $lookup: {
                    from: 'staff',
                    localField: 'staff',
                    foreignField: '_id',
                    as: 'staff',
                    pipeline: [{ $project: { _id: 1 } }]
                }
            },
            {
                $lookup: {
                    from: 'payables',
                    localField: 'payable',
                    foreignField: '_id',
                    as: 'payable',
                    pipeline: [{ $project: { _id: 1 } }]
                }
            },
            {
                $lookup: {
                    from: 'contracts',
                    localField: 'contract',
                    foreignField: '_id',
                    as: 'contract',
                    pipeline: [{ $project: { tenant: 1 } }]
                }
            },
            {
                $unwind: { path: '$account', preserveNullAndEmptyArrays: true }
            },
            {
                $unwind: { path: '$relatedAccount', preserveNullAndEmptyArrays: true }
            },
            {
                $unwind: { path: '$payment', preserveNullAndEmptyArrays: true }
            },
            {
                $unwind: { path: '$receipt', preserveNullAndEmptyArrays: true }
            },
            {
                $unwind: { path: '$staff', preserveNullAndEmptyArrays: true }
            },
            {
                $unwind: { path: '$payable', preserveNullAndEmptyArrays: true }
            },
            {
                $unwind: { path: '$contract', preserveNullAndEmptyArrays: true }
            }
        ]);

        res.status(200).json({
            transactions
        });
    } catch (error) {
        console.error("Recent Activity Error:", error);
        res.status(500).json({ message: error.message });
    }
};
