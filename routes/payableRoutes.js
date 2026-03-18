import express from 'express';
import {
    createPayable,
    getPayables,
    getPayableById,
    updatePayable,
    recordRepayment,
    deletePayable,
    getPayableStats,
    cancelPayable
} from '../controllers/payableController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Stats route (must be before /:id)
router.get('/summary/stats', protect, getPayableStats);

// Main routes
router.route('/')
    .post(protect, createPayable)
    .get(protect, getPayables);

// Single payable routes
router.route('/:id')
    .get(protect, getPayableById)
    .put(protect, updatePayable)
    .delete(protect, deletePayable);

// Repayment route
router.post('/:id/repay', protect, recordRepayment);

// Cancel route
router.put('/:id/cancel', protect, cancelPayable);

export default router;
