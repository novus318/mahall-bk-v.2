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
        res.json({ status: true, data: settings.paymentSettings });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Update Payment Settings
// @route   PUT /api/settings/payments
// @access  Private/Admin
const updatePaymentSettings = async (req, res) => {
    try {
        const { receiptPrefix, receiptCurrentNumber } = req.body;

        let settings = await SystemSettings.findOne();
        if (!settings) settings = new SystemSettings({});

        if (receiptPrefix !== undefined) settings.paymentSettings.receiptPrefix = receiptPrefix;
        if (receiptCurrentNumber !== undefined) settings.paymentSettings.receiptCurrentNumber = receiptCurrentNumber;

        await settings.save();
        res.json({ status: true, message: 'Payment settings updated', data: settings.paymentSettings });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export { getAlertContacts, updateAlertContacts, getPaymentSettings, updatePaymentSettings };
