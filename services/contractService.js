import Contract from '../models/Contract.js';
import RentDue from '../models/RentDue.js';

export const generateBulkRentInternal = async ({ period, endDate }) => {
    let targetPeriod = period;
    if (!targetPeriod) {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const year = d.getFullYear();
        targetPeriod = `${month}-${year}`;
    }

    const match = { status: 'ACTIVE' };
    if (endDate) {
        const end = new Date(endDate);
        const startOfMonth = new Date(end.getFullYear(), end.getMonth(), 1);
        match.startDate = { $lte: startOfMonth };
    }

    const contracts = await Contract.find(match).lean();

    let generatedCount = 0;
    let skippedCount = 0;

    for (const contract of contracts) {
        const existing = await RentDue.findOne({
            contract: contract._id,
            monthYear: targetPeriod
        });

        if (existing) {
            skippedCount++;
            continue;
        }

        const [monthStr, yearStr] = targetPeriod.split('-');
        const dueDate = new Date(Number(yearStr), Number(monthStr) - 1, 1);

        await RentDue.create({
            contract: contract._id,
            monthYear: targetPeriod,
            dueDate,
            amount: contract.rentAmount,
            status: 'PENDING'
        });

        generatedCount++;
    }

    return { generatedCount, skippedCount, targetPeriod };
};
