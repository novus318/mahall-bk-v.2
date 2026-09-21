import axios from 'axios';
import SystemSettings from '../models/SystemSettings.js';
import dotenv from 'dotenv';
dotenv.config();

const TOKEN = process.env.WHATSAPP_TOKEN;
const API_VERSION = 'v25.0';
const GRAPH_BASE = `https://graph.facebook.com/${API_VERSION}`;
const ENV_WABA_ID = process.env.WHATSAPP_WABA_ID;
const PHONE_ID = '1064786796718809';

// Resolve the WABA ID: env takes precedence, otherwise fall back to the value
// configured in the database (set from the app UI). 
const getWaba = async () => {
    if (ENV_WABA_ID && ENV_WABA_ID !== 'your_waba_id_here') {
        return ENV_WABA_ID;
    }
    try {
        const settings = await SystemSettings.findOne();
        if (settings?.whatsappMeta?.waba) return settings.whatsappMeta.waba;
    } catch (error) {
        // DB not ready; fall through to env error below
    }
    throw new Error('WHATSAPP_WABA_ID is not configured. Set it in .env or from the Templates page.');
};

const headers = {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
};

const handleError = (error) => {
    const message = error.response?.data?.error?.message || error.message;
    const code = error.response?.data?.error?.code;
    const err = new Error(message);
    err.metaCode = code;
    err.raw = error.response?.data;
    throw err;
};

// ---------- TEMPLATE CRUD (WhatsApp Cloud API) ----------

// GET /{WABA}/message_templates -> list
export const fetchTemplates = async () => {
    try {
        const waba = await getWaba();
        const { data } = await axios.get(`${GRAPH_BASE}/${waba}/message_templates?limit=500`, { headers });
        return data.data || [];
    } catch (error) {
        handleError(error);
    }
};

// POST /{WABA}/message_templates -> create
export const createTemplate = async (template) => {
    try {
        const waba = await getWaba();
        const components = buildComponents(template);
        const { data } = await axios.post(
            `${GRAPH_BASE}/${waba}/message_templates`,
            payloadForTemplate(template, components),
            { headers }
        );
        return data;
    } catch (error) {
        console.error(error.response?.data || error.message);
        handleError(error);
    }
};

// POST /{MESSAGE_TEMPLATE_ID} -> update edited components/category
export const updateTemplate = async (templateId, payload) => {
    try {
        const newComponents = buildComponents(payload);
        const body = {};
        // Category can only be edited for REJECTED/PAUSED templates (not APPROVED),
        // so only send it when the caller explicitly provides a different one.
        if (payload.category && ['AUTHENTICATION', 'MARKETING', 'UTILITY'].includes(String(payload.category).toUpperCase())) {
            body.category = String(payload.category).toUpperCase();
        }
        if (newComponents.length) body.components = newComponents;
        if (Object.keys(body).length === 0) {
            throw new Error('Nothing to edit');
        }
        const { data } = await axios.post(`${GRAPH_BASE}/${templateId}`, body, { headers });
        return data;
    } catch (error) {
        handleError(error);
    }
};

// DELETE /{MESSAGE_TEMPLATE_ID}
export const deleteTemplate = async (templateId) => {
    try {
        const { data } = await axios.delete(`${GRAPH_BASE}/${templateId}`, { headers });
        return data;
    } catch (error) {
        handleError(error);
    }
};

const textOf = (text) => text || '';

// Normalize a cloud template to a UI-friendly shape
export const normalizeTemplate = (t) => {
    const header = t.components?.find(c => c.type === 'HEADER');
    const body = t.components?.find(c => c.type === 'BODY');
    const footer = t.components?.find(c => c.type === 'FOOTER');
    const buttons = t.components?.find(c => c.type === 'BUTTONS');

    const textContent = textOf(body?.text);
    const parameterFormat = detectParameterFormat(body.text);
    const parameters = extractParameters(body.text);
    const paramsMeta = parameters.map(p => {
        const isNamed = !/^\d+$/.test(p);
        const example = isNamed
            ? body.example?.body_text_named_params?.find(x => x.param_name === p)?.example
            : body.example?.body_text?.[0]?.[Number(p) - 1];
        return { name: p, format: isNamed ? 'named' : 'positional', example: example || null };
    });

    return {
        id: t.id,
        name: t.name,
        status: t.status, // APPROVED | PENDING | REJECTED | PAUSED | DISABLED | IN_APPEAL
        category: t.category,
        language: t.language,
        qualityScore: t.quality_score !== undefined ? t.quality_score : null,
        rejectedReason: t.rejected_reason || null,
        lastSubmittedName: t.last_submitted_name || null,
        parameterFormat,
        header: header ? { format: header.format, text: header.text, sample: header.example?.header_handle?.[0] || null } : null,
        body: body ? { text: textContent, params: paramsMeta } : null,
        footer: footer ? footer.text : null,
        buttons: buttons?.buttons?.map(b => ({
            type: b.type,
            text: b.text,
            url: b.url,
            phone_number: b.phone_number,
        })) || [],
    };
};

// ---------- Template parameter helpers (named vs positional, per Cloud API) ----------

// A string may contain named ({{first_name}}) or positional ({{1}}) parameters.
export const detectParameterFormat = (text) => {
    if (!text) return 'positional';
    const placeholders = text.match(/\{\{\s*([^}]+?)\s*\}\}/g) || [];
    for (const ph of placeholders) {
        const inner = ph.replace(/\{\{\s*|\s*\}\}/g, '').trim();
        if (!/^\d+$/.test(inner) && inner.length > 0) {
            return 'named';
        }
    }
    return 'positional';
};

