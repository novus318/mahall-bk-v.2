import cron from 'node-cron';
import SystemSettings from '../models/SystemSettings.js';
import { generateBulkDuesInternal } from '../services/collectionService.js';

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

            // House Check
            if (houseCronDay === currentDay && houseCronTime === currentTime) {
                console.log('Triggering House Auto-Generation (Scheduled)');
                const { generatedCount, targetPeriod } = await generateBulkDuesInternal({ 
                    entityType: 'House', 
                    frequency: 'Monthly' 
                });
                console.log(`Auto-Generated ${generatedCount} dues for House (${targetPeriod})`);
            }

            // Member Check
            if (memberCronDay === currentDay && memberCronTime === currentTime) {
                console.log('Triggering Member Auto-Generation (Scheduled)');
                const { generatedCount, targetPeriod } = await generateBulkDuesInternal({ 
                    entityType: 'Member', 
                    frequency: 'Monthly' 
                });
                console.log(`Auto-Generated ${generatedCount} dues for Member (${targetPeriod})`);
            }

        } catch (err) {
            console.error('Scheduler Error:', err);
        }
    });
    console.log('Collection Scheduler Started (Live Check)');
};

export default startScheduler;
