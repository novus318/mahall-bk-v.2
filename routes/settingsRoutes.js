import express from 'express';
import {
    getAlertContacts, updateAlertContacts,
    getPaymentSettings,
    updatePaymentSettings
} from '../controllers/settingsController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

router.route('/alert-contacts').get(protect, authorize('admin'), getAlertContacts).put(protect, authorize('admin'), updateAlertContacts);
router.route('/payments').get(protect, authorize('admin'), getPaymentSettings).put(protect, authorize('admin'), updatePaymentSettings);

export default router;
