import express from 'express';
import { createCertificate, getCertificates, getCertificateById, updateCertificate } from '../controllers/certificateController.js';

const router = express.Router();

router.route('/')
    .get(getCertificates)
    .post(createCertificate);

router.route('/:id')
    .get(getCertificateById)
    .put(updateCertificate);

export default router;
