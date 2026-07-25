import PDFDocument from 'pdfkit';
import DeathRegister from '../models/DeathRegister.js';

export const createDeathRegister = async (req, res) => {
    try {
        const record = new DeathRegister(req.body);
        const created = await record.save();
        res.status(201).json(created);
    } catch (error) {
        console.error(error);
        res.status(400).json({ message: error.message || 'Failed to create death record' });
    }
};

export const getDeathRegisters = async (req, res) => {
    try {
        const records = await DeathRegister.find({}).sort({ createdAt: -1 });
        res.json(records);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
};

export const getDeathRegisterById = async (req, res) => {
    try {
        const record = await DeathRegister.findById(req.params.id);
        if (record) {
            res.json(record);
        } else {
            res.status(404).json({ message: 'Death record not found' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
};

export const updateDeathRegister = async (req, res) => {
    try {
        const record = await DeathRegister.findById(req.params.id);
        if (record) {
            Object.assign(record, req.body);
            const updated = await record.save();
            res.json(updated);
        } else {
            res.status(404).json({ message: 'Death record not found' });
        }
    } catch (error) {
        console.error(error);
        res.status(400).json({ message: error.message || 'Failed to update death record' });
    }
};

export const downloadDeathRegisterPdf = async (req, res) => {
    try {
        const record = await DeathRegister.findById(req.params.id);
        if (!record) return res.status(404).json({ status: false, message: 'Death record not found' });

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=DeathRecord-${record._id}.pdf`);
        doc.pipe(res);

        const PW = doc.page.width;
        const MG = 50;
        const CW = PW - MG * 2;
        let y = MG;

        doc.font('Helvetica-Bold').fontSize(18).fillColor('#000')
            .text('THAYINERI MUSLIM JAMA-AT', MG, y, { width: CW, align: 'center' });
        y += 22;

        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000')
            .text('(TMJ)', MG, y, { width: CW, align: 'center' });
        y += 16;

        doc.font('Helvetica').fontSize(9).fillColor('#555')
            .text('Thayineri Kara Road, Thayineri, Kerala 670307 | Ph: +91 8129059992', MG, y, { width: CW, align: 'center' });
        y += 14;

        doc.lineWidth(1).moveTo(MG, y).lineTo(PW - MG, y).strokeColor('#000').stroke();
        y += 20;

        doc.font('Helvetica-Bold').fontSize(16).fillColor('#000')
            .text('DEATH REGISTER', MG, y, { width: CW, align: 'center' });
        y += 30;

        const L = 120;
        const LH = 18;
        doc.fontSize(10).fillColor('#000');

        const fields = [
            { label: 'Name', value: record.name },
            { label: 'Gender', value: record.gender || '-' },
            { label: 'Mahall ID', value: record.mahallId || '-' },
            { label: 'Age', value: record.age != null ? String(record.age) : '-' },
            { label: 'Address', value: record.address || '-' },
            { label: 'Date of Death', value: new Date(record.dateOfDeath).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) },
            { label: 'Place of Death', value: record.placeOfDeath || '-' },
            { label: 'Cause of Death', value: record.causeOfDeath || '-' },
            { label: 'Date of Burial', value: record.dateOfBurial ? new Date(record.dateOfBurial).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-' },
            { label: 'Zone', value: record.zone || '-' },
            { label: 'Informer Name', value: record.informerName },
            { label: 'Informer Phone', value: record.informerPhone || '-' },
        ];

        fields.forEach((f) => {
            doc.lineWidth(0.5).rect(MG, y, CW, LH).stroke('#ccc');
            doc.font('Helvetica-Bold').text(f.label, MG + 8, y + 4, { width: L });
            doc.font('Helvetica').text(f.value, MG + L + 8, y + 4, { width: CW - L - 16 });
            y += LH;
        });

        y += 20;
        doc.fontSize(8).fillColor('#888')
            .text('Generated: ' + new Date().toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true
            }), MG, y, { width: CW, align: 'center' });

        doc.end();
    } catch (error) {
        console.error(error);
        if (!res.headersSent) res.status(500).json({ status: false, message: error.message });
    }
};
