import WhatsAppBroadcast from '../models/WhatsAppBroadcast.js';
import SystemSettings from '../models/SystemSettings.js';
import {
    fetchTemplates,
    createTemplate as cloudCreateTemplate,
    updateTemplate as cloudUpdateTemplate,
    deleteTemplate as cloudDeleteTemplate,
    normalizeTemplate,
    getMetaStatus,
} from '../services/whatsappCloudService.js';
import {
    previewBroadcast,
    executeBroadcast,
    resolveBody,
    resolveAllRecipients,
    auditMemberPhones,
} from '../services/whatsappBulkService.js';

// Look up the currently configured resolution (env first, then DB)
export const currentWaba = async () => {
    const env = process.env.WHATSAPP_WABA_ID;
    if (env && env !== 'your_waba_id_here') return { source: 'env', value: env };
    const settings = await SystemSettings.findOne();
    if (settings?.whatsappMeta?.waba) return { source: 'db', value: settings.whatsappMeta.waba };
    return { source: null, value: null };
};

// GET /api/whatsapp/meta/config
export const getMetaConfig = async (req, res) => {
    try {
        const { source, value } = await currentWaba();
        const status = await getMetaStatus();
        res.status(200).json({ success: true, data: { ...status, source, waba: value } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/whatsapp/meta/config - save the WABA ID (to DB) and test connectivity
export const saveMetaConfig = async (req, res) => {
    try {
        const { waba } = req.body;
        if (!waba || typeof waba !== 'string') {
            return res.status(400).json({ success: false, message: 'WABA ID is required' });
        }
        const clean = waba.trim();
        if (!/^\d{5,20}$/.test(clean)) {
            return res.status(400).json({ success: false, message: 'Invalid WABA ID: it must be a numeric ID' });
        }
        let settings = await SystemSettings.findOne();
        if (!settings) settings = new SystemSettings();
        settings.whatsappMeta = { waba: clean, verifiedAt: new Date() };
        await settings.save();
        const status = await getMetaStatus();
        res.status(200).json({ success: true, data: { ...status, source: 'db', waba: clean } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ---------- TEMPLATES (managed via WhatsApp Cloud API) ----------

// GET /api/whatsapp/templates
export const getTemplates = async (req, res) => {
    try {
        const templates = await fetchTemplates();
        res.status(200).json({ success: true, data: templates.map(normalizeTemplate) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message, metaCode: error.metaCode });
    }
};

// POST /api/whatsapp/templates
export const createTemplate = async (req, res) => {
    try {
        const { name, category, language, headerText, bodyText, footerText, urlButtonText, urlButtonUrl, quickReplies, header, buttons, examples } = req.body;
        if (!name || !category || !language || !bodyText) {
            return res.status(400).json({ success: false, message: 'Name, category, language and body text are required' });
        }
        const result = await cloudCreateTemplate({
            name, category, language, headerText, bodyText, footerText, urlButtonText, urlButtonUrl, quickReplies,
            header, buttons, examples,
        });
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message, meta: error.metaCode });
    }
};

// PUT /api/whatsapp/templates/:id  (edits an existing cloud template)
export const updateTemplate = async (req, res) => {
    try {
        const { category, headerText, bodyText, footerText, urlButtonText, urlButtonUrl, quickReplies, header, buttons, examples } = req.body;
        const result = await cloudUpdateTemplate(req.params.id, {
            category, headerText, bodyText, footerText, urlButtonText, urlButtonUrl, quickReplies,
            header, buttons, examples,
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message, meta: error.metaCode });
    }
};

// DELETE /api/whatsapp/templates/:id
export const deleteTemplate = async (req, res) => {
    try {
        const result = await cloudDeleteTemplate(req.params.id);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message, meta: error.metaCode });
    }
};

// GET /api/whatsapp/meta/status
export const metaStatus = async (req, res) => {
    try {
        const status = await getMetaStatus();
        res.status(200).json({ success: true, data: status });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ---------- BROADCASTS ----------

// POST /api/whatsapp/bulk/preview
export const preview = async (req, res) => {
    try {
        const { audience, customContacts, message, templateName, templateLanguage, templateParameterFormat, templateValues, templateHeaderFormat, templateHeaderMedia } = req.body;
        const { total, recipients } = await previewBroadcast(audience, customContacts);
        const sample = recipients[0];
        const rendered = templateName
            ? {
                templateName, language: templateLanguage, parameterFormat: templateParameterFormat || 'positional', values: templateValues || [],
                header: (templateHeaderFormat && templateHeaderMedia) ? { format: templateHeaderFormat, media: templateHeaderMedia } : null,
            }
            : resolveBody(message, sample);

        res.status(200).json({ success: true, total, recipients, rendered });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/whatsapp/bulk/export - export the resolved recipient list as an .xlsx file
export const exportRecipients = async (req, res) => {
    try {
        const ExcelJS = (await import('exceljs')).default;
        const { name, audience, customContacts } = req.body;
        if (!audience) return res.status(400).json({ success: false, message: 'Audience is required' });
        const recipients = await resolveAllRecipients(
            audience,
            audience === 'CUSTOM' ? (customContacts || []) : [],
        );

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Recipients');
        sheet.columns = [
            { header: 'Name', key: 'name', width: 24 },
            { header: 'Phone Number', key: 'phone', width: 18 },
            { header: 'Type', key: 'entityType', width: 14 },
            { header: 'Status', key: 'status', width: 14 },
        ];
        recipients.forEach(r => sheet.addRow({
            name: r.name || '',
            phone: r.phoneNumber,
            entityType: r.entityType || 'UNKNOWN',
            status: '—',
        }));
        sheet.getRow(1).font = { bold: true };

        const safe = (String(name || 'recipients').replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'recipients');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${safe}-recipients.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/whatsapp/bulk/export/audit - audit export of members excluded for invalid/missing phone numbers
export const exportPhoneAudit = async (req, res) => {
    try {
        const ExcelJS = (await import('exceljs')).default;
        const rows = await auditMemberPhones();

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Excluded Members');
        sheet.columns = [
            { header: 'Name', key: 'name', width: 24 },
            { header: 'Custom ID', key: 'customId', width: 12 },
            { header: 'Mobile', key: 'mobile', width: 16 },
            { header: 'WhatsApp', key: 'whatsapp', width: 16 },
            { header: 'Reason', key: 'reason', width: 40 },
            { header: 'House', key: 'house', width: 20 },
            { header: 'Status', key: 'status', width: 12 },
            { header: 'Gender', key: 'gender', width: 10 },
        ];
        rows.forEach(r => sheet.addRow({
            name: r.name,
            customId: r.customId,
            mobile: r.mobile,
            whatsapp: r.whatsapp,
            reason: r.reason,
            house: r.house,
            status: r.status,
            gender: r.gender,
        }));
        sheet.getRow(1).font = { bold: true };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="member-phone-audit.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
export const createBroadcast = async (req, res) => {
    try {
        const { name, message, audience, customContacts, templateName, templateLanguage, templateParameterFormat, templateValues, templateHeaderFormat, templateHeaderMedia } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
        if (!audience) return res.status(400).json({ success: false, message: 'Audience is required' });
        if (!message && !templateName) return res.status(400).json({ success: false, message: 'Message or template required' });

        const broadcast = await WhatsAppBroadcast.create({
            name,
            message: message || '',
            audience: {
                type: audience,
                customContacts: audience === 'CUSTOM' ? (customContacts || []) : []
            },
            messageTemplate: templateName
                ? {
                    name: templateName,
                    language: templateLanguage || 'en',
                    parameterFormat: templateParameterFormat || 'positional',
                    values: templateValues || (templateParameterFormat === 'named' ? {} : []),
                    header: (templateHeaderFormat && templateHeaderMedia)
                        ? { format: templateHeaderFormat, media: templateHeaderMedia }
                        : undefined,
                }
                : undefined,
            status: 'DRAFT',
            createdBy: req.user?._id
        });
        res.status(201).json({ success: true, data: broadcast });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getBroadcasts = async (req, res) => {
    try {
        const broadcasts = await WhatsAppBroadcast.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: broadcasts });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getBroadcast = async (req, res) => {
    try {
        const broadcast = await WhatsAppBroadcast.findById(req.params.id);
        if (!broadcast) return res.status(404).json({ success: false, message: 'Broadcast not found' });
        res.status(200).json({ success: true, data: broadcast });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const deleteBroadcast = async (req, res) => {
    try {
        const broadcast = await WhatsAppBroadcast.findByIdAndDelete(req.params.id);
        if (!broadcast) return res.status(404).json({ success: false, message: 'Broadcast not found' });
        res.status(200).json({ success: true, data: broadcast });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/whatsapp/broadcasts/:id/run
export const runBroadcast = async (req, res) => {
    try {
        const broadcast = await executeBroadcast(req.params.id);
        res.status(200).json({ success: true, data: broadcast });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};