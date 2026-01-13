import cron from 'node-cron';
import SystemSettings from '../models/SystemSettings.js';
import House from '../models/House.js';
import Member from '../models/Member.js';
import CollectionDue from '../models/CollectionDue.js';

const generateDuesForType = async (type) => {
    try {
        const d = new Date();
        d.setMonth(d.getMonth() - 1); // Last Month
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const year = d.getFullYear();
        const targetPeriod = `${month}-${year}`;

        const Model = type === 'House' ? House : Member;

        // 1. Fetch Eligible Entities 
        const entities = await Model.find({ 'subscription.frequency': 'Monthly' }).select('_id subscription');

        if (entities.length === 0) return;

        const entityIds = entities.map(e => e._id);

        // 2. Find Existing Dues for this specific batch
        const existingDues = await CollectionDue.find({
            entityId: { $in: entityIds },
            period: targetPeriod
        }).select('entityId');

        const existingIdsSet = new Set(existingDues.map(d => d.entityId.toString()));

        // 3. Prepare Batch
        const duesToCreate = [];
        entities.forEach(entity => {
            // Check existence + valid subscription amount
            if (!existingIdsSet.has(entity._id.toString()) && entity.subscription && entity.subscription.amount > 0) {
                duesToCreate.push({
                    entityType: type,
                    entityId: entity._id,
                    period: targetPeriod,
                    frequency: 'Monthly',
                    amount: entity.subscription.amount,
                    status: 'PENDING'
                });
            }
        });

        // 4. Bulk Insert
        if (duesToCreate.length > 0) {
            await CollectionDue.insertMany(duesToCreate);
            console.log(`Auto-Generated ${duesToCreate.length} dues for ${type} (${targetPeriod})`);
        } else {
            // console.log(`Collection Automation: All ${type} dues up to date for ${targetPeriod}`);
        }

    } catch (error) {
        console.error(`Error generating ${type} dues:`, error);
    }
};

const startScheduler = () => {
    // Run Every Minute to check for time match
    cron.schedule('* * * * *', async () => {
        try {
            const settings = await SystemSettings.findOne();
            if (!settings || !settings.collectionSettings?.automationEnabled) return;

            const { houseCronDay, memberCronDay, houseCronTime, memberCronTime } = settings.collectionSettings;

            const now = new Date();
            const currentDay = now.getDate();
            const currentTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); // "HH:mm"

            // console.log(`Scheduler Tick: Day ${currentDay}, Time ${currentTime}`);

            // House Check
            if (houseCronDay === currentDay && houseCronTime === currentTime) {
                console.log('Triggering House Auto-Generation (Scheduled)');
                await generateDuesForType('House');
            }

            // Member Check
            if (memberCronDay === currentDay && memberCronTime === currentTime) {
                console.log('Triggering Member Auto-Generation (Scheduled)');
                await generateDuesForType('Member');
            }

        } catch (err) {
            console.error('Scheduler Error:', err);
        }
    });
    console.log('Collection Scheduler Started (Live Check)');
};

export default startScheduler;
