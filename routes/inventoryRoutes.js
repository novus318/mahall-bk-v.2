import express from 'express';
import {
    getItems,
    createItem,
    restockItem,
    getTransactions,
    createTransaction,
    returnTransaction,
    getItemRestockHistory,
    reportDamage,
    payRent,
    getTransactionReceipts,
    downloadInventoryReceiptPdf,
    updateItem
} from '../controllers/inventoryController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.route('/items')
    .get(protect, getItems)
    .post(protect, createItem);

router.route('/items/:id')
    .put(protect, updateItem);
router.route('/items/:id/restock').put(protect, restockItem);
router.route('/items/:id/damage').put(protect, reportDamage);
router.route('/items/:id/restock-history').get(protect, getItemRestockHistory);

router.route('/transactions')
    .get(protect, getTransactions)
    .post(protect, createTransaction);

router.route('/transactions/:id/return').put(protect, returnTransaction);
router.route('/transactions/:id/pay').post(protect, payRent);
router.route('/transactions/:id/receipts').get(protect, getTransactionReceipts);

router.route('/receipts/:id/pdf').get(protect, downloadInventoryReceiptPdf);

export default router;
