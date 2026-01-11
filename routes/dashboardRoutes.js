import express from 'express';
import { getDashboardStats, getRecentActivity } from '../controllers/dashboardController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/stats', protect, getDashboardStats);
router.get('/recent', protect, getRecentActivity);

export default router;
