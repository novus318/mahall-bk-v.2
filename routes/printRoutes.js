import express from 'express';
import { getPrintData } from '../controllers/collectionController.js';

const router = express.Router();

router.get('/receipts/:id', getPrintData);

export default router;
