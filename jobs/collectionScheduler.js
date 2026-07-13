import cron from 'node-cron';
import SystemSettings from '../models/SystemSettings.js';
import { generateBulkDuesInternal } from '../services/collectionService.js';
import { generateBulkRentInternal } from '../services/contractService.js';

const startScheduler = () => {
    cron.schedule('* * * * *', async () => {
        try {
            const settings = await SystemSettings.findOne();
            if (!settings) return;

            const now = new Date();
            const currentDay = now.getDate();
            const currentTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

            // Collections
            if (settings.collectionSettings?.automationEnabled) {
                const { houseCronDay, memberCronDay, houseCronTime, memberCronTime } = settings.collectionSettings;

                if (houseCronDay === currentDay && houseCronTime === currentTime) {
                    console.log('Triggering House Auto-Generation (Scheduled)');
                    const r = await generateBulkDuesInternal({ entityType: 'House', frequency: 'Monthly' });
                    console.log(`Auto-Generated ${r.generatedCount} dues for House (${r.targetPeriod})`);
                }

                if (memberCronDay === currentDay && memberCronTime === currentTime) {
                    console.log('Triggering Member Auto-Generation (Scheduled)');
                    const r = await generateBulkDuesInternal({ entityType: 'Member', frequency: 'Monthly' });
                    console.log(`Auto-Generated ${r.generatedCount} dues for Member (${r.targetPeriod})`);
                }
            }

            // Rent
            if (settings.rentSettings?.automationEnabled) {
                const { cronDay, cronTime } = settings.rentSettings;

                if (cronDay === currentDay && cronTime === currentTime) {
                    console.log('Triggering Rent Auto-Generation (Scheduled)');
                    const r = await generateBulkRentInternal({});
                    console.log(`Auto-Generated ${r.generatedCount} rents (${r.targetPeriod})`);
                }
            }

        } catch (err) {
            console.error('Scheduler Error:', err);
        }
    });
    console.log('Collection & Rent Scheduler Started (Live Check)');
};

export default startScheduler;
