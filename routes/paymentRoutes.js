import express from 'express';
import {
    getPaymentCategories, createPaymentCategory, updatePaymentCategory, deletePaymentCategory,
    getPayments, createPayment, updatePayment, getPaymentById,
    markPaymentAsPaid, deletePayment, downloadPaymentPdf
} from '../controllers/paymentController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/:id/pdfprint', downloadPaymentPdf);
router.get('/categories', protect, getPaymentCategories);
router.post('/categories', protect, authorize('admin'), createPaymentCategory);
router.put('/categories/:id', protect, authorize('admin'), updatePaymentCategory);
router.delete('/categories/:id', protect, authorize('admin'), deletePaymentCategory);
router.get('/', protect, getPayments);
router.get('/:id', protect, getPaymentById);
router.post('/', protect, createPayment);
router.put('/:id', protect, updatePayment);
router.put('/:id/mark-paid', protect, markPaymentAsPaid);
router.delete('/:id', protect, deletePayment);

export default router;
