import Family from '../models/Family.js';

// @desc    Get all families
// @route   GET /api/families
// @access  Public
const getFamilies = async (req, res) => {
    try {
        const families = await Family.find({});
        res.json(families);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Create a new family
// @route   POST /api/families
// @access  Public
const createFamily = async (req, res) => {
    try {
        const { name, customId, description } = req.body;

        const familyExists = await Family.findOne({ customId });

        if (familyExists) {
            return res.status(400).json({ message: 'Family ID already exists' });
        }

        if (customId.length !== 3) {
            return res.status(400).json({ message: 'Family ID must be exactly 3 characters' });
        }

        const family = await Family.create({
            name,
            customId: customId.toUpperCase(),
            description
        });

        res.status(201).json(family);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

export { getFamilies, createFamily };
