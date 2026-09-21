import express from 'express';
import {
    previewReminder,
    createAndRunDueReminder,
    getReminders,
    getReminder,
    deleteReminder
} from '../controllers/whatsappReminderController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

// Due reminders (collections)
router.post('/preview', previewReminder);
router.post('/dues', createAndRunDueReminder);

// Reminder history
router.get('/', getReminders);
router.get('/:id', getReminder);
router.delete('/:id', deleteReminder);

export default router;