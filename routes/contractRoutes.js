import express from 'express';
import {
    createContract,
    getContracts,
    getContract,
    updateContract,
    terminateContract,
    getFinancials,
    generateRent,
    payRent,
    collectDeposit,
    generateBulkRent
} from '../controllers/contractController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Bulk Rent Generation (must come before /:id)
router.route('/generate/bulk')
    .post(protect, generateBulkRent);

router.route('/')
    .post(protect, createContract)
    .get(protect, getContracts);

router.route('/:id')
    .get(protect, getContract)
    .put(protect, updateContract);

router.route('/:id/terminate')
    .put(protect, terminateContract);

// Financial Routes
router.route('/:id/financials')
    .get(protect, getFinancials);

router.route('/:id/rents')
    .post(protect, generateRent);

router.route('/:id/rents/:rentId/pay')
    .put(protect, payRent);

// Simplified Deposit Route
router.route('/:id/deposit/collect')
    .post(protect, collectDeposit);

// Bulk Rent Generation
router.route('/generate/bulk')
    .post(protect, generateBulkRent);

export default router;
