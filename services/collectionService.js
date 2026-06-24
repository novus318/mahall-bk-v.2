import axios from 'axios';
import House from '../models/House.js';
import Member from '../models/Member.js';
import CollectionDue from '../models/CollectionDue.js';

/**
 * Helper to send WhatsApp notification for a generated due.
 */
const sendWhatsAppNotification = async (recipient, data) => {
    try {
        const { WHATSAPP_TOKEN, WHATSAPP_API_URL } = process.env;
        if (!WHATSAPP_TOKEN || !WHATSAPP_API_URL) return;

        // Clean recipient number: ensure it has country code and no plus sign
        let phone = recipient.replace(/\D/g, '');
        if (phone.length === 10) phone = '91' + phone; // Default to India if no country code

        const payload = {
            messaging_product: 'whatsapp',
            to: phone,
            type: 'template',
            template: {
                name: 'due_collection',
                language: { code: 'ml' },
                components: [
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: data.name },           // {{1}}
                            { type: 'text', text: data.frequencyLabel }, // {{2}}
                            { type: 'text', text: data.customId },       // {{3}}
                            { type: 'text', text: data.period },         // {{4}}
                            { type: 'text', text: data.amount.toString() } // {{5}}
                        ]
                    },
                    {
                        type: 'button',
                        sub_type: 'url',
                        index: '0',
                        parameters: [
                            { type: 'text', text: data.dueId } // Appends to the base URL configured in the template
                        ]
                    }
                ]
            }
        };

        await axios.post(WHATSAPP_API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000 // 10s timeout
        });
    } catch (error) {
        console.error(`Failed to send WhatsApp to ${recipient}:`, error.response?.data || error.message);
    }
};

/**
 * Common function to generate dues in bulk for Houses and/or Members.
 * Optimized with MongoDB Aggregation to push filtering to the database level.
 */
export const generateBulkDuesInternal = async ({ entityType, period, frequency = 'Monthly' }) => {
    // Determine Period if not provided
    let targetPeriod = period;
    if (!targetPeriod) {
        const d = new Date();
        if (frequency === 'Yearly') {
            targetPeriod = d.getFullYear().toString();
        } else {
            // Monthly: Default to Last Month
            d.setMonth(d.getMonth() - 1);
            const month = (d.getMonth() + 1).toString().padStart(2, '0');
            const year = d.getFullYear();
            targetPeriod = `${month}-${year}`;
        }
    }

    let generatedCount = 0;
    let skippedCount = 0;
    const typesToProcess = [];

    if (!entityType || entityType === 'All') {
        typesToProcess.push('House', 'Member');
    } else {
        typesToProcess.push(entityType);
    }

    for (const type of typesToProcess) {
        const Model = type === 'House' ? House : Member;

        // Use Aggregation to find entities that:
        // 1. Have matching subscription frequency
        // 2. Do NOT already have a CollectionDue for this period (OR amount is 0)
        // 3. Fetch contact info for WhatsApp notifications
        const aggregationPipeline = [
            {
                $match: {
                    'subscription.frequency': frequency
                }
            },
            {
                $lookup: {
                    from: 'collectiondues',
                    let: { entId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$entityId', '$$entId'] },
                                        { $eq: ['$period', targetPeriod] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: 'existingDues'
                }
            }
        ];

        // Additional Lookups for contact info
        if (type === 'House') {
            aggregationPipeline.push(
                {
                    $lookup: {
                        from: 'members',
                        localField: 'head',
                        foreignField: '_id',
                        as: 'headInfo'
                    }
                },
                { $unwind: { path: '$headInfo', preserveNullAndEmptyArrays: true } }
            );
        }

        aggregationPipeline.push({
            $facet: {
                toCreate: [
                    { 
                        $match: { 
                            existingDues: { $size: 0 }, 
                            'subscription.amount': { $gt: 0 } 
                        } 
                    },
                    { 
                        $project: { 
                            _id: 1, 
                            customId: 1,
                            'subscription.amount': 1,
                            contactName: type === 'House' ? '$headInfo.name' : '$name',
                            contactNumber: type === 'House' 
                                ? { $ifNull: ['$headInfo.whatsapp', '$headInfo.mobile'] }
                                : { $ifNull: ['$whatsapp', '$mobile'] }
                        } 
                    }
                ],
                skipped: [
                    { 
                        $match: { 
                            $or: [
                                { "existingDues.0": { $exists: true } }, 
                                { 'subscription.amount': { $lte: 0 } }
                            ] 
                        } 
                    },
                    { $count: 'count' }
                ]
            }
        });

        const results = await Model.aggregate(aggregationPipeline);

        const entitiesToCreate = results[0].toCreate;
        skippedCount += results[0].skipped[0]?.count || 0;

        if (entitiesToCreate.length === 0) continue;

        const duesToCreate = entitiesToCreate.map(entity => ({
            entityType: type,
            entityId: entity._id,
            period: targetPeriod,
            frequency: frequency,
            amount: entity.subscription.amount,
            status: 'PENDING'
        }));

        // Bulk Insert
        if (duesToCreate.length > 0) {
            const createdDues = await CollectionDue.insertMany(duesToCreate);
            
            // Send WhatsApp Notifications
            const frequencyLabel = frequency === 'Monthly' ? 'പ്രതിമാസ' : 'വാർഷിക';
            
            // We process sequentially to avoid overwhelming the API, but without await inside loop if speed is preferred.
            // However, to ensure we don't hit rate limits too hard and can log failures, we'll do it one by one.
            for (let i = 0; i < createdDues.length; i++) {
                const due = createdDues[i];
                const entity = entitiesToCreate[i];

                if (entity.contactNumber) {
                    // We don't await the notification to keep the API response faster, 
                    // but we start the promise.
                    sendWhatsAppNotification(entity.contactNumber, {
                        name: entity.contactName || 'Recipient',
                        frequencyLabel,
                        customId: entity.customId,
                        period: targetPeriod,
                        amount: entity.subscription.amount,
                        dueId: (type === 'House' ? 'hou/' : 'mem/') + entity._id.toString()
                    });
                }
            }
            
            generatedCount += createdDues.length;
        }
    }

    return {
        generatedCount,
        skippedCount,
        targetPeriod
    };
};
