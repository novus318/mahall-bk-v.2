import express from 'express';
import {
    updateSubscription,
    getDues,
    generateSingleDue,
    payDue,
    initiateRejection,
    confirmRejection
} from '../controllers/collectionController.js';

const router = express.Router();

router.put('/:type/:id/subscription', updateSubscription);
router.get('/dues', getDues);
router.post('/generate/single', generateSingleDue);
router.post('/pay', payDue);
router.post('/reject/initiate', initiateRejection);
router.post('/reject/confirm', confirmRejection);

export default router;
