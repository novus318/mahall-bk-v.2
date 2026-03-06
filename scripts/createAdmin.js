import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import connectDB from '../config/db.js';

dotenv.config();

connectDB();

const createAdmin = async () => {
    try {
        const username = process.argv[2] || 'admin';
        const password = process.argv[3] || 'admin@123#';
        const role = process.argv[4] || 'admin';

        const userExists = await User.findOne({ username });

        if (userExists) {
            console.log(`User ${username} exists. Updating...`);
            userExists.password = password;
            userExists.role = role;
            await userExists.save();
            console.log(`User ${username} updated successfully`);
            process.exit();
        }

        const user = await User.create({
            username,
            password,
            role
        });

        console.log(`User created: ${user.username} with role ${user.role}`);
        process.exit();
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

createAdmin();
