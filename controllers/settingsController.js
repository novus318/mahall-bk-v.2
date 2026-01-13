import SystemSettings from '../models/SystemSettings.js';

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

export { getAlertContacts, updateAlertContacts, getPaymentSettings, updatePaymentSettings, getCollectionSettings, updateCollectionSettings };
