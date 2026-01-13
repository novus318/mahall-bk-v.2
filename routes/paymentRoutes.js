import express from 'express';
import {
    getPaymentCategories, createPaymentCategory, updatePaymentCategory, deletePaymentCategory, // Added export
    getPayments, createPayment, updatePayment, getPaymentById
} from '../controllers/paymentController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Categories
router.get('/categories', protect, getPaymentCategories);
router.post('/categories', protect, authorize('admin'), createPaymentCategory);
router.put('/categories/:id', protect, authorize('admin'), updatePaymentCategory); // Added update route
router.delete('/categories/:id', protect, authorize('admin'), deletePaymentCategory);

// Payments
router.get('/', protect, getPayments);
router.get('/:id', protect, getPaymentById);
router.post('/', protect, createPayment);
router.put('/:id', protect, updatePayment);

export default router;
