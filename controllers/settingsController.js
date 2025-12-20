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

export { getAlertContacts, updateAlertContacts };
