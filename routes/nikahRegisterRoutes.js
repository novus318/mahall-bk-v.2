import express from 'express';
import { createNikahRegister, getNikahRegisters, getNikahRegisterById, updateNikahRegister, downloadNikahCertificatePdf } from '../controllers/nikahRegisterController.js';

const router = express.Router();

router.get('/:id/pdf', downloadNikahCertificatePdf);

router.route('/')
    .get(getNikahRegisters)
    .post(createNikahRegister);

router.route('/:id')
    .get(getNikahRegisterById)
    .put(updateNikahRegister);

export default router;