// Extract placeholders: positional -> ['1','2'...'], named -> ['first_name', ...]
const extractParameters = (text) => {
    if (!text) return [];
    const matches = text.match(/\{\{\s*([^}]+?)\s*\}\}/g) || [];
    return matches.map(m => m.replace(/\{\{\s*|\s*\}\}/g, '').trim()).filter(Boolean);
};

const positionalCount = (text) => extractParameters(text).filter(p => /^\d+$/.test(p)).length;
const namedParameters = (text) => extractParameters(text).filter(p => !/^\d+$/.test(p));

// Build a parameter example map. Falls back to sample text when the UI omits values.
const buildExample = (format, text, provided) => {
    if (format === 'named') {
        const names = namedParameters(text);
        return {
            body_text_named_params: names.map(name => ({
                param_name: name,
                example: (provided && provided[name]) || `Sample ${name}`,
            })),
        };
    }
    const count = positionalCount(text);
    const array = Array.from({ length: count }, (_, i) => provided?.[i] ?? `Example ${i + 1}`);
    return { body_text: [array] };
};

// Media header formats (need `sample` = hosted URL or uploaded media handle)
const MEDIA_FORMATS = ['IMAGE', 'VIDEO', 'DOCUMENT'];

// Build components array (with required examples) from a UI input
const buildComponents = (input) => {
    const components = [];

    const header = input.header || null;
    if (header && header.format) {
        const format = String(header.format).toUpperCase();
        if (MEDIA_FORMATS.includes(format)) {
            const head = { type: 'HEADER', format };
            if (header.sample) head.example = { header_handle: [header.sample] };
            components.push(head);
        } else if (header.text) {
            components.push({ type: 'HEADER', format: 'TEXT', text: header.text });
        }
    } else if (input.headerText) {
        components.push({ type: 'HEADER', format: 'TEXT', text: input.headerText });
    }

    if (input.bodyText) {
        const format = detectParameterFormat(input.bodyText);
        const body = { type: 'BODY', text: input.bodyText };
        if (extractParameters(input.bodyText).length) {
            body.example = buildExample(format, input.bodyText, input.examples);
        }
        components.push(body);
    }

    if (input.footerText) {
        components.push({ type: 'FOOTER', text: input.footerText });
    }

    const buttons = buildButtons(input);
    if (buttons.length) {
        components.push({ type: 'BUTTONS', buttons });
    }

    return components;
};

// Build the BUTTONS component from a list of rich button objects.
// Supported types: QUICK_REPLY, URL (dynamic/static), PHONE, COPY_CODE.
const buildButtons = (input) => {
    const buttons = [];

    for (const b of input.buttons || []) {
        const type = String(b.type || '').toUpperCase();

        if (type === 'URL') {
            // Dynamic URLs embed a placeholder ({{1}}) that must be present in the
            // body example too; pass url through verbatim so Meta validates it.
            const urlBtn = { type: 'URL', text: b.text, url: b.url };
            if (b.dynamic && b.exampleUrl) urlBtn.example = { label: [b.exampleUrl] };
            buttons.push(urlBtn);
        } else if (type === 'PHONE') {
            if (b.text && b.phoneNumber) {
                buttons.push({ type: 'PHONE', text: b.text, phone_number: b.phoneNumber });
            }
        } else if (type === 'COPY_CODE') {
            buttons.push({ type: 'COPY_CODE', text: b.text });
        } else if (b.text) {
            buttons.push({ type: 'QUICK_REPLY', text: b.text });
        }
    }

    // Legacy quick replies (kept for backwards compatibility with older payloads)
    for (const qr of input.quickReplies || []) {
        if (qr) buttons.push({ type: 'QUICK_REPLY', text: qr });
    }

    return buttons;
};

const payloadForTemplate = (input, components) => {
    const bodyText = input.bodyText || '';
    const parameterFormat = detectParameterFormat(bodyText);
    const payload = {
        name: input.name,
        language: input.language,
        category: String(input.category || 'UTILITY').toUpperCase(),
        components,
    };
    // parameter_format is only meaningful when the template uses parameters
    if (extractParameters(bodyText).length) {
        payload.parameter_format = parameterFormat;
    }
    return payload;
};

// Get current Meta connection status (for a setup/health endpoint)
// Get current Meta connection status (for a setup/health endpoint)
export const getMetaStatus = async () => {
    try {
        let waba = null;
        try { waba = await getWaba(); } catch (e) { waba = ENV_WABA_ID && ENV_WABA_ID !== 'your_waba_id_here' ? ENV_WABA_ID : null; }
        const meta = {
            configured: Boolean(TOKEN && waba),
            tokenConfigured: Boolean(TOKEN),
            wabaConfigured: Boolean(waba),
            phoneId: PHONE_ID,
            graphBase: GRAPH_BASE,
            wabaId: waba,
        };
        if (waba && TOKEN) {
            try {
                const wt = await fetchTemplates();
                meta.connected = true;
                meta.templateCount = wt.length;
            } catch (e) {
                meta.connected = false;
                meta.error = e.message;
            }
        }
        return meta;
    } catch (error) {
        return { configured: false, tokenConfigured: Boolean(TOKEN), wabaConfigured: false, error: error.message };
    }
};