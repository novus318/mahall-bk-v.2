import MarriageCertificate from '../models/MarriageCertificate.js';

export const createCertificate = async (req, res) => {
    try {
        const certificate = new MarriageCertificate(req.body);
        const createdCertificate = await certificate.save();
        res.status(201).json(createdCertificate);
    } catch (error) {
        console.error(error);
        res.status(400).json({ message: error.message || 'Failed to create certificate' });
    }
};

export const getCertificates = async (req, res) => {
    try {
        const certificates = await MarriageCertificate.find({}).sort({ createdAt: -1 });
        res.json(certificates);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
};

export const getCertificateById = async (req, res) => {
    try {
        const certificate = await MarriageCertificate.findById(req.params.id);
        if (certificate) {
            res.json(certificate);
        } else {
            res.status(404).json({ message: 'Certificate not found' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
};

export const updateCertificate = async (req, res) => {
    try {
        const certificate = await MarriageCertificate.findById(req.params.id);
        if (certificate) {
            Object.assign(certificate, req.body);
            const updatedCertificate = await certificate.save();
            res.json(updatedCertificate);
        } else {
            res.status(404).json({ message: 'Certificate not found' });
        }
    } catch (error) {
        console.error(error);
        res.status(400).json({ message: error.message || 'Failed to update certificate' });
    }
};
