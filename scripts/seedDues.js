import mongoose from 'mongoose';
import dotenv from 'dotenv';
import CollectionDue from '../models/CollectionDue.js';
import connectDB from '../config/db.js';

dotenv.config();

connectDB();

const seedDues = async () => {
    try {
        const period = process.argv[2] || '07-2026';

        const result = await CollectionDue.updateMany(
            { period, status: 'PENDING' },
            { status: 'REJECTED' }
        );

        console.log(`Updated ${result.modifiedCount} dues for period ${period} from PENDING to REJECTED`);
        process.exit();
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

seedDues();
