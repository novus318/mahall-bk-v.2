import express from 'express';
import {
    createAccount,
    getAccounts,
    updateAccount,
    deleteAccount,
    transferFunds,
    getAccountTransactions,
    getAllTransactions,
    exportTransactions,
    getIncomeExpenseReport,
    getReceivablesReport,
    getPayablesReport
} from '../controllers/accountController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.route('/').post(protect, createAccount).get(protect, getAccounts);
router.route('/transfer').post(protect, transferFunds);
router.route('/transactions/all').get(protect, getAllTransactions);
router.route('/transactions/export').get(protect, exportTransactions);
router.route('/reports/income-expense').get(protect, getIncomeExpenseReport);
router.route('/reports/receivables').get(protect, getReceivablesReport);
router.route('/reports/payables').get(protect, getPayablesReport);
router.route('/:id').put(protect, updateAccount).delete(protect, deleteAccount);
router.route('/:id/transactions').get(protect, getAccountTransactions);

export default router;
