import express from 'express';
import {
    updateSubscription,
    getDues,
    generateSingleDue,
    generateBulkDues,
    payDue,
    initiateRejection,
    confirmRejection,
    getCollectionReceipt,
    downloadCollectionReceiptPdf,
    getCollectionPeriods
} from '../controllers/collectionController.js';

import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public Routes
router.get('/receipts/:id/pdf', downloadCollectionReceiptPdf);

// Protected Routes
router.use(protect);

router.put('/:type/:id/subscription', updateSubscription);
router.get('/dues', getDues);
router.get('/periods', getCollectionPeriods);
router.get('/receipts/:id', getCollectionReceipt);
router.post('/generate/single', generateSingleDue);
router.post('/generate/bulk', generateBulkDues);
router.post('/pay', payDue);
router.post('/reject/initiate', initiateRejection);
router.post('/reject/confirm', confirmRejection);

export default router;
