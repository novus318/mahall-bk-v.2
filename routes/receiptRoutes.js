import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
    createReceiptCategory,
    getReceiptCategories,
    deleteReceiptCategory,
    createReceipt,
    getReceipts,
    exportReceipts,
    updateReceipt,
    getReceiptById,
    updateReceiptCategory,
    downloadReceiptPdf
} from '../controllers/receiptController.js';

const router = express.Router();

// Public Routes
router.get('/:id/pdf', downloadReceiptPdf);

// Protected Routes
router.use(protect);

// Categories
router.get('/categories', getReceiptCategories);
router.post('/categories', createReceiptCategory);
router.put('/categories/:id', updateReceiptCategory);
router.delete('/categories/:id', deleteReceiptCategory);

// Receipts
router.get('/', getReceipts);
router.post('/export', exportReceipts);
router.get('/:id', getReceiptById);
router.post('/', createReceipt);
router.put('/:id', updateReceipt);

export default router;
