import express from 'express';
import {
    getPaymentCategories, createPaymentCategory, updatePaymentCategory, deletePaymentCategory,
    getPayments, createPayment, updatePayment, getPaymentById,
    markPaymentAsPaid, deletePayment, downloadPaymentPdf
} from '../controllers/paymentController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public Routes
router.get('/:id/pdf', downloadPaymentPdf);

// Protected Routes
router.use(protect);

// Categories
router.get('/categories', getPaymentCategories);
router.post('/categories', authorize('admin'), createPaymentCategory);
router.put('/categories/:id', authorize('admin'), updatePaymentCategory);
router.delete('/categories/:id', authorize('admin'), deletePaymentCategory);

// Payments
router.get('/', getPayments);
router.get('/:id', getPaymentById);
router.post('/', createPayment);
router.put('/:id', updatePayment);
router.put('/:id/mark-paid', markPaymentAsPaid);
router.delete('/:id', deletePayment);

export default router;
