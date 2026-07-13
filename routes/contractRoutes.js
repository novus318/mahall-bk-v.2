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
    generateBulkRent,
    getRentDues,
    getRentPeriods,
    getRentArrearsSummary,
    sendRentReminder,
    getPublicRentDetails,
    getPublicRentDues
} from '../controllers/contractController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public Routes
router.get('/public/:id/details', getPublicRentDetails);
router.get('/public/:id/dues', getPublicRentDues);

// Rent Collection Routes
router.route('/rent/dues').get(protect, getRentDues);
router.route('/rent/periods').get(protect, getRentPeriods);
router.route('/rent/arrears').get(protect, getRentArrearsSummary);
router.route('/rent/remind/summary').post(protect, sendRentReminder);

// Bulk Rent Generation
router.route('/generate/bulk').post(protect, generateBulkRent);

router.route('/').post(protect, createContract).get(protect, getContracts);

router.route('/:id').get(protect, getContract).put(protect, updateContract);
router.route('/:id/terminate').put(protect, terminateContract);
router.route('/:id/financials').get(protect, getFinancials);
router.route('/:id/rents').post(protect, generateRent);
router.route('/:id/rents/:rentId/pay').put(protect, payRent);
router.route('/:id/deposit/collect').post(protect, collectDeposit);

export default router;
