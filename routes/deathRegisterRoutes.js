import express from 'express';
import { createDeathRegister, getDeathRegisters, getDeathRegisterById, updateDeathRegister, downloadDeathRegisterPdf } from '../controllers/deathRegisterController.js';

const router = express.Router();

// Public route - no auth required
router.get('/:id/pdf', downloadDeathRegisterPdf);

router.route('/')
    .get(getDeathRegisters)
    .post(createDeathRegister);

router.route('/:id')
    .get(getDeathRegisterById)
    .put(updateDeathRegister);

export default router;
