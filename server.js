import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import connectDB from './config/db.js';

dotenv.config();

connectDB();

const app = express();

app.use(cors({
    origin: 'http://localhost:3000',
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

app.use('/api/auth', authRoutes);
app.use('/api', mahallRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/buildings', buildingRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/staff', staffRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
