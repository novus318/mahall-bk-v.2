import express from 'express';
import { getPrintData } from '../controllers/collectionController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/receipts/:id', getPrintData);

router.use(protect);

export default router;
