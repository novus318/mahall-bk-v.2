import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import connectDB from './config/db.js';

dotenv.config();

connectDB();

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('API is running...');
});

// Import routes
import mahallRoutes from './routes/mahallRoutes.js';
import authRoutes from './routes/authRoutes.js';

app.use('/api/auth', authRoutes);
app.use('/api', mahallRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
