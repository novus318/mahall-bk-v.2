import House from '../models/House.js';
import Member from '../models/Member.js';
import CollectionDue from '../models/CollectionDue.js';
import { normalizePhone, sendDueBatch } from './whatsappReminderService.js';

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
            // Monthly: Default to Current Month
            const month = (d.getMonth() + 1).toString().padStart(2, '0');
            const year = d.getFullYear();
            targetPeriod = `${month}-${year}`;
        }
    }

    let generatedCount = 0;
    let skippedCount = 0;
    const typesToProcess = [];
    const reminderRecipients = [];

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

            // Collect recipients for the batch WhatsApp reminder run (sent below).
            // Newly created dues are always PENDING; skip anything that is not unpaid.
            for (let i = 0; i < createdDues.length; i++) {
                const due = createdDues[i];
                const entity = entitiesToCreate[i];

                if (!['PENDING', 'PARTIAL'].includes(due.status)) continue;
                if (due.amount - (due.paidAmount || 0) <= 0) continue;
                if (!entity.contactNumber) continue;

                const phone = normalizePhone(entity.contactNumber);
                if (!phone) continue;
                reminderRecipients.push({
                    phoneNumber: phone,
                    name: entity.contactName || 'Recipient',
                    entityType: type,
                    entityId: entity._id,
                    linkedEntityModel: type,
                    dueId: due._id,
                    period: targetPeriod,
                    amount: entity.subscription.amount,
                    frequency,
                    customId: entity.customId
                });
            }

            generatedCount += createdDues.length;
        }
    }

    // Send WhatsApp notifications with the same batch processing as executeBroadcast,
    // recording each recipient's result (SENT / FAILED + error + sentAt) for tracking.
    if (reminderRecipients.length > 0) {
        await sendDueBatch(reminderRecipients, {
            name: `Bulk dues - ${targetPeriod}`,
            entityType: entityType || 'All',
            period: targetPeriod,
            frequency,
            createdBy: null
        }).catch(err => {
            console.error('Bulk due WhatsApp batch failed:', err.message);
        });
    }

    return {
        generatedCount,
        skippedCount,
        targetPeriod
    };
};
