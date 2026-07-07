import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
    createReceiptCategory,
    getReceiptCategories,
    deleteReceiptCategory,
    createReceipt,
    getReceipts,
    updateReceipt,
    getReceiptById,
    updateReceiptCategory,
    downloadReceiptPdf
} from '../controllers/receiptController.js';

const router = express.Router();

router.get('/:id/pdfprint', downloadReceiptPdf);
router.get('/categories', protect, getReceiptCategories);
router.post('/categories', protect, createReceiptCategory);
router.put('/categories/:id', protect, updateReceiptCategory);
router.delete('/categories/:id', protect, deleteReceiptCategory);
router.post('/', protect, createReceipt);
router.get('/', protect, getReceipts);
router.put('/:id', protect, updateReceipt);
router.get('/:id', protect, getReceiptById);

export default router;
