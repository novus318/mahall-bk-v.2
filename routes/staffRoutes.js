import express from 'express';
import {
    createStaff,
    getStaff,
    getStaffById,
    updateStaff,
    giveAdvance,
    generatePayslip,
    markPayslipPaid,
    initiatePayslipRejection,
    confirmPayslipRejection
} from '../controllers/staffController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.route('/')
    .post(protect, createStaff)
    .get(protect, getStaff);

router.route('/:id')
    .get(protect, getStaffById)
    .put(protect, updateStaff);

router.route('/:id/advance')
    .post(protect, giveAdvance);

router.route('/:id/payslips')
    .post(protect, generatePayslip);

router.route('/:id/payslips/:payslipId/pay')
    .put(protect, markPayslipPaid);

router.route('/:id/payslips/:payslipId/reject/initiate')
    .post(protect, initiatePayslipRejection);

router.route('/:id/payslips/:payslipId/reject/confirm')
    .post(protect, confirmPayslipRejection);

export default router;
