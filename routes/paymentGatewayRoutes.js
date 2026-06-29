import express from 'express';
import { createOrder, handleWebhook } from '../controllers/paymentGatewayController.js';

const router = express.Router();

router.post('/create-order', createOrder);
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

export default router;
