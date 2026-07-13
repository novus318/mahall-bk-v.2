import SystemSettings from '../models/SystemSettings.js';
import axios from 'axios';

// @desc    Get alert contacts
// @route   GET /api/settings/alert-contacts
// @access  Private/Admin + Staff? (Admin mainly)
const getAlertContacts = async (req, res) => {
    try {
        let settings = await SystemSettings.findOne();
        if (!settings) {
            settings = await SystemSettings.create({ alertContacts: [] });
        }
        res.json({ status: true, data: settings.alertContacts });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Update alert contacts
// @route   PUT /api/settings/alert-contacts
// @access  Private/Admin
const updateAlertContacts = async (req, res) => {
    const { contacts } = req.body; // Expects array of { name, number }

    try {
        let settings = await SystemSettings.findOne();
        if (!settings) {
            settings = new SystemSettings({ alertContacts: [] });
        }

        settings.alertContacts = contacts;
        await settings.save();

        res.json({ status: true, message: 'Contacts updated', data: settings.alertContacts });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get Payment Settings
// @route   GET /api/settings/payments
// @access  Private/Admin
const getPaymentSettings = async (req, res) => {
    try {
        let settings = await SystemSettings.findOne();
        if (!settings) settings = await SystemSettings.create({});
        res.json({
            status: true,
            data: {
                paymentSettings: settings.paymentSettings,
                incomeSettings: settings.incomeSettings
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Update Payment Settings
// @route   PUT /api/settings/payments
// @access  Private/Admin
const updatePaymentSettings = async (req, res) => {
    try {
        const { paymentSettings, incomeSettings } = req.body;

        let settings = await SystemSettings.findOne();
        if (!settings) settings = new SystemSettings({});

        if (paymentSettings) {
            if (paymentSettings.receiptPrefix !== undefined) settings.paymentSettings.receiptPrefix = paymentSettings.receiptPrefix;
            if (paymentSettings.receiptCurrentNumber !== undefined) settings.paymentSettings.receiptCurrentNumber = paymentSettings.receiptCurrentNumber;
        }

        if (incomeSettings) {
            if (!settings.incomeSettings) settings.incomeSettings = {};
            if (incomeSettings.receiptPrefix !== undefined) settings.incomeSettings.receiptPrefix = incomeSettings.receiptPrefix;
            if (incomeSettings.receiptCurrentNumber !== undefined) settings.incomeSettings.receiptCurrentNumber = incomeSettings.receiptCurrentNumber;
        }

        await settings.save();
        res.json({ status: true, message: 'Payment settings updated', data: settings.paymentSettings });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get Collection Settings
// @route   GET /api/settings/collections
// @access  Private/Admin
const getCollectionSettings = async (req, res) => {
    try {
        let settings = await SystemSettings.findOne();
        if (!settings) settings = await SystemSettings.create({});
        res.json({
            status: true,
            data: settings.collectionSettings || {}
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Update Collection Settings
// @route   PUT /api/settings/collections
// @access  Private/Admin
const updateCollectionSettings = async (req, res) => {
    try {
        const { receiptPrefix, receiptCurrentNumber, automationEnabled, houseCronDay, memberCronDay, houseCronTime, memberCronTime } = req.body;

        let settings = await SystemSettings.findOne();
        if (!settings) settings = new SystemSettings({});

        if (!settings.collectionSettings) settings.collectionSettings = {};

        if (receiptPrefix !== undefined) settings.collectionSettings.receiptPrefix = receiptPrefix;
        if (receiptCurrentNumber !== undefined) settings.collectionSettings.receiptCurrentNumber = receiptCurrentNumber;
        if (automationEnabled !== undefined) settings.collectionSettings.automationEnabled = automationEnabled;
        if (houseCronDay !== undefined) settings.collectionSettings.houseCronDay = houseCronDay;
        if (memberCronDay !== undefined) settings.collectionSettings.memberCronDay = memberCronDay;
        if (houseCronTime !== undefined) settings.collectionSettings.houseCronTime = houseCronTime;
        if (memberCronTime !== undefined) settings.collectionSettings.memberCronTime = memberCronTime;

        await settings.save();
        res.json({ status: true, message: 'Collection settings updated', data: settings.collectionSettings });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get Rent Settings
// @route   GET /api/settings/rent
// @access  Private/Admin
const getRentSettings = async (req, res) => {
    try {
        let settings = await SystemSettings.findOne();
        if (!settings) settings = await SystemSettings.create({});
        res.json({
            status: true,
            data: settings.rentSettings || {}
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Update Rent Settings
// @route   PUT /api/settings/rent
// @access  Private/Admin
const updateRentSettings = async (req, res) => {
    try {
        const { receiptPrefix, receiptCurrentNumber, automationEnabled, cronDay, cronTime } = req.body;

        let settings = await SystemSettings.findOne();
        if (!settings) settings = new SystemSettings({});

        if (!settings.rentSettings) settings.rentSettings = {};

        if (receiptPrefix !== undefined) settings.rentSettings.receiptPrefix = receiptPrefix;
        if (receiptCurrentNumber !== undefined) settings.rentSettings.receiptCurrentNumber = receiptCurrentNumber;
        if (automationEnabled !== undefined) settings.rentSettings.automationEnabled = automationEnabled;
        if (cronDay !== undefined) settings.rentSettings.cronDay = cronDay;
        if (cronTime !== undefined) settings.rentSettings.cronTime = cronTime;

        await settings.save();
        res.json({ status: true, message: 'Rent settings updated', data: settings.rentSettings });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Send OTP to alert contacts for settings access
// @route   POST /api/settings/send-otp
// @access  Private/Admin
const sendSettingsOTP = async (req, res) => {
    try {
        // Get alert contacts
        let settings = await SystemSettings.findOne();
        if (!settings || !settings.alertContacts || settings.alertContacts.length === 0) {
            return res.status(400).json({ status: false, message: 'No alert contacts configured. Please add alert contacts first.' });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Store OTP with 5-minute expiry
        settings.settingsOTP = {
            code: otp,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
            userId: req.user._id
        };
        await settings.save();

        // Send OTP to all alert contacts via WhatsApp
        const TOKEN = process.env.WHATSAPP_TOKEN;
        const API_URL = process.env.WHATSAPP_API_URL;

        if (!TOKEN || !API_URL) {
            return res.status(500).json({ status: false, message: 'WhatsApp not configured' });
        }

        const sendPromises = settings.alertContacts.map(async (contact) => {
            try {
                const payload = {
                    messaging_product: 'whatsapp',
                    to: contact.number,
                    type: 'template',
                    template: {
                        name: 'otp',
                        language: { code: 'en' },
                        components: [
                            {
                                type: 'body',
                                parameters: [
                                    { type: 'text', text: otp }
                                ]
                            },
                            {
                                type: 'button',
                                sub_type: 'url',
                                index: 0,
                                parameters: [
                                     { type: 'text', text: otp }
                                ]
                            }
                        ]
                    }
                };

                await axios.post(API_URL, payload, {
                    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
                });

                return { success: true, contact: contact.name };
            } catch (error) {
                console.error(`Failed to send OTP to ${contact.name}:`, error.response?.data || error.message);
                return { success: false, contact: contact.name, error: error.message };
            }
        });

        const results = await Promise.all(sendPromises);
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        res.json({
            status: true,
            message: `OTP sent to ${successful} contact(s)${failed > 0 ? `, ${failed} failed` : ''}`,
            data: {
                sent: successful,
                failed: failed,
                expiresIn: 300 // 5 minutes in seconds
            }
        });
    } catch (error) {
        console.error('Send OTP Error:', error);
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Verify OTP for settings access
// @route   POST /api/settings/verify-otp
// @access  Private/Admin
const verifySettingsOTP = async (req, res) => {
    try {
        const { otp } = req.body;

        if (!otp || otp.length !== 6) {
            return res.status(400).json({ status: false, message: 'Invalid OTP format' });
        }

        const settings = await SystemSettings.findOne();
        if (!settings || !settings.settingsOTP || !settings.settingsOTP.code) {
            return res.status(400).json({ status: false, message: 'No OTP found. Please request a new OTP.' });
        }

        // Check if OTP expired
        if (new Date() > settings.settingsOTP.expiresAt) {
            settings.settingsOTP = undefined;
            await settings.save();
            return res.status(400).json({ status: false, message: 'OTP expired. Please request a new OTP.' });
        }

        // Check if OTP matches and belongs to current user
        if (settings.settingsOTP.code !== otp || settings.settingsOTP.userId.toString() !== req.user._id.toString()) {
            return res.status(400).json({ status: false, message: 'Invalid OTP' });
        }

        // Clear OTP after successful verification
        settings.settingsOTP = undefined;
        await settings.save();

        res.json({
            status: true,
            message: 'OTP verified successfully',
            data: {
                accessGranted: true,
                validFor: 30 * 60 // Access valid for 30 minutes in seconds
            }
        });
    } catch (error) {
        console.error('Verify OTP Error:', error);
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Send payment alert when amount > 10000
// @access  Private (called internally)
export const sendPaymentAlert = async (payment, action) => {
    const THRESHOLD = 9999;
    
    if (Number(payment.amount) <= THRESHOLD) {
        return { sent: 0, threshold: THRESHOLD };
    }

    // Get alert contacts
    let settings = await SystemSettings.findOne();
    if (!settings || !settings.alertContacts || settings.alertContacts.length === 0) {
        console.log('No alert contacts configured for payment alert');
        return { sent: 0, reason: 'no contacts' };
    }

    const TOKEN = process.env.WHATSAPP_TOKEN;
    const API_URL = process.env.WHATSAPP_API_URL;

    if (!TOKEN || !API_URL) {
        console.log('WhatsApp not configured for payment alert');
        return { sent: 0, reason: 'no whatsapp config' };
    }

    const amountStr = Number(payment.amount).toLocaleString('en-IN');
    const dateStr = new Date(payment.date).toLocaleDateString('en-IN');
    const actionText = action === 'CREATE' ? 'സൃഷ്ടിച്ചു' : 'അപ്ഡേറ്റ് ചെയ്തു';

    const sendPromises = settings.alertContacts.map(async (contact) => {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                to: contact.number,
                type: 'template',
                template: {
                    name: 'payment_alert',
                    language: { code: 'ml' },
                    components: [
                        {
                            type: 'body',
                            parameters: [
                                { type: 'text', text: actionText },
                                { type: 'text', text: payment.receiptNo || 'N/A' },
                                { type: 'text', text: payment.payee || 'N/A' },
                                { type: 'text', text: amountStr },
                                { type: 'text', text: dateStr }
                            ]
                        }
                    ]
                }
            };

            await axios.post(API_URL, payload, {
                headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
            });

            return { success: true, contact: contact.name };
        } catch (error) {
            console.error(`Failed to send payment alert to ${contact.name}:`, error.response?.data || error.message);
            return { success: false, contact: contact.name, error: error.message };
        }
    });

    const results = await Promise.all(sendPromises);
    const successful = results.filter(r => r.success).length;
    
    return { sent: successful, threshold: THRESHOLD };
};

export { getAlertContacts, updateAlertContacts, getPaymentSettings, updatePaymentSettings, getCollectionSettings, updateCollectionSettings, getRentSettings, updateRentSettings, sendSettingsOTP, verifySettingsOTP };
