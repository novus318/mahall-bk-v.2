import cron from 'node-cron';
import nodemailer from 'nodemailer';
import mongoose from 'mongoose';

const backupDatabase = async () => {
    const db = mongoose.connection.db;

    const collections = await db.listCollections().toArray();
    const backup = {};

    for (const collection of collections) {
        const collectionName = collection.name;
        const documents = await db.collection(collectionName).find().toArray();
        backup[collectionName] = documents;
    }

    return JSON.stringify(backup, null, 2);
};

const validateEmailConfig = () => {
    const { EMAIL_USER, EMAIL_PASS, BACKUP_RECIPIENT_EMAIL } = process.env;
    const missing = [];
    if (!EMAIL_USER) missing.push('EMAIL_USER');
    if (!EMAIL_PASS) missing.push('EMAIL_PASS');
    if (!BACKUP_RECIPIENT_EMAIL) missing.push('BACKUP_RECIPIENT_EMAIL');

    if (missing.length > 0) {
        throw new Error(`Backup email config missing in .env: ${missing.join(', ')}`);
    }
};

const sendBackupEmail = async (backupContent) => {
    validateEmailConfig();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `tmj-mahall-backup-${timestamp}.json`;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });

    await transporter.sendMail({
        from: `"TMJ Mahall Backup" <${process.env.EMAIL_USER}>`,
        to: process.env.BACKUP_RECIPIENT_EMAIL,
        subject: `DB Backup - ${new Date().toLocaleString()}`,
        text: 'Attached is the automated weekly database backup.',
        attachments: [
            {
                filename,
                content: backupContent,
                contentType: 'application/json',
            },
        ],
    });
};

const runBackupJob = async () => {
    try {
        const backupContent = await backupDatabase();
        console.log('Backup data collected (in memory).');
        await sendBackupEmail(backupContent);
        console.log(`Backup emailed to ${process.env.BACKUP_RECIPIENT_EMAIL}`);
    } catch (err) {
        console.error('Backup Job Error:', err);
    }
};

const startBackupScheduler = () => {
    cron.schedule('50 23 * * 4', async () => {
        console.log('Triggering Weekly Database Backup (Thursday 23:50)');
        await runBackupJob();
    });
    console.log('Database Backup Scheduler Started (Every Thursday 23:50)');
};

export default startBackupScheduler;