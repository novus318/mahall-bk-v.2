import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import connectDB from './config/db.js';

dotenv.config();

connectDB();

const app = express();

app.use(cors({
    origin: ['http://localhost:3000', 'https://tmj.org.in', 'https://www.tmj.org.in'],
    credentials: true
}));
app.use(express.json());

app.get('/', (req, res) => {
    res.send('API is running...');
});

// Import routes
import mahallRoutes from './routes/mahallRoutes.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';
import buildingRoutes from './routes/buildingRoutes.js';
import contractRoutes from './routes/contractRoutes.js';
import staffRoutes from './routes/staffRoutes.js';
import accountRoutes from './routes/accountRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import receiptRoutes from './routes/receiptRoutes.js';
import whatsappRoutes from './routes/whatsappRoutes.js';
import collectionRoutes from './routes/collectionRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import paymentGatewayRoutes from './routes/paymentGatewayRoutes.js';
import payableRoutes from './routes/payableRoutes.js';

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/payment-gateway', paymentGatewayRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api', mahallRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/buildings', buildingRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/receipts', receiptRoutes);
app.use('/api/payables', payableRoutes);

const PORT = process.env.PORT || 5000;

import startScheduler from './jobs/collectionScheduler.js';

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startScheduler();
    // Restart trigger for date fix and deep linking
});
