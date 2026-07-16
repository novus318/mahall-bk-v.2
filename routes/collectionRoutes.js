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
    getCollectionPrintData,
    getCollectionPeriods,
    getArrearsSummary,
    sendArrearsReminder,
    getPublicEntityDues,
    getPublicEntityDetails
} from '../controllers/collectionController.js';

import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public Routes
router.get('/receipts/:id/pdf', downloadCollectionReceiptPdf);
router.get('/receipts/:id/print', getCollectionPrintData);
router.get('/public/:type/:id/dues', getPublicEntityDues);
router.get('/public/:type/:id/details', getPublicEntityDetails);

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
router.get('/arrears', getArrearsSummary);
router.post('/remind/summary', sendArrearsReminder);

export default router;
