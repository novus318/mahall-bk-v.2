import express from 'express';
import {
    getAlertContacts, updateAlertContacts,
    getPaymentSettings,
    updatePaymentSettings,
    getCollectionSettings,
    updateCollectionSettings,
    getRentSettings,
    updateRentSettings,
    sendSettingsOTP,
    verifySettingsOTP
} from '../controllers/settingsController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// OTP routes for settings access
router.post('/send-otp', protect, authorize('admin'), sendSettingsOTP);
router.post('/verify-otp', protect, authorize('admin'), verifySettingsOTP);

router.route('/alert-contacts').get(protect, authorize('admin'), getAlertContacts).put(protect, authorize('admin'), updateAlertContacts);
router.route('/payments').get(protect, authorize('admin'), getPaymentSettings).put(protect, authorize('admin'), updatePaymentSettings);
router.route('/collections').get(protect, authorize('admin'), getCollectionSettings).put(protect, authorize('admin'), updateCollectionSettings);
router.route('/rent').get(protect, authorize('admin'), getRentSettings).put(protect, authorize('admin'), updateRentSettings);

export default router;
