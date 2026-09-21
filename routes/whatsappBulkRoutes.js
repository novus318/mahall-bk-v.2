import express from 'express';
import {
    getTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    metaStatus,
    getMetaConfig,
    saveMetaConfig,
    preview,
    exportRecipients,
    exportPhoneAudit,
    createBroadcast,
    getBroadcasts,
    getBroadcast,
    deleteBroadcast,
    runBroadcast
} from '../controllers/whatsappBulkController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Templates (managed via WhatsApp Cloud API)
router.get('/templates', protect, getTemplates);
router.post('/templates', protect, createTemplate);
router.put('/templates/:id', protect, updateTemplate);
router.delete('/templates/:id', protect, deleteTemplate);

// Meta connection / setup status + WABA config (persisted to DB)
router.get('/meta/status', protect, metaStatus);
router.get('/meta/config', protect, getMetaConfig);
router.post('/meta/config', protect, saveMetaConfig);

// Preview audience before running
router.post('/bulk/preview', protect, preview);
router.post('/bulk/export', protect, exportRecipients);
router.post('/bulk/export/audit', protect, exportPhoneAudit);

// Broadcasts
router.post('/broadcasts', protect, createBroadcast);
router.get('/broadcasts', protect, getBroadcasts);
router.get('/broadcasts/:id', protect, getBroadcast);
router.delete('/broadcasts/:id', protect, deleteBroadcast);
router.post('/broadcasts/:id/run', protect, runBroadcast);

export default router;