import express from 'express';
import {
    getItems,
    createItem,
    restockItem,
    getTransactions,
    createTransaction,
    returnTransaction,
    getItemRestockHistory,
    reportDamage
} from '../controllers/inventoryController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.route('/items')
    .get(protect, getItems)
    .post(protect, createItem);

router.route('/items/:id/restock').put(protect, restockItem);
router.route('/items/:id/damage').put(protect, reportDamage);
router.route('/items/:id/restock-history').get(protect, getItemRestockHistory);

router.route('/transactions')
    .get(protect, getTransactions)
    .post(protect, createTransaction);

router.route('/transactions/:id/return').put(protect, returnTransaction);

export default router;
