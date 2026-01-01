import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
    createReceiptCategory,
    getReceiptCategories,
    deleteReceiptCategory,
    createReceipt,
    getReceipts,
    updateReceipt,
    getReceiptById
} from '../controllers/receiptController.js';

const router = express.Router();

// Categories
router.route('/categories').get(protect, getReceiptCategories).post(protect, createReceiptCategory);
router.route('/categories/:id').delete(protect, deleteReceiptCategory);

// Receipts
router.route('/')
    .post(protect, createReceipt)
    .get(protect, getReceipts);

router.route('/:id')
    .put(protect, updateReceipt)
    .get(protect, getReceiptById);

export default router;
