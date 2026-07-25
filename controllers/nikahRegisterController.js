import PDFDocument from 'pdfkit';
import NikahRegister from '../models/NikahRegister.js';

const generateRegisterNo = async () => {
    const year = new Date().getFullYear();
    const last = await NikahRegister.findOne({ registerNo: new RegExp(`^NR/${year}/`) })
        .sort({ registerNo: -1 })
        .select('registerNo')
        .lean();
    let next = 1;
    if (last?.registerNo) {
        const parts = last.registerNo.split('/');
        next = parseInt(parts[2], 10) + 1;
    }
    return `NR/${year}/${String(next).padStart(4, '0')}`;
};

export const createNikahRegister = async (req, res) => {
    try {
        const registerNo = await generateRegisterNo();
        const record = new NikahRegister({ ...req.body, registerNo });
        const created = await record.save();
        res.status(201).json(created);
    } catch (error) {
        console.error(error);
        res.status(400).json({ message: error.message || 'Failed to create nikah register' });
    }
};

export const getNikahRegisters = async (req, res) => {
    try {
        const records = await NikahRegister.find({}).sort({ createdAt: -1 });
        res.json(records);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
};

export const getNikahRegisterById = async (req, res) => {
    try {
        const record = await NikahRegister.findById(req.params.id);
        if (record) {
            res.json(record);
        } else {
            res.status(404).json({ message: 'Nikah register not found' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
};

export const updateNikahRegister = async (req, res) => {
    try {
        const record = await NikahRegister.findById(req.params.id);
        if (record) {
            Object.assign(record, req.body);
            const updated = await record.save();
            res.json(updated);
        } else {
            res.status(404).json({ message: 'Nikah register not found' });
        }
    } catch (error) {
        console.error(error);
        res.status(400).json({ message: error.message || 'Failed to update nikah register' });
    }
};

export const downloadNikahCertificatePdf = async (req, res) => {
    try {
        const record = await NikahRegister.findById(req.params.id);
        if (!record) return res.status(404).json({ status: false, message: 'Nikah register not found' });

        const doc = new PDFDocument({ size: 'A4', margin: 50, layout: 'portrait' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=NikahCertificate-${record.registerNo}.pdf`);
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
        y += 24;

        doc.font('Helvetica-Bold').fontSize(16).fillColor('#000')
            .text('NIKAH CERTIFICATE', MG, y, { width: CW, align: 'center' });
        y += 10;

        doc.font('Helvetica').fontSize(9).fillColor('#666')
            .text(`Register No: ${record.registerNo}`, MG, y, { width: CW, align: 'center' });
        y += 24;

        const L = 130;
        const LH = 20;
        doc.fontSize(10).fillColor('#000');

        const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

        const sections = [
            {
                title: 'Groom Details',
                fields: [
                    { label: 'Name', value: record.groomName },
                    { label: 'Father\'s Name', value: record.groomFatherName },
                    { label: 'Address', value: record.groomAddress || '-' },
                    { label: 'Mahall ID', value: record.groomMahallId || '-' },
                ]
            },
            {
                title: 'Bride Details',
                fields: [
                    { label: 'Name', value: record.brideName },
                    { label: 'Father\'s Name', value: record.brideFatherName },
                    { label: 'Address', value: record.brideAddress || '-' },
                    { label: 'Mahall ID', value: record.brideMahallId || '-' },
                ]
            },
            {
                title: 'Nikah Details',
                fields: [
                    { label: 'Date of Nikah', value: fmtDate(record.nikahDate) },
                    { label: 'Time of Nikah', value: record.nikahTime || '-' },
                    { label: 'Place of Nikah', value: record.nikahPlace },
                    { label: 'Mahr Amount', value: record.mahrAmount },
                ]
            },
            {
                title: 'Witnesses & Officiator',
                fields: [
                    { label: 'Bride Guardian (Wali)', value: record.brideGuardian },
                    { label: 'Witness 1', value: record.witness1Name },
                    { label: 'Witness 2', value: record.witness2Name },
                    { label: 'Qazi / Imam', value: record.qaziName },
                ]
            },
        ];

        sections.forEach((section) => {
            if (y + section.fields.length * LH + 40 > doc.page.height - MG) {
                doc.addPage();
                y = MG;
            }

            doc.font('Helvetica-Bold').fontSize(11).fillColor('#000')
                .text(section.title, MG, y, { width: CW });
            y += 4;
            doc.lineWidth(0.5).moveTo(MG, y).lineTo(PW - MG, y).strokeColor('#ccc').stroke();
            y += 6;

            section.fields.forEach((f) => {
                doc.lineWidth(0.5).rect(MG, y, CW, LH).stroke('#eee');
                doc.font('Helvetica-Bold').fontSize(9).fillColor('#333').text(f.label, MG + 8, y + 5, { width: L });
                doc.font('Helvetica').fontSize(9).fillColor('#000').text(f.value, MG + L + 8, y + 5, { width: CW - L - 16 });
                y += LH;
            });

            y += 14;
        });

        if (record.remarks) {
            doc.font('Helvetica-Bold').fontSize(9).fillColor('#333').text('Remarks:', MG, y, { width: L });
            doc.font('Helvetica').fontSize(9).fillColor('#000').text(record.remarks, MG + L, y, { width: CW - L });
            y += 16;
        }

        y += 14;
        const dateLabel = record.dateOfRegistration
            ? `Date of Registration: ${fmtDate(record.dateOfRegistration)}`
            : `Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}`;
        doc.fontSize(8).fillColor('#888').text(dateLabel, MG, y, { width: CW, align: 'center' });

        doc.end();
    } catch (error) {
        console.error(error);
        if (!res.headersSent) res.status(500).json({ status: false, message: error.message });
    }
};
