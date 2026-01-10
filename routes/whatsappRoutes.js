import express from 'express';
import multer from 'multer';
import {
    verifyWebhook,
    receiveWebhook,
    sendMessage,
    getContacts,
    getMessages,
    refreshLink,
    getMedia,
    uploadMedia
} from '../controllers/whatsappController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Multer Config (Memory Storage for immediate re-upload)
const upload = multer({ storage: multer.memoryStorage() });

// Webhooks (Public - Called by Facebook)
router.get('/webhook', verifyWebhook);
router.post('/webhook', receiveWebhook);

// Internal API (Protected - Called by Frontend)
router.post('/send', protect, sendMessage);
router.post('/upload', protect, upload.single('file'), uploadMedia); // New Upload Route
router.get('/contacts', protect, getContacts);
router.get('/messages/:contactId', protect, getMessages);
router.post('/refresh/:contactId', protect, refreshLink);
router.get('/media/:mediaId', getMedia); // Public so <img> tags work (relies on unguessable Media ID)

export default router;
