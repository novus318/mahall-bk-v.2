import axios from 'axios';
import Contract from '../models/Contract.js';
import RentDue from '../models/RentDue.js';

const sendRentCollectionNotification = async (phone, name, amount, period) => {
    try {
        const { WHATSAPP_TOKEN, WHATSAPP_API_URL } = process.env;
        if (!WHATSAPP_TOKEN || !WHATSAPP_API_URL) return;

        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

        const payload = {
            messaging_product: 'whatsapp',
            to: cleanPhone,
            type: 'template',
            template: {
                name: 'rent_collection',
                language: { code: 'ml' },
                components: [{
                    type: 'body',
                    parameters: [
                        { type: 'text', text: name },
                        { type: 'text', text: `₹${Number(amount).toLocaleString('en-IN')}` },
                        { type: 'text', text: period }
                    ]
                },
              {
                        type: 'button',
                        sub_type: 'url',
                        index: '0',
                        parameters: [
                            { type: 'text', text: 'payRent/' + contractId }
                        ]
                    }]
            }
        };

        await axios.post(WHATSAPP_API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });
    } catch (error) {
        console.error(`Failed to send rent_collection WhatsApp to ${phone}:`, error.response?.data || error.message);
    }
};

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

        if (contract.tenant?.phone) {
            sendRentCollectionNotification(
                contract.tenant.phone,
                contract.tenant.name || 'Tenant',
                contract.rentAmount,
                targetPeriod
            );
        }

        generatedCount++;
    }

    return { generatedCount, skippedCount, targetPeriod };
};
