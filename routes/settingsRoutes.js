import express from 'express';
import { getAlertContacts, updateAlertContacts } from '../controllers/settingsController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.route('/alert-contacts')
    .get(authorize('admin', 'staff'), getAlertContacts)
    .put(authorize('admin'), updateAlertContacts);

export default router;
