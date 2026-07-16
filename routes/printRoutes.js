import express from 'express';
import { getCollectionPrintData } from '../controllers/collectionController.js';
import { getIncomePrintData } from '../controllers/receiptController.js';

const router = express.Router();

router.get('/col/:id', getCollectionPrintData);
router.get('/inc/:id', getIncomePrintData);

// Backward compat: old /api/print/receipts/:id → collection
router.get('/receipts/:id', getCollectionPrintData);

export default router;
