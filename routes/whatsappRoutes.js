import express from 'express';
import {
    verifyWebhook,
    receiveWebhook,
    sendMessage,
    getContacts,
    getMessages,
    refreshLink,
    getMedia
} from '../controllers/whatsappController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Webhooks (Public - Called by Facebook)
router.get('/webhook', verifyWebhook);
router.post('/webhook', receiveWebhook);

// Internal API (Protected - Called by Frontend)
router.post('/send', protect, sendMessage);
router.get('/contacts', protect, getContacts);
router.get('/messages/:contactId', protect, getMessages);
router.post('/refresh/:contactId', protect, refreshLink);
router.get('/media/:mediaId', getMedia); // Public so <img> tags work (relies on unguessable Media ID)

export default router;
