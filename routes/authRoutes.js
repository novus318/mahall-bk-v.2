import express from 'express';
import { authUser, refreshAccessToken } from '../controllers/authController.js';

const router = express.Router();

router.post('/login', authUser);
router.post('/refresh', refreshAccessToken);

export default router;
